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
  | "CONNECTED"
  | "MEDIA_CONNECTED"
  | "ENDED"
  | "FAILED";

export interface MediaDiagnostics {
  micPermission: boolean;
  localStream: boolean;
  localAudioTracks: number;
  localTrackLive: boolean;
  micDeviceName: string;
  remoteStream: boolean;
  remoteAudioTracks: number;
  remoteTrackLive: boolean;
  audioElementExists: boolean;
  audioElementMuted: boolean;
  audioElementVolume: number;
  audioElementPlaying: boolean;
  iceConnectionState: string;
  peerConnectionState: string;
  dtlsState: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STUN/ICE Sanitizer & WebRTC RTCPeerConnection Lifecycle Instrumentation
// Fixes "Failed to resolve address for stun.plivo.com" and "Failed to unprotect RTP packet"
// ─────────────────────────────────────────────────────────────────────────────
const VALID_STUN_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun-fb.plivo.com:3478"] },
  { urls: ["stun:stun.l.google.com:19302"] },
  { urls: ["stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun2.l.google.com:19302"] },
];

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

      // Ensure valid STUN servers are present
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

      // Instrument ICE and DTLS lifecycle events
      pc.addEventListener("icegatheringstatechange", () => {
        console.log(`[WEBRTC ICE] Gathering state: ${pc.iceGatheringState}`);
        if (pc.iceGatheringState === "complete") {
          console.log("[WEBRTC ICE] Candidate gathering complete");
        }
      });

      pc.addEventListener("icecandidate", (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) {
          console.log(
            `[WEBRTC CANDIDATE] Discovered: ${event.candidate.type} ${event.candidate.protocol} ${event.candidate.address || (event.candidate as any).ip}:${event.candidate.port}`
          );
        }
      });

      pc.addEventListener("iceconnectionstatechange", () => {
        console.log(`[WEBRTC ICE] Connection state: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          console.log("[PLIVO WebRTC DIAGNOSTIC] 5. ICE Connection Connected");
          window.dispatchEvent(new CustomEvent("plivo_webrtc_ice_connected"));
        } else if (pc.iceConnectionState === "failed") {
          console.error("[WEBRTC ICE] ICE Connection FAILED — STUN/TURN negotiation failure");
          window.dispatchEvent(new CustomEvent("plivo_webrtc_ice_failed"));
        }
      });

      pc.addEventListener("connectionstatechange", () => {
        console.log(`[WEBRTC PEER] Connection state: ${pc.connectionState}`);
        if (pc.connectionState === "connected") {
          console.log("[PLIVO WebRTC DIAGNOSTIC] 6. DTLS & PeerConnection Connected");
          window.dispatchEvent(new CustomEvent("plivo_webrtc_dtls_connected"));
        } else if (pc.connectionState === "failed") {
          console.error("[WEBRTC PEER] PeerConnection FAILED — DTLS or network transport issue");
          window.dispatchEvent(new CustomEvent("plivo_webrtc_peer_failed"));
        }
      });

      pc.addEventListener("track", (event: RTCTrackEvent) => {
        console.log(`[WEBRTC TRACK] Inbound track received: kind=${event.track.kind}, readyState=${event.track.readyState}`);
      });

      return pc;
    },
  });

  window.RTCPeerConnection = ProxiedRTCPeerConnection;
  (window as any)._webrtcSanitizerInstalled = true;
}

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

  private diagnostics: MediaDiagnostics = {
    micPermission: false,
    localStream: false,
    localAudioTracks: 0,
    localTrackLive: false,
    micDeviceName: "Default Microphone",
    remoteStream: false,
    remoteAudioTracks: 0,
    remoteTrackLive: false,
    audioElementExists: false,
    audioElementMuted: false,
    audioElementVolume: 1,
    audioElementPlaying: false,
    iceConnectionState: "new",
    peerConnectionState: "new",
    dtlsState: "new",
  };

  // ──────────────────────────────────────────────
  // Microphone Initialization
  // ──────────────────────────────────────────────
  public async initializeMicrophone(): Promise<boolean> {
    if (this.localStream && this.localStream.getAudioTracks().some((t) => t.readyState === "live" && t.enabled)) {
      console.log("[PLIVO] Microphone already initialized, reusing live audio stream.");
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

      this.diagnostics.micPermission = true;
      this.diagnostics.localStream = true;
      this.diagnostics.localAudioTracks = tracks.length;
      this.diagnostics.localTrackLive = firstTrack ? firstTrack.readyState === "live" && firstTrack.enabled : false;
      this.diagnostics.micDeviceName = firstTrack?.label || "Default Microphone";

      console.log("[PLIVO] Microphone initialized successfully");
      console.log(`[MEDIA] Local audio tracks: ${tracks.length}, state: ${firstTrack?.readyState || "none"}`);

      this.notifyStateChange();
      return true;
    } catch (err) {
      console.warn("[PLIVO] Microphone initialization error:", err);
      this.diagnostics.micPermission = false;
      this.diagnostics.localStream = false;
      this.diagnostics.localAudioTracks = 0;
      this.diagnostics.localTrackLive = false;
      this.notifyStateChange();
      return false;
    }
  }

  // ──────────────────────────────────────────────
  // Ensure Remote and Local Audio Elements
  // ──────────────────────────────────────────────
  private ensureRemoteAudioElement(): void {
    if (typeof document === "undefined") return;

    const audioElemIds = ["plivo_webrtc_remoteview", "remoteAudio", "plivo-remote-audio", "plivo_audio"];
    audioElemIds.forEach((id) => {
      let elem = document.getElementById(id) as HTMLAudioElement;
      if (!elem) {
        elem = document.createElement("audio");
        elem.id = id;
        elem.autoplay = true;
        elem.setAttribute("playsinline", "true");
        elem.setAttribute("data-devicetype", "speakerDevice");
        elem.hidden = true;
        document.body.appendChild(elem);
        console.log(`[MEDIA] Created SDK audio element #${id}`);
      }
      elem.autoplay = true;
      elem.muted = false;
      elem.volume = 1.0;
    });

    const SDK_LOCAL_ID = "localAudio";
    let localElem = document.getElementById(SDK_LOCAL_ID) as HTMLAudioElement;
    if (!localElem) {
      localElem = document.createElement("audio");
      localElem.id = SDK_LOCAL_ID;
      localElem.autoplay = true;
      localElem.setAttribute("playsinline", "true");
      localElem.muted = true;
      localElem.hidden = true;
      document.body.appendChild(localElem);
      console.log(`[MEDIA] Created SDK local audio element #${SDK_LOCAL_ID}`);
    }
  }

  // ──────────────────────────────────────────────
  // Clean Up Previous Client Before Re-creating (Singleton Safety)
  // ──────────────────────────────────────────────
  public cleanup(): void {
    console.log("[PLIVO] Cleaning up existing WebRTC client session...");
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
    this.setCallState("IDLE");
  }

  // ──────────────────────────────────────────────
  // Initialize & Login
  // ──────────────────────────────────────────────
  public async initialize(): Promise<boolean> {
    if (typeof window === "undefined") return false;

    // Already ready and logged in
    if (this.isInitialized && this.isConnected && this.client?.isLoggedIn) {
      console.log("[PLIVO] Already logged in — WEBRTC READY");
      this.setCallState("READY");
      return true;
    }

    // Deduplicate concurrent initialization requests
    if (this.initPromise) {
      console.log("[PLIVO] WebRTC registration already in progress, awaiting…");
      return this.initPromise;
    }

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<boolean> {
    try {
      this.setCallState("REGISTERING");
      console.log("[PLIVO WebRTC DIAGNOSTIC] 1. SDK Initializing...");

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

      console.log(`[PLIVO] Endpoint credentials loaded: username=${creds.username}, sip_uri=${creds.sip_uri}`);

      // 3. Pre-create DOM audio elements
      this.ensureRemoteAudioElement();

      // 4. Clean up any existing client before creating singleton instance
      if (this.client) {
        this.cleanup();
      }

      // 5. Create Plivo SDK client instance with supported options
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

      console.log(`[PLIVO] SDK client created (version: ${this.client?.version || "2.1.4"})`);

      // 6. Register events and initiate login
      const bareUsername = creds.username.split("@")[0];
      const loginResult = await this._loginToPlivo(bareUsername, creds.password);

      if (loginResult) {
        console.log(`[PLIVO WebRTC DIAGNOSTIC] 2. Registered (Username: ${bareUsername}) — WEBRTC READY`);
      } else {
        console.error(`[PLIVO] WebRTC SIP registration FAILED for ${bareUsername}`);
      }

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

        // ── onWebrtcNotSupported ──
        registerOn("onWebrtcNotSupported", () => {
          console.error("[PLIVO] onWebrtcNotSupported — WebRTC is not supported in this environment");
          done(false);
        });

        // ── onConnectionChange: WebSocket Level ──
        registerOn("onConnectionChange", (data: any) => {
          const state = data?.state || data;
          console.log(`[PLIVO] onConnectionChange: WebSocket state = ${state}`);
        });

        // ── onLogin: SIP REGISTER 200 OK Succeeded ──
        registerOn("onLogin", () => {
          console.log("[PLIVO] onLogin event fired — SIP REGISTER 200 OK confirmed");
          done(true);
        });

        // ── onLoginFailed: SIP REGISTER Failed ──
        registerOn("onLoginFailed", (cause: any) => {
          console.error("[PLIVO] onLoginFailed:", cause);
          done(false);
        });

        // ── onLogout: SIP Unregistered ──
        registerOn("onLogout", () => {
          console.warn("[PLIVO] onLogout event — endpoint unregistered");
          this.isConnected = false;
          this.isInitialized = false;
          this.setCallState("IDLE");
        });

        // ── onIncomingCall: Inbound Ringing ──
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

        // ── onCallRemoteRinging: Outbound Remote Ringing ──
        registerOn("onCallRemoteRinging", (data: any) => {
          console.log("[PLIVO WebRTC DIAGNOSTIC] 4. Remote Ringing Detected (Phone is ringing)");
          this.setCallState("RINGING");
          window.dispatchEvent(new CustomEvent("plivo_webrtc_ringing", { detail: data }));
        });

        // ── onCallAnswered / onCallConnected: Remote Party Answered ──
        registerOn("onCallAnswered", (data: any) => {
          console.log("[PLIVO] onCallAnswered — Remote answered, verifying audio media path...");
          this.currentCall = data;
          window.dispatchEvent(new CustomEvent("plivo_webrtc_answered", { detail: data }));
          this.monitorRemoteAudio();
        });

        registerOn("onCallConnected", (data: any) => {
          console.log("[PLIVO] onCallConnected event fired");
          this.currentCall = data || this.currentCall;
          window.dispatchEvent(new CustomEvent("plivo_webrtc_call_connected", { detail: data }));
        });

        // ── onMediaConnected: Remote Audio Stream Received ──
        registerOn("onMediaConnected", (stream: any) => {
          console.log("[PLIVO WebRTC DIAGNOSTIC] 7. Media Connected (Remote audio stream received)");
          this.bindRemoteStream(stream);
        });

        // ── onCallTerminated: Call Ended ──
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

        // ── onCallFailed: Call Failure / Reject / Busy / Network Error ──
        registerOn("onCallFailed", (reason: any) => {
          console.error("[PLIVO] onCallFailed:", reason);
          this.currentCall = null;
          this.setCallState("FAILED");
          window.dispatchEvent(new CustomEvent("plivo_webrtc_failed", { detail: { reason } }));
          setTimeout(() => {
            if (this.isConnected) this.setCallState("READY");
          }, 1500);
        });

        // ── onMediaPermission: Microphone Permission State ──
        registerOn("onMediaPermission", (data: any) => {
          console.log("[PLIVO] onMediaPermission:", data?.status);
        });

        // ── onQualityWarning: Media Quality Warnings ──
        registerOn("onQualityWarning", (warning: any) => {
          console.warn("[PLIVO] WebRTC Quality Warning:", warning);
        });
      }

      // Initiate login via Plivo SDK
      console.log(`[PLIVO] Executing client.login("${username}", "****")`);
      try {
        client.login(username, password);
      } catch (err) {
        console.error("[PLIVO] client.login() exception:", err);
        done(false);
        return;
      }

      // Timeout safety net (30s)
      setTimeout(() => {
        if (resolved) return;
        if (client.isLoggedIn) {
          console.warn("[PLIVO] Login timeout triggered, but client.isLoggedIn=true — resolving success");
          done(true);
        } else {
          console.error("[PLIVO] Login timed out after 30s — registration incomplete");
          done(false);
        }
      }, 30000);
    });
  }

  // ──────────────────────────────────────────────
  // Remote Audio Stream Binding & Validation
  // ──────────────────────────────────────────────
  private bindRemoteStream(stream: any): void {
    if (!stream) return;
    this.remoteStream = stream;

    const tracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
    const firstTrack = tracks[0];

    this.diagnostics.remoteStream = true;
    this.diagnostics.remoteAudioTracks = tracks.length;
    this.diagnostics.remoteTrackLive = firstTrack ? firstTrack.readyState === "live" : true;

    console.log(`[MEDIA] Remote audio tracks: ${tracks.length}, state: ${firstTrack?.readyState || "live"}`);

    const audioIds = ["plivo_webrtc_remoteview", "remoteAudio", "plivo-remote-audio", "plivo_audio"];
    audioIds.forEach((id) => {
      let elem = document.getElementById(id) as HTMLAudioElement;
      if (!elem) {
        elem = document.createElement("audio");
        elem.id = id;
        elem.autoplay = true;
        elem.setAttribute("playsinline", "true");
        document.body.appendChild(elem);
      }

      elem.srcObject = stream;
      elem.muted = false;
      elem.volume = 1.0;
      elem.autoplay = true;

      elem
        .play()
        .then(() => {
          console.log(`[MEDIA] Remote audio playback active on #${id}`);
          this.diagnostics.audioElementPlaying = true;
        })
        .catch((err) => {
          console.warn(`[MEDIA] Autoplay deferred on #${id}:`, err);
        });
    });

    this.diagnostics.audioElementExists = true;
    this.setCallState("MEDIA_CONNECTED");
    this.setCallState("CONNECTED");
    console.log("[PLIVO WebRTC DIAGNOSTIC] 8. Call Fully Connected (Talk Timer Starting)");
    window.dispatchEvent(new CustomEvent("plivo_webrtc_media_connected", { detail: { stream } }));
    this.notifyStateChange();
  }

  /**
   * Periodically check for remote audio stream after call connection.
   */
  private monitorRemoteAudio(): void {
    let attempts = 0;
    const maxAttempts = 300;

    const poller = setInterval(() => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(poller);
        return;
      }

      const sdkElem = document.getElementById("plivo_webrtc_remoteview") as HTMLAudioElement;
      if (sdkElem?.srcObject) {
        const stream = sdkElem.srcObject as MediaStream;
        const tracks = stream.getAudioTracks();
        if (tracks.length > 0) {
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
      console.log(`[PLIVO WebRTC DIAGNOSTIC] 3. Outbound Call Initiated (Destination: ${destinationNumber})`);
      this.setCallState("CALLING");

      if (!this.client || !this.isConnected || !this.client.isLoggedIn) {
        console.log("[PLIVO] WebRTC client not logged in — initializing first…");
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
      // Plivo Browser SDK client.call() expects digits with country code without '+' prefix
      const formattedNumber = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const callerId = this.credentials?.plivo_number || "+918031826757";

      console.log(`[PLIVO] Calling destination: ${formattedNumber} with callerId: ${callerId}`);

      if (typeof this.client.call !== "function") {
        console.error("[PLIVO] client.call is not a function");
        this.setCallState("FAILED");
        return false;
      }

      const extraHeaders: Record<string, string> = {
        "X-PH-callerId": callerId,
      };

      this.client.call(formattedNumber, extraHeaders);
      console.log("[PLIVO] client.call() invoked successfully");

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
        console.log("[PLIVO] client.reject() invoked successfully");
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

  public mute(): void {
    if (typeof this.client?.mute === "function") {
      this.client.mute();
    }
  }

  public unmute(): void {
    if (typeof this.client?.unmute === "function") {
      this.client.unmute();
    }
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
      const elementIds = ["plivo_webrtc_remoteview", "remoteAudio", "plivo-remote-audio", "plivo_audio"];
      for (const id of elementIds) {
        const elem = document.getElementById(id) as any;
        if (elem && typeof elem.setSinkId === "function") {
          await elem.setSinkId(deviceId);
        }
      }
      return true;
    } catch (err) {
      console.warn("[MEDIA] Output device selection error:", err);
      return false;
    }
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
