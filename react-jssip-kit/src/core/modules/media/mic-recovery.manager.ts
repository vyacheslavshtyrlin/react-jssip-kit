import type { RTCSession } from "../../sip/types";
import type { WebRTCSessionController } from "./webrtc-session.controller";
import { sipDebugLogger } from "../debug/sip-debug.logger";

export type MicrophoneRecoveryOptions = {
  intervalMs?: number;
  maxRetries?: number;
};

type MicRecoveryDeps = {
  getRtc: (sessionId: string) => WebRTCSessionController | null;
  getSession: (sessionId: string) => RTCSession | null;
  getSessionState: (sessionId: string) => { muted?: boolean } | undefined;
  setSessionMedia: (sessionId: string, stream: MediaStream) => void;
  onDrop: (sessionId: string, trackLive: boolean, senderLive: boolean) => void;
};

type MicRecoveryConfig = {
  enabled?: boolean;
  intervalMs?: number;
  maxRetries?: number;
};

export class MicRecoveryManager {
  private enabled = false;
  private defaults: Required<MicrophoneRecoveryOptions> = {
    intervalMs: 2000,
    maxRetries: Infinity,
  };
  private active = new Map<string, { stop: () => void }>();
  private syncedSenderTrackId = new Map<string, string>();
  private readonly deps: MicRecoveryDeps;

  constructor(deps: MicRecoveryDeps) {
    this.deps = deps;
  }

  validateConfig(config: MicRecoveryConfig) {
    if (
      config.intervalMs != null &&
      (!Number.isFinite(config.intervalMs) || config.intervalMs <= 0)
    ) {
      throw new RangeError(
        "micRecoveryIntervalMs must be a finite positive number"
      );
    }
    if (
      config.maxRetries != null &&
      config.maxRetries !== Infinity &&
      (!Number.isSafeInteger(config.maxRetries) || config.maxRetries < 0)
    ) {
      throw new RangeError(
        "micRecoveryMaxRetries must be a non-negative integer or Infinity"
      );
    }
  }

  configure(config: MicRecoveryConfig) {
    this.validateConfig(config);
    if (typeof config.enabled === "boolean") {
      this.enabled = config.enabled;
    }
    if (typeof config.intervalMs === "number") {
      this.defaults.intervalMs = config.intervalMs;
    }
    if (typeof config.maxRetries === "number") {
      this.defaults.maxRetries = config.maxRetries;
    }
  }

  enable(
    sessionId: string,
    options: MicrophoneRecoveryOptions = {}
  ): () => void {
    if (!this.enabled) return () => {};
    this.validateConfig(options);

    this.disable(sessionId);

    const intervalMs = options.intervalMs ?? this.defaults.intervalMs;
    const maxRetries = options.maxRetries ?? this.defaults.maxRetries;
    let retries = 0;
    let stopped = false;
    const startedAt = Date.now();
    const warmupMs = Math.max(intervalMs * 2, 2000);

    const runTick = async () => {
      if (stopped || retries >= maxRetries) return;

      const rtc = this.deps.getRtc(sessionId);
      const session = this.deps.getSession(sessionId);
      if (!rtc || !session) return;

      const sessionState = this.deps.getSessionState(sessionId);
      if (sessionState?.muted) return;

      const stream = rtc.mediaStream;
      const track = stream?.getAudioTracks?.()[0];
      const pc: RTCPeerConnection | undefined = (session as any)?.connection;
      const sender = pc
        ?.getSenders?.()
        ?.find((s: RTCRtpSender) => s.track?.kind === "audio");

      if (!track && !sender) return;
      if (!track && sender?.track?.readyState === "live") {
        const nextId = sender.track.id;
        const prevId = this.syncedSenderTrackId.get(sessionId);
        if (prevId === nextId) return;
        this.syncedSenderTrackId.set(sessionId, nextId);
        this.deps.setSessionMedia(sessionId, new MediaStream([sender.track]));
        return;
      }

      if (Date.now() - startedAt < warmupMs) return;
      if (
        pc?.connectionState === "new" ||
        pc?.connectionState === "connecting" ||
        pc?.iceConnectionState === "new" ||
        pc?.iceConnectionState === "checking"
      ) {
        return;
      }

      const trackLive = track?.readyState === "live";
      const senderLive = sender?.track?.readyState === "live";
      if (trackLive && senderLive) return;

      sipDebugLogger.logMicRecoveryDrop({
        sessionId,
        trackLive,
        senderLive,
      });
      this.deps.onDrop(sessionId, trackLive, senderLive);
      if (stopped) return;

      retries += 1;
      if (trackLive && !senderLive && track) {
        await rtc.replaceAudioTrack(track);
        return;
      }

      // No internal getUserMedia request path in library.
      // If both track and sender are not live, recovery stops here.
    };

    let tickInFlight = false;
    const tick = () => {
      if (stopped || tickInFlight || retries >= maxRetries) return;
      tickInFlight = true;
      void runTick()
        .catch((error) => {
          console.error("[react-jssip-kit] microphone recovery failed", error);
        })
        .finally(() => {
          tickInFlight = false;
        });
    };

    const timer = setInterval(() => {
      tick();
    }, intervalMs);

    const session = this.deps.getSession(sessionId);
    let trackedPc: RTCPeerConnection | undefined = (session as any)?.connection;

    const onIceChange = () => {
      const state = trackedPc?.iceConnectionState;
      if (state === "failed" || state === "disconnected") tick();
    };

    const attachIceListener = (newPc: RTCPeerConnection | undefined) => {
      if (trackedPc === newPc) return;
      trackedPc?.removeEventListener?.("iceconnectionstatechange", onIceChange);
      trackedPc = newPc;
      newPc?.addEventListener?.("iceconnectionstatechange", onIceChange);
    };

    const onPeerConnection = (data: { peerconnection: RTCPeerConnection }) => {
      attachIceListener(data.peerconnection);
    };

    (session as any)?.on?.("peerconnection", onPeerConnection);
    trackedPc?.addEventListener?.("iceconnectionstatechange", onIceChange);

    // Immediate dead-track check — bypasses warmup.
    // Catches tracks that died at or just before confirmed.
    const rtcNow = this.deps.getRtc(sessionId);
    const initialTrack = rtcNow?.mediaStream?.getAudioTracks?.()[0] ?? null;

    // Real-time detection via track.ended — no need to wait for poll interval.
    const onTrackEnded = () => {
      if (stopped) return;
      const sessionState = this.deps.getSessionState(sessionId);
      if (sessionState?.muted) return;
      this.deps.onDrop(sessionId, false, false);
    };
    initialTrack?.addEventListener?.("ended", onTrackEnded, { once: true });

    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      trackedPc?.removeEventListener?.("iceconnectionstatechange", onIceChange);
      try {
        (session as any)?.off?.("peerconnection", onPeerConnection);
      } catch (error) {
        console.error(
          "[react-jssip-kit] microphone recovery cleanup failed",
          error
        );
      }
      initialTrack?.removeEventListener?.("ended", onTrackEnded);
    };
    this.active.set(sessionId, { stop });
    if (initialTrack && initialTrack.readyState !== "live") {
      this.deps.onDrop(sessionId, false, false);
    }
    tick();
    return stop;
  }

  disable(sessionId: string) {
    const entry = this.active.get(sessionId);
    if (!entry) return false;
    try {
      entry.stop();
    } finally {
      this.active.delete(sessionId);
      this.syncedSenderTrackId.delete(sessionId);
    }
    return true;
  }

  cleanupAll() {
    for (const sessionId of Array.from(this.active.keys())) {
      this.disable(sessionId);
    }
  }
}
