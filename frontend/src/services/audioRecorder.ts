import { api } from "../api/client";

export interface RecordingResult {
  status: string;
  recording_id?: string;
  call_id?: string;
  public_id?: string;
  secure_url?: string;
  filename?: string;
  file_size_bytes?: number;
  duration?: number;
  storage_provider?: string;
}

class AudioRecorderService {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private activeStream: MediaStream | null = null;
  private isOwnStream = false;
  private isRecording = false;
  private currentCallId: string | null = null;
  private mimeType: string = "audio/webm";
  private uploadLocks: Set<string> = new Set();
  private completedUploads: Map<string, RecordingResult> = new Map();
  private activeUploadPromises: Map<string, Promise<RecordingResult | null>> = new Map();

  /**
   * Determine the best supported audio MIME type across browsers.
   */
  private getSupportedMimeType(): string {
    if (typeof window === "undefined" || !window.MediaRecorder) {
      return "audio/webm";
    }

    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/mp4",
      "audio/aac",
      "audio/wav",
    ];

    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return "";
  }

  /**
   * Determine filename extension from MIME type.
   */
  private getExtensionFromMime(mime: string): string {
    const m = (mime || "").toLowerCase();
    if (m.includes("wav")) return "wav";
    if (m.includes("ogg") || m.includes("opus")) return "ogg";
    if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "mp4";
    if (m.includes("mp3") || m.includes("mpeg")) return "mp3";
    return "webm";
  }

  /**
   * Mix local agent audio and remote customer audio into a single composite MediaStream.
   */
  private createMixedAudioStream(localStream?: MediaStream | null, remoteStream?: MediaStream | null): MediaStream | null {
    const hasLocal = localStream && localStream.getAudioTracks().length > 0;
    const hasRemote = remoteStream && remoteStream.getAudioTracks().length > 0;

    if (hasLocal && hasRemote) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioCtx = new AudioContextClass();
          const destination = audioCtx.createMediaStreamDestination();

          const localSource = audioCtx.createMediaStreamSource(localStream);
          const remoteSource = audioCtx.createMediaStreamSource(remoteStream);

          localSource.connect(destination);
          remoteSource.connect(destination);

          console.log("[AUDIO RECORDER] Successfully mixed local microphone and customer remote audio streams.");
          return destination.stream;
        }
      } catch (mixErr) {
        console.warn("[AUDIO RECORDER] AudioContext mixing fallback to remote/local stream:", mixErr);
      }
    }

    if (hasRemote) return remoteStream;
    if (hasLocal) return localStream;
    return null;
  }

  /**
   * Starts audio recording for an active call session.
   */
  public async startRecording(stream?: MediaStream | null, callId?: string, remoteStream?: MediaStream | null): Promise<boolean> {
    if (this.isRecording && this.currentCallId === callId) {
      console.log(`[RECORDING] already active for callId: ${callId}`);
      return true;
    }

    // If another recording is active, stop it cleanly first
    if (this.isRecording) {
      try {
        await this.stopRecording();
      } catch (err) {
        console.warn("[AUDIO RECORDER] Cleaned previous active recording session:", err);
      }
    }

    this.currentCallId = callId || `call_${Date.now()}`;
    this.recordedChunks = [];
    this.isOwnStream = false;

    try {
      let targetStream = this.createMixedAudioStream(stream, remoteStream);

      if (!targetStream || targetStream.getAudioTracks().length === 0) {
        if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
          targetStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          this.isOwnStream = true;
        }
      }

      if (!targetStream || targetStream.getAudioTracks().length === 0) {
        console.warn("[AUDIO RECORDER] No live audio tracks available for MediaRecorder.");
        return false;
      }

      this.activeStream = targetStream;
      this.mimeType = this.getSupportedMimeType();

      const options: MediaRecorderOptions = this.mimeType ? { mimeType: this.mimeType } : {};
      this.mediaRecorder = new MediaRecorder(targetStream, options);

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
          console.log(`[RECORDING] chunkCount: ${this.recordedChunks.length} | chunkSize: ${event.data.size} bytes`);
        }
      };

      this.mediaRecorder.onerror = (event: any) => {
        console.error("[AUDIO RECORDER ERROR]", event.error || event);
      };

      // Request continuous time slices (250ms) to ensure all audio buffers are flushed reliably
      this.mediaRecorder.start(250);
      this.isRecording = true;

      console.log(`[RECORDING] started: true | callId: ${this.currentCallId} | mimeType: ${this.mimeType || "default"}`);
      return true;
    } catch (err) {
      console.error(`[AUDIO RECORDER ERROR] Failed to start MediaRecorder for call ${this.currentCallId}:`, err);
      this.isRecording = false;
      this.mediaRecorder = null;
      return false;
    }
  }

  /**
   * Stops recording and returns the complete, non-empty audio Blob.
   * Resolves ONLY when onstop has fully fired and all chunks are flushed.
   */
  public stopRecording(): Promise<{ blob: Blob; mimeType: string; extension: string } | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive" || !this.isRecording) {
        this.isRecording = false;
        if (this.recordedChunks.length > 0) {
          const blob = new Blob(this.recordedChunks, { type: this.mimeType || "audio/webm" });
          console.log(`[RECORDING] finalBlobSize: ${blob.size} bytes | finalBlobType: ${blob.type}`);
          resolve({ blob, mimeType: this.mimeType, extension: this.getExtensionFromMime(this.mimeType) });
        } else {
          resolve(null);
        }
        return;
      }

      const recorder = this.mediaRecorder;
      const callId = this.currentCallId;

      recorder.onstop = () => {
        this.isRecording = false;

        // Stop own stream tracks to release microphone hardware
        if (this.isOwnStream && this.activeStream) {
          try {
            this.activeStream.getTracks().forEach((t) => t.stop());
          } catch (e) {
            console.warn("[AUDIO RECORDER] Error stopping mic tracks:", e);
          }
          this.activeStream = null;
        }

        if (this.recordedChunks.length === 0) {
          console.warn(`[RECORDING] No audio chunks collected for call ${callId}`);
          resolve(null);
          return;
        }

        const finalMime = this.mimeType || recorder.mimeType || "audio/webm";
        const completeBlob = new Blob(this.recordedChunks, { type: finalMime });
        const ext = this.getExtensionFromMime(finalMime);

        console.log(`[RECORDING] chunkCount: ${this.recordedChunks.length} | finalBlobSize: ${completeBlob.size} bytes | finalBlobType: ${finalMime}`);

        resolve({
          blob: completeBlob,
          mimeType: finalMime,
          extension: ext,
        });
      };

      try {
        recorder.requestData();
        recorder.stop();
      } catch (err) {
        console.warn("[AUDIO RECORDER] Exception stopping recorder, forcing stop:", err);
        try {
          recorder.stop();
        } catch (_) {}
      }
    });
  }

  /**
   * Uploads the recorded audio Blob to backend -> Cloudinary.
   * Enforces exactly-once execution per call ID.
   */
  public async uploadRecording(
    callId: string,
    blob: Blob,
    durationSeconds: number = 0,
    metadata?: Record<string, any>
  ): Promise<RecordingResult | null> {
    if (!callId) {
      console.error("[AUDIO RECORDER] Missing call_id for recording upload.");
      return null;
    }

    // Return cached upload if already completed
    if (this.completedUploads.has(callId)) {
      console.log(`[AUDIO RECORDER] Call ${callId} already uploaded, returning cached result.`);
      return this.completedUploads.get(callId)!;
    }

    // Return existing active upload promise to avoid race condition duplicates
    if (this.activeUploadPromises.has(callId)) {
      console.log(`[AUDIO RECORDER] Upload already in progress for call ${callId}, awaiting existing promise.`);
      return this.activeUploadPromises.get(callId)!;
    }

    if (!blob || blob.size === 0) {
      console.warn(`[RECORDING] Skipping upload for call ${callId}: Blob is empty (0 bytes).`);
      return null;
    }

    const uploadPromise = (async () => {
      this.uploadLocks.add(callId);
      const ext = this.getExtensionFromMime(blob.type);
      const filename = `recording_${callId}_${Date.now()}.${ext}`;

      console.log(`[UPLOAD] callId: ${callId} | requestStarted: true | finalBlobSize: ${blob.size} bytes | mimeType: ${blob.type} | filename: ${filename}`);

      const formData = new FormData();
      formData.append("file", blob, filename);
      formData.append("call_id", callId);
      formData.append("duration_seconds", String(Math.max(0, Math.round(durationSeconds))));

      if (metadata) {
        if (metadata.lead_id) formData.append("lead_id", String(metadata.lead_id));
        if (metadata.agent_id) formData.append("agent_id", String(metadata.agent_id));
        if (metadata.outcome) formData.append("outcome", String(metadata.outcome));
        if (metadata.notes) formData.append("notes", String(metadata.notes));
        if (metadata.ai_summary) formData.append("ai_summary", String(metadata.ai_summary));
        if (metadata.transcript) formData.append("transcript", String(metadata.transcript));
      }

      try {
        const response: RecordingResult = await api.upload("/api/recordings/upload", formData);

        if (!response || !response.secure_url) {
          throw new Error("Backend response missing Cloudinary secure_url");
        }

        console.log(`[UPLOAD] callId: ${callId} | responseStatus: 200 | uploadCompleted: true | secureUrl: ${response.secure_url} | publicId: ${response.public_id}`);

        this.completedUploads.set(callId, response);
        return response;
      } catch (err: any) {
        console.error(`[AUDIO RECORDER ERROR] Failed to upload recording for call ${callId}:`, err);
        return null;
      } finally {
        this.activeUploadPromises.delete(callId);
      }
    })();

    this.activeUploadPromises.set(callId, uploadPromise);
    return uploadPromise;
  }

  /**
   * Finalizes active recording and uploads to Cloudinary in a single coordinated atomic operation.
   */
  public async stopAndUpload(
    callId: string,
    durationSeconds: number = 0,
    metadata?: Record<string, any>
  ): Promise<RecordingResult | null> {
    const effectiveCallId = callId || this.currentCallId;
    if (!effectiveCallId) {
      console.warn("[AUDIO RECORDER] No active callId to stop and upload.");
      return null;
    }

    const recData = await this.stopRecording();
    if (!recData || !recData.blob || recData.blob.size === 0) {
      console.warn(`[AUDIO RECORDER] No audio recorded for call ${effectiveCallId}.`);
      return null;
    }

    return this.uploadRecording(effectiveCallId, recData.blob, durationSeconds, metadata);
  }

  /**
   * Status check
   */
  public getRecordingState(): { isRecording: boolean; callId: string | null; chunks: number } {
    return {
      isRecording: this.isRecording,
      callId: this.currentCallId,
      chunks: this.recordedChunks.length,
    };
  }
}

export const audioRecorder = new AudioRecorderService();
