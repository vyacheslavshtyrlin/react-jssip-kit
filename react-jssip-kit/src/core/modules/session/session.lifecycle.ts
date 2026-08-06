import type { StateAdapter } from "../../contracts/state";
import { CallStatus } from "../../contracts/state";
import type { SessionManager } from "./session.manager";
import {
  holdOtherSessions,
  upsertSessionState,
} from "./session.state.projector";
import type {
  JsSIPEventName,
  JsSIPEventPayload,
  RTCSession,
  RTCSessionEvent,
  RTCSessionEventMap,
  TerminateOptions,
} from "../../sip/types";
import { sipDebugLogger } from "../debug/sip-debug.logger";
import { createAudioBindRetry } from "./audio-bind.retry";

type Deps = {
  state: StateAdapter;
  sessionManager: SessionManager;
  emit: <K extends JsSIPEventName>(
    event: K,
    payload?: JsSIPEventPayload<K>
  ) => void;
  attachSessionHandlers: (sessionId: string, session: RTCSession) => void;
  cleanupSession: (sessionId: string, session: RTCSession) => void;
  getMaxSessionCount: () => number;
};

export class SessionLifecycle {
  private readonly state: StateAdapter;
  private readonly sessionManager: SessionManager;
  private readonly emit: Deps["emit"];
  private readonly attachSessionHandlers: Deps["attachSessionHandlers"];
  private readonly cleanupSession: Deps["cleanupSession"];
  private readonly getMaxSessionCount: Deps["getMaxSessionCount"];
  private readonly incomingSessionIds = new Set<string>();
  private readonly audioBindingCleanups = new Map<string, () => void>();

  constructor(deps: Deps) {
    this.state = deps.state;
    this.sessionManager = deps.sessionManager;
    this.emit = deps.emit;
    this.attachSessionHandlers = deps.attachSessionHandlers;
    this.cleanupSession = deps.cleanupSession;
    this.getMaxSessionCount = deps.getMaxSessionCount;
  }

  public setDebugEnabled(enabled: boolean) {
    sipDebugLogger.setEnabled(enabled);
  }

  handleNewRTCSession(e: RTCSessionEvent) {
    const session = e.session;
    const sessionId = String(
      session.id ??
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random()}`
    );

    if (e.originator === "remote" && !this.reserveIncomingSession(sessionId)) {
      this.rejectSession(session, 486, "Busy Here", true);
      return;
    }

    try {
      const rtc = this.sessionManager.getOrCreateRtc(sessionId, session);
      this.sessionManager.setSession(sessionId, session);
      this.attachSessionHandlers(sessionId, session);
      this.attachCallStatsLogging(sessionId, session);

      if (e.originator === "local" && !rtc.mediaStream) {
        this.bindLocalOutgoingAudio(sessionId, session);
      }
      if (e.originator === "remote") {
        this.bindRemoteIncomingAudio(sessionId, session);
      }

      holdOtherSessions(this.state, sessionId, (id) => {
        const otherRtc = this.sessionManager.getRtc(id);
        otherRtc?.hold();
      });

      upsertSessionState(this.state, sessionId, {
        direction: e.originator,
        from: e.originator === "remote" ? e.request.from.uri.user : null,
        to: e.request.to.uri.user,
        status:
          e.originator === "remote" ? CallStatus.Ringing : CallStatus.Dialing,
        headers: this.extractSipHeaders(e.request),
      });

      this.emit("newRTCSession", e);
    } catch (error) {
      this.releaseIncomingSession(sessionId);
      try {
        this.cleanupSession(sessionId, session);
      } catch (cleanupError) {
        console.error(
          "[react-jssip-kit] session rollback failed",
          cleanupError
        );
      }
      if (e.originator === "remote") {
        this.rejectSession(session, 500, "Internal Error");
        return;
      }
      throw error;
    }
  }

  public releaseIncomingSession(sessionId: string) {
    this.incomingSessionIds.delete(sessionId);
  }

  public releaseAllIncomingSessions() {
    this.incomingSessionIds.clear();
  }

  private reserveIncomingSession(sessionId: string) {
    if (this.incomingSessionIds.has(sessionId)) return true;
    if (this.incomingSessionIds.size >= this.getMaxSessionCount()) return false;
    this.incomingSessionIds.add(sessionId);
    return true;
  }

  private rejectSession(
    session: RTCSession,
    statusCode: number,
    reasonPhrase: string,
    forwardFailed = false
  ) {
    let cleanupFailedListener: (() => void) | undefined;
    if (forwardFailed) {
      const onFailed: RTCSessionEventMap["failed"] = (failedEvent) => {
        cleanupFailedListener?.();
        this.emit("failed", failedEvent);
      };

      cleanupFailedListener = () => {
        cleanupFailedListener = undefined;
        try {
          session.off("failed", onFailed);
        } catch (error) {
          console.error(
            "[react-jssip-kit] failed listener detach failed",
            error
          );
        }
      };

      try {
        session.on("failed", onFailed);
      } catch (error) {
        cleanupFailedListener();
        console.error("[react-jssip-kit] failed listener attach failed", error);
      }
    }

    try {
      const terminateOptions: TerminateOptions = {
        status_code: statusCode,
        reason_phrase: reasonPhrase,
      };
      session.terminate(terminateOptions);
    } catch (error) {
      cleanupFailedListener?.();
      console.error("[react-jssip-kit] session rejection failed", error);
    }
  }

  private bindLocalOutgoingAudio(sessionId: string, session: RTCSession) {
    const stopRetry = createAudioBindRetry({
      session,
      tryBind: (pc) => {
        // Already bound externally or from a previous attempt — signal success.
        if (this.sessionManager.getRtc(sessionId)?.mediaStream) return true;
        if (!pc) return false;
        const audioSender = pc
          .getSenders?.()
          ?.find((s: RTCRtpSender) => s.track?.kind === "audio");
        const audioTrack = audioSender?.track;
        if (!audioTrack) {
          sipDebugLogger.logLocalAudioError(
            sessionId,
            "[sip] outgoing audio bind failed: no audio track",
            pc
          );
          return false;
        }
        const outgoingStream = new MediaStream([audioTrack]);
        this.sessionManager.setSessionMedia(sessionId, outgoingStream);
        return true;
      },
      onExhausted: (pc, attempts) => {
        sipDebugLogger.logLocalAudioError(
          sessionId,
          "[sip] outgoing audio bind failed: max retries reached",
          pc,
          { attempts }
        );
      },
    });
    this.setAudioBindingCleanup(sessionId, stopRetry);
  }

  private bindRemoteIncomingAudio(sessionId: string, session: RTCSession) {
    let attachedTrack: MediaStreamTrack | null = null;

    const onRemoteEnded = () => {
      sipDebugLogger.logRemoteAudioError(
        sessionId,
        "[sip] incoming audio track ended",
        null
      );
    };
    const onRemoteMuted = () => {
      sipDebugLogger.logRemoteAudioError(
        sessionId,
        "[sip] incoming audio track muted",
        null
      );
    };

    const attachTrackListeners = (track: MediaStreamTrack) => {
      if (track === attachedTrack) return;
      if (attachedTrack) {
        attachedTrack.removeEventListener("ended", onRemoteEnded);
        attachedTrack.removeEventListener("mute", onRemoteMuted);
      }
      attachedTrack = track;
      track.addEventListener("ended", onRemoteEnded);
      track.addEventListener("mute", onRemoteMuted);
    };

    const detachTrackListeners = () => {
      if (!attachedTrack) return;
      attachedTrack.removeEventListener("ended", onRemoteEnded);
      attachedTrack.removeEventListener("mute", onRemoteMuted);
      attachedTrack = null;
    };

    const stopRetry = createAudioBindRetry({
      session,
      listenPcTrackEvent: true,
      tryBind: (pc) => {
        if (!pc) return false;
        const receiver = pc
          .getReceivers?.()
          ?.find((r: RTCRtpReceiver) => r.track?.kind === "audio");
        const track = receiver?.track ?? null;
        if (!track) return false;
        attachTrackListeners(track);
        if (track.readyState !== "live") {
          sipDebugLogger.logRemoteAudioError(
            sessionId,
            "[sip] incoming audio track not live",
            pc,
            { trackState: track.readyState }
          );
          return false;
        }
        return true;
      },
      onStop: (bound) => {
        // Keep track listeners active after successful bind (diagnostic monitoring).
        // Remove them only on failure / cleanup.
        if (!bound) detachTrackListeners();
      },
      onExhausted: (pc, attempts) => {
        sipDebugLogger.logRemoteAudioError(
          sessionId,
          "[sip] incoming audio bind failed: max retries reached",
          pc,
          { attempts }
        );
      },
      onConfirmedMiss: (pc) => {
        sipDebugLogger.logRemoteAudioError(
          sessionId,
          "[sip] incoming audio bind failed: no remote track",
          pc,
          { note: "confirmed without remote track" }
        );
      },
    });
    this.setAudioBindingCleanup(sessionId, () => {
      stopRetry();
      detachTrackListeners();
    });
  }

  private setAudioBindingCleanup(sessionId: string, cleanup: () => void) {
    this.cleanupAudioBinding(sessionId);
    this.audioBindingCleanups.set(sessionId, cleanup);
  }

  public cleanupAudioBinding(sessionId: string) {
    const cleanup = this.audioBindingCleanups.get(sessionId);
    try {
      cleanup?.();
    } catch (error) {
      console.error("[react-jssip-kit] audio binding cleanup failed", error);
    } finally {
      this.audioBindingCleanups.delete(sessionId);
    }
  }

  public cleanupAllAudioBindings() {
    for (const sessionId of Array.from(this.audioBindingCleanups.keys())) {
      this.cleanupAudioBinding(sessionId);
    }
  }

  private callStatsCleanups = new Map<string, () => void>();

  private attachCallStatsLogging(sessionId: string, session: RTCSession) {
    const onConfirmed = () => {
      sipDebugLogger.startCallStatsLogging(sessionId, session);
    };
    const onEnd = () => {
      sipDebugLogger.stopCallStatsLogging(sessionId);
    };

    const cleanup = () => {
      const listeners = [
        ["confirmed", onConfirmed],
        ["ended", onEnd],
        ["failed", onEnd],
      ] as const;
      listeners.forEach(([event, handler]) => {
        try {
          session.off?.(event, handler);
        } catch (error) {
          console.error(
            "[react-jssip-kit] call stats listener detach failed",
            error
          );
        }
      });
    };
    this.callStatsCleanups.set(sessionId, cleanup);
    try {
      session.on?.("confirmed", onConfirmed);
      session.on?.("ended", onEnd);
      session.on?.("failed", onEnd);
    } catch (error) {
      this.cleanupCallStats(sessionId);
      throw error;
    }
  }

  public cleanupCallStats(sessionId: string) {
    const cleanup = this.callStatsCleanups.get(sessionId);
    try {
      cleanup?.();
    } catch (error) {
      console.error("[react-jssip-kit] call stats cleanup failed", error);
    } finally {
      this.callStatsCleanups.delete(sessionId);
    }
  }

  public cleanupAllCallStats() {
    this.callStatsCleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch (error) {
        console.error("[react-jssip-kit] call stats cleanup failed", error);
      }
    });
    this.callStatsCleanups.clear();
  }

  private extractSipHeaders(request: unknown): Record<string, string> {
    // JsSIP does not expose a typed headers map — access via cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = request as any;
    const headerMap = req?.headers as Record<string, unknown[]> | undefined;
    if (!headerMap || typeof headerMap !== "object") return {};
    const result: Record<string, string> = {};
    for (const name of Object.keys(headerMap)) {
      const value = req.getHeader?.(name) as string | undefined;
      if (value != null) {
        result[name.toLowerCase()] = value;
      }
    }
    return result;
  }
}
