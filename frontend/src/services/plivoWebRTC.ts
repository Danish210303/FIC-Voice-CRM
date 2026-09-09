import { api } from "../api/client";
import * as plivoBrowserSdk from "plivo-browser-sdk";

export interface PlivoEndpointCredentials {
  username: string;
  password: string;
  sip_uri: string;
  plivo_number: string;
  app_id: string;
}

export type WebRTCCallState =
  | "IDLE"
  | "REGISTERING"
  | "READY"
  | "CALLING"
  | "RINGING"
  | "CONNECTING_MEDIA"
  | "CONNECTED"
  | "MEDIA_CONNECTED"
  | "HOLD"
  | "RESUMED"
  | "ENDED"
  | "FAILED";

export interface MediaDiagnostics {
  micPermission: boolean;
  localStream: boolean;
  localAudioTracks: number;
  localTrackLive: boolean;
  micDeviceName: string;
  isMuted: boolean;
  remoteStream: boolean;
  remoteAudioTracks: number;
  remoteTrackLive: boolean;
  audioElementExists: boolean;
  audioElementMuted: boolean;
  audioElementVolume: number;
  audioElementPlaying: boolean;
  isSpeakerMuted: boolean;
  isHold: boolean;
  webAudioActive: boolean;
  iceConnectionState: string;
  peerConnectionState: string;
  dtlsState: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STUN/ICE Sanitizer & Active PeerConnection Tracking
// ─────────────────────────────────────────────────────────────────────────────
const VALID_STUN_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun-fb.plivo.com:3478"] },
  { urls: ["stun:stun.l.google.com:19302"] },
  { urls: ["stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun2.l.google.com:19302"] },
];

export const activePeerConnections = new Set<RTCPeerConnection>();

if (typeof window !== "undefined" && window.RTCPeerConnection && !(window as any)._webrtcSanitizerInstalled) {
  const OriginalRTCPeerConnection = window.RTCPeerConnection;

  const ProxiedRTCPeerConnection = new Proxy(OriginalRTCPeerConnection, {
    construct(target, args, newTarget) {
      const config: RTCConfiguration = args[0] ? { ...args[0] } : {};

      // Sanitize ICE servers: replace unresolvable "stun.plivo.com" with working STUN servers
      let existingServers = config.iceServers ? [...config.iceServers] : [];
      let sanitizedServers: RTCIceServer[] = [];

      for (const server of existingServers) {
        if (!server) continue;
        const urls = typeof server.urls === "string" ? [server.urls] : Array.isArray(server.urls) ? server.urls : [];
        const cleanUrls = urls
          .map((u) => (u.includes("stun.plivo.com") ? "stun:stun-fb.plivo.com:3478" : u))
          .filter((u) => Boolean(u));

        if (cleanUrls.length > 0) {
          sanitizedServers.push({ ...server, urls: cleanUrls });
        }
      }

      if (sanitizedServers.length === 0) {
        sanitizedServers = [...VALID_STUN_SERVERS];
      } else {
        const hasWorkingStun = sanitizedServers.some((s) => {
          const uStr = typeof s.urls === "string" ? s.urls : (s.urls || []).join(" ");
          return uStr.includes("google.com") || uStr.includes("stun-fb.plivo.com");
        });
        if (!hasWorkingStun) {
          sanitizedServers.push(...VALID_STUN_SERVERS);
        }
      }

      config.iceServers = sanitizedServers;
      console.log("[WEBRTC STUN/ICE] RTCPeerConnection initialized with validated STUN servers:", sanitizedServers);

      const pc: RTCPeerConnection = Reflect.construct(target, [config, ...args.slice(1)], newTarget);
      activePeerConnections.add(pc);

      // Safe-guard against duplicate setRemoteDescription on stable signaling state (e.g. 183 Session Progress followed by 200 OK)
      const originalSetRemoteDescription = pc.setRemoteDescription.bind(pc);
      pc.setRemoteDescription = async function (description: RTCSessionDescriptionInit) {
        if (pc.signalingState === "stable" && description && (description.type === "answer" || description.type === "pranswer")) {
          console.warn(`[WEBRTC] Skipping duplicate setRemoteDescription(${description.type}) on stable signalingState`);
          return Promise.resolve();
        }
        try {
          return await originalSetRemoteDescription(description);
        } catch (err: any) {
          if (err?.name === "InvalidStateError" && pc.signalingState === "stable") {
            console.warn("[WEBRTC] Handled setRemoteDescription in stable state gracefully");
            return Promise.resolve();
          }
          throw err;
        }
      };

      pc.addEventListener("icegatheringstatechange", () => {
        console.log(`[WEBRTC ICE] Gathering state: ${pc.iceGatheringState}`);
      });

      pc.addEventListener("icecandidate", (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) {
          console.log(
            `[WEBRTC CANDIDATE] ${event.candidate.type} ${event.candidate.protocol} ${event.candidate.address || (event.candidate as any).ip}:${event.candidate.port}`
          );
        }
      });

      pc.addEventListener("iceconnectionstatechange", () => {
        console.log(`[WEBRTC ICE] Connection state: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          console.log("[PLIVO WebRTC DIAGNOSTIC] ICE Connection Connected");
          window.dispatchEvent(new CustomEvent("plivo_webrtc_ice_connected"));
        } else if (pc.iceConnectionState === "failed") {
          console.error("[WEBRTC ICE] ICE Connection FAILED — STUN/TURN negotiation failure");
          window.dispatchEvent(new CustomEvent("plivo_webrtc_ice_failed"));
        }
      });

      pc.addEventListener("connectionstatechange", () => {
        console.log(`[WEBRTC PEER] Connection state: ${pc.connectionState}`);
        if (pc.connectionState === "connected") {
          console.log("[PLIVO WebRTC DIAGNOSTIC] DTLS & PeerConnection Connected");
          window.dispatchEvent(new CustomEvent("plivo_webrtc_dtls_connected"));
        } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          activePeerConnections.delete(pc);
          if (pc.connectionState === "failed") {
            console.error("[WEBRTC PEER] PeerConnection FAILED — DTLS or network transport issue");
            window.dispatchEvent(new CustomEvent("plivo_webrtc_peer_failed"));
          }
        }
      });

      // Directly capture and bind remote audio track with zero latency
      pc.addEventListener("track", (event: RTCTrackEvent) => {
        console.log(`[WEBRTC TRACK] Inbound track received: kind=${event.track.kind}, readyState=${event.track.readyState}, id=${event.track.id}`);
        if (event.track.kind === "audio") {
          event.track.enabled = true;
          const remoteStream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
          plivoWebRTC.bindRemoteStream(remoteStream);

          event.track.addEventListener("unmute", () => {
            console.log(`[WEBRTC TRACK] Audio track unmuted: id=${event.track.id}`);
            plivoWebRTC.bindRemoteStream(remoteStream);
          });
        }
      });

      return pc;
    },
  });

  window.RTCPeerConnection = ProxiedRTCPeerConnection;
  (window as any)._webrtcSanitizerInstalled = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// PlivoWebRTCService
// ─────────────────────────────────────────────────────────────────────────────
class PlivoWebRTCService {
  private client: any = null;
  private isInitialized = false;
  private isConnected = false;
  private currentCall: any = null;
  private credentials: PlivoEndpointCredentials | null = null;
  private callState: WebRTCCallState = "IDLE";
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private initPromise: Promise<boolean> | null = null;
  private isEventsRegistered = false;
  private audioInputDeviceId: string = "default";
  private audioOutputDeviceId: string = "default";

  // In-call media control states
  private isMuted: boolean = false;
  private isSpeakerMuted: boolean = false;
  private speakerVolume: number = 1.0;
  private isHold: boolean = false;

  // Web Audio Context pipeline for background Electron / browser output
  private audioCtx: AudioContext | null = null;
  private remoteSourceNode: MediaStreamAudioSourceNode | null = null;
  private speakerGainNode: GainNode | null = null;

  private diagnostics: MediaDiagnostics = {
    micPermission: false,
    localStream: false,
    localAudioTracks: 0,
    localTrackLive: false,
    micDeviceName: "Default Microphone",
    isMuted: false,
    remoteStream: false,
    remoteAudioTracks: 0,
    remoteTrackLive: false,
    audioElementExists: false,
    audioElementMuted: false,
    audioElementVolume: 1.0,
    audioElementPlaying: false,
    isSpeakerMuted: false,
    isHold: false,
    webAudioActive: false,
    iceConnectionState: "new",
    peerConnectionState: "new",
    dtlsState: "new",
  };

  // ──────────────────────────────────────────────
  // Web Audio Context Setup & Unlock
  // ──────────────────────────────────────────────
  private getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
        this.speakerGainNode = this.audioCtx.createGain();
        this.speakerGainNode.gain.value = this.isSpeakerMuted ? 0 : this.speakerVolume;
        this.speakerGainNode.connect(this.audioCtx.destination);
      }
    }
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch((e) => console.warn("[WEBAUDIO] Resume error:", e));
    }
    return this.audioCtx;
  }

  public unlockAudio(): void {
    const ctx = this.getAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().then(() => {
        console.log("[WEBAUDIO] AudioContext unlocked and active");
        this.diagnostics.webAudioActive = true;
        this.notifyStateChange();
      }).catch((e) => console.warn("[WEBAUDIO] Unlock error:", e));
    }
  }

  // ──────────────────────────────────────────────
  // Microphone Initialization
  // ──────────────────────────────────────────────
  public async initializeMicrophone(): Promise<boolean> {
    if (this.localStream && this.localStream.getAudioTracks().some((t) => t.readyState === "live")) {
      console.log("[PLIVO] Microphone already active, reusing live audio stream.");
      return true;
    }

    try {
      if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;

      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          deviceId:
            this.audioInputDeviceId !== "default"
              ? { exact: this.audioInputDeviceId }
              : undefined,
        },
        video: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.localStream = stream;
      (window as any).localStream = stream;

      const tracks = stream.getAudioTracks();
      const firstTrack = tracks[0];

      // Ensure active enabled status
      tracks.forEach((t) => {
        t.enabled = !this.isMuted && !this.isHold;
      });

      this.diagnostics.micPermission = true;
      this.diagnostics.localStream = true;
      this.diagnostics.localAudioTracks = tracks.length;
      this.diagnostics.localTrackLive = firstTrack ? firstTrack.readyState === "live" : false;
      this.diagnostics.micDeviceName = firstTrack?.label || "Default Microphone";

      console.log("[PLIVO] Local microphone stream initialized successfully");
      this.notifyStateChange();
      return true;
    } catch (err) {
      console.warn("[PLIVO] Microphone initialization warning:", err);
      this.diagnostics.micPermission = false;
      this.diagnostics.localStream = false;
      this.diagnostics.localAudioTracks = 0;
      this.diagnostics.localTrackLive = false;
      this.notifyStateChange();
      return false;
    }
  }

  // ──────────────────────────────────────────────
  // Single Authoritative Remote Audio Element
  // ──────────────────────────────────────────────
  private ensureRemoteAudioElement(): HTMLAudioElement | null {
    if (typeof document === "undefined") return null;

    // Clean up any legacy conflicting elements
    const legacyIds = ["remoteAudio", "plivo-remote-audio", "plivo_audio"];
    legacyIds.forEach((id) => {
      const oldElem = document.getElementById(id);
      if (oldElem && oldElem.parentNode) {
        oldElem.parentNode.removeChild(oldElem);
      }
    });

    const PRIMARY_REMOTE_ID = "plivo_webrtc_remoteview";
    let elem = document.getElementById(PRIMARY_REMOTE_ID) as HTMLAudioElement;
    if (!elem) {
      elem = document.createElement("audio");
      elem.id = PRIMARY_REMOTE_ID;
      elem.autoplay = true;
      elem.setAttribute("playsinline", "true");
      elem.setAttribute("data-devicetype", "speakerDevice");
      elem.style.position = "absolute";
      elem.style.left = "-9999px";
      elem.style.width = "1px";
      elem.style.height = "1px";
      elem.style.opacity = "0.01";
      document.body.appendChild(elem);
      console.log(`[MEDIA] Created primary authoritative audio element #${PRIMARY_REMOTE_ID}`);
    }

    elem.hidden = false;
    elem.autoplay = true;
    elem.muted = this.isSpeakerMuted;
    elem.volume = this.speakerVolume;

    return elem;
  }

  // ──────────────────────────────────────────────
  // Clean Up Previous Client
  // ──────────────────────────────────────────────
  public cleanup(): void {
    console.log("[PLIVO] Cleaning up WebRTC client session...");
    if (this.client) {
      try {
        if (typeof this.client.logout === "function") {
          this.client.logout();
        }
      } catch (err) {
        console.warn("[PLIVO] Client logout warning:", err);
      }
      this.client = null;
    }
    this.isInitialized = false;
    this.isConnected = false;
    this.isEventsRegistered = false;
    this.currentCall = null;
    this.remoteStream = null;
    this.isMuted = false;
    this.isSpeakerMuted = false;
    this.isHold = false;
    this.setCallState("IDLE");
  }

  // ──────────────────────────────────────────────
  // Initialize & Login
  // ──────────────────────────────────────────────
  public async initialize(): Promise<boolean> {
    if (typeof window === "undefined") return false;

    if (this.isInitialized && this.isConnected && this.client?.isLoggedIn) {
      console.log("[PLIVO] WebRTC client already registered and READY");
      this.setCallState("READY");
      return true;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<boolean> {
    try {
      this.setCallState("REGISTERING");
      this.unlockAudio();

      // 1. Microphone access
      await this.initializeMicrophone();

      // 2. Fetch endpoint credentials
      const creds: PlivoEndpointCredentials = await api.get("/api/calls/plivo/endpoint");
      this.credentials = creds;

      if (!creds.username || !creds.password) {
        console.error("[PLIVO] Endpoint registration failed: Missing SIP credentials");
        this.setCallState("FAILED");
        return false;
      }

      // 3. Pre-create DOM audio element
      this.ensureRemoteAudioElement();

      // 4. Clean up any existing client before creating singleton instance
      if (this.client) {
        this.cleanup();
      }

      // 5. Create Plivo SDK client instance
      const options = {
        debug: "ALL",
        permOnClick: false,
        enableTracking: false,
        usePlivoStunServer: false,
        dscp: true,
        disableRtpTimeOut: true,
        audioConstraints: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };

      const PlivoConstructor = (plivoBrowserSdk as any).default || plivoBrowserSdk;
      const plivoWrapper = new PlivoConstructor(options);
      this.client = plivoWrapper.client || plivoWrapper;

      // 6. Register events and initiate login
      const bareUsername = creds.username.split("@")[0];
      const loginResult = await this._loginToPlivo(bareUsername, creds.password);

      return loginResult;
    } catch (err) {
      console.error("[PLIVO] Initialization exception:", err);
      this.setCallState("FAILED");
      return false;
    } finally {
      this.initPromise = null;
    }
  }

  private _loginToPlivo(username: string, password: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (!this.client) {
        console.error("[PLIVO] No client instance for login");
        resolve(false);
        return;
      }

      let resolved = false;
      const done = (success: boolean) => {
        if (resolved) return;
        resolved = true;
        if (success) {
          this.isConnected = true;
          this.isInitialized = true;
          this.setCallState("READY");
          window.dispatchEvent(new CustomEvent("plivo_webrtc_connected"));
        } else {
          this.isConnected = false;
          this.setCallState("FAILED");
        }
        resolve(success);
      };

      const client = this.client;
      const registerOn = typeof client.on === "function" ? client.on.bind(client) : null;

      if (!registerOn) {
        console.error("[PLIVO] client.on is not a function — cannot register events");
        done(false);
        return;
      }

      if (!this.isEventsRegistered) {
        this.isEventsRegistered = true;

        registerOn("onWebrtcNotSupported", () => {
          console.error("[PLIVO] onWebrtcNotSupported — WebRTC is not supported in this environment");
          done(false);
        });

        registerOn("onConnectionChange", (data: any) => {
          const state = data?.state || data;
          console.log(`[PLIVO] onConnectionChange: WebSocket state = ${state}`);
        });

        registerOn("onLogin", () => {
          console.log("[PLIVO] onLogin event fired — SIP REGISTER 200 OK confirmed");
          done(true);
        });

        registerOn("onLoginFailed", (cause: any) => {
          console.error("[PLIVO] onLoginFailed:", cause);
          done(false);
        });

        registerOn("onLogout", () => {
          console.warn("[PLIVO] onLogout event — endpoint unregistered");
          this.isConnected = false;
          this.isInitialized = false;
          this.setCallState("IDLE");
        });

        registerOn("onIncomingCall", (...args: any[]) => {
          console.log("[PLIVO] onIncomingCall received:", args);
          const callerName = args[0];
          const extraHeaders = args[1];
          const callInfo = args[2];
          const callerID = callInfo?.src || callerName;

          window.dispatchEvent(
            new CustomEvent("plivo_webrtc_incoming", {
              detail: { callerID, extraHeaders, callInfo, callerName },
            })
          );
        });

        registerOn("onCallRemoteRinging", (data: any) => {
          console.log("[PLIVO] Remote Ringing Detected (Customer phone is ringing)");
          this.setCallState("RINGING");
          window.dispatchEvent(new CustomEvent("plivo_webrtc_ringing", { detail: data }));
        });

        registerOn("onCallAnswered", (data: any) => {
          console.log("[PLIVO] onCallAnswered — Remote answered, verifying media stream...");
          this.currentCall = data;
          this.unlockAudio();
          this.setCallState("CONNECTING_MEDIA");
          window.dispatchEvent(new CustomEvent("plivo_webrtc_answered", { detail: data }));
          this.monitorRemoteAudio();
        });

        registerOn("onCallConnected", (data: any) => {
          console.log("[PLIVO] onCallConnected event fired");
          this.currentCall = data || this.currentCall;
          this.unlockAudio();
          window.dispatchEvent(new CustomEvent("plivo_webrtc_call_connected", { detail: data }));
        });

        registerOn("onMediaConnected", (data: any) => {
          console.log("[PLIVO] onMediaConnected — Remote audio media event received:", data);
          if (data instanceof MediaStream || (data && data.stream instanceof MediaStream)) {
            this.bindRemoteStream(data);
          } else {
            this.extractAndBindRemoteStream();
          }
        });

        registerOn("onCallTerminated", (data: any) => {
          console.log("[PLIVO] onCallTerminated:", data?.reason || "Normal clearing");
          this.currentCall = null;
          this.remoteStream = null;
          this.diagnostics.remoteStream = false;
          this.diagnostics.remoteAudioTracks = 0;
          this.diagnostics.remoteTrackLive = false;
          this.diagnostics.audioElementPlaying = false;
          this.setCallState("ENDED");
          setTimeout(() => {
            if (this.isConnected) this.setCallState("READY");
          }, 1000);
          window.dispatchEvent(new CustomEvent("plivo_webrtc_terminated", { detail: data }));
        });

        registerOn("onCallFailed", (reason: any) => {
          console.error("[PLIVO] onCallFailed:", reason);
          this.currentCall = null;
          this.setCallState("FAILED");
          window.dispatchEvent(new CustomEvent("plivo_webrtc_failed", { detail: { reason } }));
          setTimeout(() => {
            if (this.isConnected) this.setCallState("READY");
          }, 1500);
        });

        registerOn("onMediaPermission", (data: any) => {
          console.log("[PLIVO] onMediaPermission:", data?.status);
        });

        registerOn("onQualityWarning", (warning: any) => {
          console.warn("[PLIVO] WebRTC Quality Warning:", warning);
        });
      }

      console.log(`[PLIVO] Executing client.login("${username}", "****")`);
      try {
        client.login(username, password);
      } catch (err) {
        console.error("[PLIVO] client.login() exception:", err);
        done(false);
        return;
      }

      setTimeout(() => {
        if (resolved) return;
        if (client.isLoggedIn) {
          done(true);
        } else {
          console.error("[PLIVO] Login timed out after 30s");
          done(false);
        }
      }, 30000);
    });
  }

  // ──────────────────────────────────────────────
  // Remote Audio Stream Binding & WebAudio Routing
  // ──────────────────────────────────────────────
  public bindRemoteStream(streamOrEvent: any): void {
    if (!streamOrEvent) return;

    let stream: MediaStream | null = null;
    if (streamOrEvent instanceof MediaStream) {
      stream = streamOrEvent;
    } else if (streamOrEvent && streamOrEvent.stream instanceof MediaStream) {
      stream = streamOrEvent.stream;
    } else if (streamOrEvent && streamOrEvent.mediaStream instanceof MediaStream) {
      stream = streamOrEvent.mediaStream;
    } else if (typeof (window as any).MediaStream !== "undefined" && streamOrEvent instanceof (window as any).MediaStream) {
      stream = streamOrEvent;
    }

    if (!stream) {
      this.extractAndBindRemoteStream();
      return;
    }

    this.remoteStream = stream;
    const tracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
    const firstTrack = tracks[0];

    // Ensure remote track is enabled
    tracks.forEach((t) => {
      t.enabled = true;
    });

    this.diagnostics.remoteStream = true;
    this.diagnostics.remoteAudioTracks = tracks.length;
    this.diagnostics.remoteTrackLive = firstTrack ? firstTrack.readyState === "live" : true;

    console.log(`[MEDIA] Binding remote audio stream. Tracks: ${tracks.length}, state: ${firstTrack?.readyState || "live"}`);

    // 1. Bind to single primary HTMLAudioElement
    const audioElem = this.ensureRemoteAudioElement();
    if (audioElem) {
      try {
        if (audioElem.srcObject !== stream) {
          audioElem.srcObject = stream;
        }
        audioElem.muted = this.isSpeakerMuted;
        audioElem.volume = this.speakerVolume;
        audioElem.autoplay = true;

        if (this.audioOutputDeviceId && this.audioOutputDeviceId !== "default" && typeof (audioElem as any).setSinkId === "function") {
          (audioElem as any).setSinkId(this.audioOutputDeviceId).catch(() => {});
        }

        audioElem
          .play()
          .then(() => {
            console.log("[MEDIA] Primary audio element playback active (#plivo_webrtc_remoteview)");
            this.diagnostics.audioElementPlaying = true;
          })
          .catch((err) => {
            console.warn("[MEDIA] Autoplay deferred on audio element:", err);
          });
      } catch (err) {
        console.warn("[MEDIA] Failed to assign srcObject to audio element:", err);
      }
    }

    this.diagnostics.audioElementExists = true;
    this.setCallState("MEDIA_CONNECTED");
    this.setCallState("CONNECTED");

    window.dispatchEvent(new CustomEvent("plivo_webrtc_media_connected", { detail: { stream } }));
    this.notifyStateChange();
  }

  public extractAndBindRemoteStream(): void {
    const audioElem = document.getElementById("plivo_webrtc_remoteview") as HTMLAudioElement;
    if (audioElem?.srcObject instanceof MediaStream && audioElem.srcObject.getAudioTracks().length > 0) {
      this.bindRemoteStream(audioElem.srcObject);
      return;
    }

    if (this.client?.remoteView?.srcObject instanceof MediaStream && this.client.remoteView.srcObject.getAudioTracks().length > 0) {
      this.bindRemoteStream(this.client.remoteView.srcObject);
      return;
    }

    for (const pc of activePeerConnections) {
      const receivers = pc.getReceivers();
      for (const r of receivers) {
        if (r.track && r.track.kind === "audio" && r.track.readyState === "live") {
          r.track.enabled = true;
          const stream = new MediaStream([r.track]);
          this.bindRemoteStream(stream);
          return;
        }
      }
    }
  }

  /**
   * Monitor remote audio tracks after call connect to ensure stream is bound immediately
   */
  private monitorRemoteAudio(): void {
    let attempts = 0;
    const maxAttempts = 150;

    const poller = setInterval(() => {
      attempts++;
      if (attempts > maxAttempts || this.callState === "ENDED" || this.callState === "IDLE") {
        clearInterval(poller);
        return;
      }

      const sdkElem = document.getElementById("plivo_webrtc_remoteview") as HTMLAudioElement;
      if (sdkElem?.srcObject) {
        const stream = sdkElem.srcObject as MediaStream;
        const tracks = stream.getAudioTracks();
        if (tracks.length > 0 && tracks[0].readyState === "live") {
          clearInterval(poller);
          this.bindRemoteStream(stream);
          return;
        }
      }

      if (this.client?.remoteView?.srcObject) {
        const stream = this.client.remoteView.srcObject as MediaStream;
        if (stream.getAudioTracks().length > 0) {
          clearInterval(poller);
          this.bindRemoteStream(stream);
          return;
        }
      }
    }, 100);
  }

  // ──────────────────────────────────────────────
  // Make Outbound Call
  // ──────────────────────────────────────────────
  public async makeCall(destinationNumber: string): Promise<boolean> {
    try {
      this.unlockAudio();
      this.setCallState("CALLING");

      if (!this.client || !this.isConnected || !this.client.isLoggedIn) {
        const ok = await this.initialize();
        if (!ok) {
          console.error("[PLIVO] Outbound call aborted: WebRTC initialization failed");
          this.setCallState("FAILED");
          return false;
        }
      }

      if (!this.client?.isLoggedIn) {
        console.error("[PLIVO] Outbound call blocked: client.isLoggedIn is false");
        this.setCallState("FAILED");
        return false;
      }

      if (!this.localStream) {
        await this.initializeMicrophone();
      }

      this.ensureRemoteAudioElement();

      const cleanPhone = destinationNumber.replace(/\D/g, "");
      const formattedNumber = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const callerId = this.credentials?.plivo_number || "+918031826757";

      console.log(`[PLIVO] Initiating client.call() to ${formattedNumber} with callerId: ${callerId}`);

      if (typeof this.client.call !== "function") {
        console.error("[PLIVO] client.call is not a function");
        this.setCallState("FAILED");
        return false;
      }

      const extraHeaders: Record<string, string> = {
        "X-PH-callerId": callerId,
      };

      this.client.call(formattedNumber, extraHeaders);
      this.monitorRemoteAudio();
      return true;
    } catch (err) {
      console.error("[PLIVO] Make call exception:", err);
      this.setCallState("FAILED");
      return false;
    }
  }

  public async answer(callUUID?: string): Promise<void> {
    if (typeof this.client?.answer === "function") {
      try {
        this.unlockAudio();
        if (!this.localStream) {
          await this.initializeMicrophone();
        }
        this.ensureRemoteAudioElement();

        if (callUUID) {
          this.client.answer(callUUID);
        } else {
          this.client.answer();
        }
        console.log("[PLIVO] client.answer() invoked successfully");
        this.monitorRemoteAudio();
      } catch (err) {
        console.warn("[PLIVO] Answer error:", err);
      }
    }
  }

  public reject(callUUID?: string): void {
    if (typeof this.client?.reject === "function") {
      try {
        if (callUUID) {
          this.client.reject(callUUID);
        } else {
          this.client.reject();
        }
      } catch (err) {
        console.warn("[PLIVO] Reject error:", err);
      }
    }
    this.currentCall = null;
    this.setCallState("READY");
  }

  public hangup(): void {
    if (typeof this.client?.hangup === "function") {
      try {
        this.client.hangup();
      } catch (err) {
        console.warn("[PLIVO] Hangup error:", err);
      }
    }
    this.currentCall = null;
    this.setCallState("ENDED");
    setTimeout(() => {
      if (this.isConnected) this.setCallState("READY");
    }, 1000);
  }

  // ──────────────────────────────────────────────
  // Bidirectional Media Controls: Mute, Speaker, Hold
  // ──────────────────────────────────────────────
  /**
   * Mute / Unmute the Agent's local microphone only.
   * Customer incoming voice playback remains completely unaffected.
   */
  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.diagnostics.isMuted = muted;

    // 1. Toggle local stream microphone tracks
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }

    // 2. Toggle active PeerConnection audio senders
    activePeerConnections.forEach((pc) => {
      try {
        pc.getSenders().forEach((sender) => {
          if (sender.track && sender.track.kind === "audio") {
            sender.track.enabled = !muted;
          }
        });
      } catch (e) {
        console.warn("[PLIVO] Sender mute toggle warning:", e);
      }
    });

    // 3. Inform Plivo Browser SDK client if available
    try {
      if (muted && typeof this.client?.mute === "function") {
        this.client.mute();
      } else if (!muted && typeof this.client?.unmute === "function") {
        this.client.unmute();
      }
    } catch (e) {
      console.warn("[PLIVO] Client mute/unmute call warning:", e);
    }

    console.log(`[MEDIA] Agent microphone ${muted ? "MUTED" : "UNMUTED"} (Customer audio playback unchanged)`);
    this.notifyStateChange();
  }

  /**
   * Control the Agent's speaker / incoming customer voice playback.
   * Microphone transmission to the customer remains completely active.
   */
  public setSpeakerMuted(muted: boolean): void {
    this.isSpeakerMuted = muted;
    this.diagnostics.isSpeakerMuted = muted;

    const audioElem = document.getElementById("plivo_webrtc_remoteview") as HTMLAudioElement;
    if (audioElem) {
      audioElem.muted = muted;
      this.diagnostics.audioElementMuted = muted;
    }

    if (this.speakerGainNode) {
      this.speakerGainNode.gain.value = muted ? 0 : this.speakerVolume;
    }

    console.log(`[MEDIA] Agent incoming speaker ${muted ? "MUTED" : "UNMUTED"}`);
    this.notifyStateChange();
  }

  public setSpeakerVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1.0, volume));
    this.speakerVolume = clamped;
    this.diagnostics.audioElementVolume = clamped;

    const audioElem = document.getElementById("plivo_webrtc_remoteview") as HTMLAudioElement;
    if (audioElem) {
      audioElem.volume = clamped;
    }

    if (this.speakerGainNode && !this.isSpeakerMuted) {
      this.speakerGainNode.gain.value = clamped;
    }

    this.notifyStateChange();
  }

  /**
   * Place call on Hold / Resume call.
   * Pauses local mic transmission and remote audio playback cleanly.
   */
  public setHold(isHold: boolean): void {
    this.isHold = isHold;
    this.diagnostics.isHold = isHold;

    // 1. Manage local microphone
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !isHold && !this.isMuted;
      });
    }

    activePeerConnections.forEach((pc) => {
      try {
        pc.getSenders().forEach((sender) => {
          if (sender.track && sender.track.kind === "audio") {
            sender.track.enabled = !isHold && !this.isMuted;
          }
        });
      } catch {}
    });

    // 2. Manage remote audio playback during hold
    const audioElem = document.getElementById("plivo_webrtc_remoteview") as HTMLAudioElement;
    if (audioElem) {
      audioElem.muted = isHold ? true : this.isSpeakerMuted;
    }

    if (this.speakerGainNode) {
      this.speakerGainNode.gain.value = isHold ? 0 : (this.isSpeakerMuted ? 0 : this.speakerVolume);
    }

    this.setCallState(isHold ? "HOLD" : "RESUMED");
    if (!isHold) {
      this.setCallState("CONNECTED");
    }

    console.log(`[MEDIA] Call ${isHold ? "PLACED ON HOLD" : "RESUMED"}`);
    this.notifyStateChange();
  }

  public getCredentials(): PlivoEndpointCredentials | null {
    return this.credentials;
  }

  public getCallState(): WebRTCCallState {
    return this.callState;
  }

  public getDiagnostics(): MediaDiagnostics {
    return { ...this.diagnostics };
  }

  public async getAudioDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
    if (typeof window === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return { inputs: [], outputs: [] };
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: devices.filter((d) => d.kind === "audioinput"),
      outputs: devices.filter((d) => d.kind === "audiooutput"),
    };
  }

  public async setAudioInputDevice(deviceId: string): Promise<boolean> {
    this.audioInputDeviceId = deviceId;
    return this.initializeMicrophone();
  }

  public async setAudioOutputDevice(deviceId: string): Promise<boolean> {
    this.audioOutputDeviceId = deviceId;
    try {
      const elem = document.getElementById("plivo_webrtc_remoteview") as any;
      if (elem && typeof elem.setSinkId === "function") {
        await elem.setSinkId(deviceId);
      }
      return true;
    } catch (err) {
      console.warn("[MEDIA] Output device selection error:", err);
      return false;
    }
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  private setCallState(state: WebRTCCallState) {
    this.callState = state;
    this.notifyStateChange();
  }

  private notifyStateChange() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("plivo_webrtc_state_change", {
          detail: { state: this.callState, diagnostics: this.getDiagnostics() },
        })
      );
    }
  }
}

export const plivoWebRTC = new PlivoWebRTCService();
