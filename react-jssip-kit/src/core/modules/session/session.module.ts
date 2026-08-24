import { detachSessionListener } from "../../sip/session-listeners";
import type { StateAdapter } from "../../contracts/state";
import { CallStatus } from "../../contracts/state";
import type { JssipEventEmitter } from "../event/event-target.emitter";
import type {
  AnswerOptions,
  DTMFOptions,
  ExtraHeaders,
  JsSIPEventMap,
  RenegotiateOptions,
  ReferOptions,
  RTCSession,
  RTCSessionEvent,
  RTCSessionEventMap,
  TerminateOptions,
} from "../../sip/types";
import { createSessionHandlers } from "./session.handlers";
import type { SessionManager } from "./session.manager";
import {
  clearSessionsState,
  holdOtherSessions,
  removeSessionState,
} from "./session.state.projector";
import { SessionLifecycle } from "./session.lifecycle";
import type { MicRecoveryManager } from "../media/mic-recovery.manager";

type SessionModuleDeps = {
  state: StateAdapter;
  emitter: JssipEventEmitter<JsSIPEventMap>;
  sessionManager: SessionManager;
  micRecovery: MicRecoveryManager;
  getMaxSessionCount: () => number;
  getIceCandidateReadyDelayMs: () => number | undefined;
  getAutoIceRestart: () => boolean;
  getAutoIceRestartMaxAttempts: () => number;
  getAutoIceRestartDisconnectedDelayMs: () => number;
  getAutoIceRestartRetryDelayMs: () => number;
};

export class SessionModule {
  private sessionHandlers = new Map<string, Partial<RTCSessionEventMap>>();
  private lifecycle: SessionLifecycle;

  constructor(private readonly deps: SessionModuleDeps) {
    this.lifecycle = new SessionLifecycle({
      state: deps.state,
      sessionManager: deps.sessionManager,
      emit: (event, payload) => deps.emitter.emit(event, payload),
      attachSessionHandlers: (sessionId, session) =>
        this.attachSessionHandlers(sessionId, session),
      cleanupSession: (sessionId, session) =>
        this.cleanupSession(sessionId, session),
      getMaxSessionCount: deps.getMaxSessionCount,
    });
  }

  setDebugEnabled(enabled: boolean) {
    this.lifecycle.setDebugEnabled(enabled);
  }

  handleNewRTCSession(e: RTCSessionEvent) {
    this.lifecycle.handleNewRTCSession(e);
  }

  setSessionMedia(sessionId: string, stream: MediaStream) {
    this.deps.sessionManager.setSessionMedia(sessionId, stream);
  }

  setSession(sessionId: string, session: RTCSession) {
    this.deps.sessionManager.setSession(sessionId, session);
  }

  setPendingMedia(stream: MediaStream | null) {
    this.deps.sessionManager.setPendingMedia(stream);
  }

  answerSession(sessionId: string, options: AnswerOptions = {}) {
    if (!sessionId || !this.sessionExists(sessionId)) return false;
    if (options.mediaStream)
      this.setSessionMedia(sessionId, options.mediaStream);
    return this.deps.sessionManager.answer(sessionId, options);
  }

  hangupSession(sessionId: string, options?: TerminateOptions) {
    if (!sessionId || !this.sessionExists(sessionId)) return false;
    return this.deps.sessionManager.hangup(sessionId, options);
  }

  hangupAll(options?: TerminateOptions) {
    const ids = this.getSessionIds();
    if (ids.length === 0) return false;
    return ids.every((id) => this.hangupSession(id, options));
  }

  toggleMuteSession(sessionId?: string) {
    const resolved = this.resolveExistingSessionId(sessionId);
    if (!resolved) return false;
    const sessionState = this.deps.state.getState().sessionsById[resolved];
    const muted = sessionState?.muted ?? false;
    if (muted) {
      this.deps.sessionManager.unmute(resolved);
      return true;
    }
    this.deps.sessionManager.mute(resolved);
    return true;
  }

  toggleHoldSession(sessionId?: string) {
    const resolved = this.resolveExistingSessionId(sessionId);
    if (!resolved) return false;
    const sessionState = this.deps.state.getState().sessionsById[resolved];
    const isOnHold = sessionState?.status === CallStatus.Hold;
    if (isOnHold) {
      this.deps.sessionManager.unhold(resolved);
      return true;
    }
    if (sessionState?.status === CallStatus.Active) {
      this.deps.sessionManager.hold(resolved);
      return true;
    }
    return false;
  }

  sendDTMFSession(
    sessionId: string,
    tones: string | number,
    options?: DTMFOptions
  ) {
    const resolved = this.resolveExistingSessionId(sessionId);
    if (!resolved) return false;
    const sessionState = this.deps.state.getState().sessionsById[resolved];
    if (sessionState?.status === CallStatus.Active) {
      this.deps.sessionManager.sendDTMF(resolved, tones, options);
      return true;
    }
    return false;
  }

  attendedTransferSession(
    sessionId: string,
    replaceSessionId: string
  ): boolean {
    const resolvedA = this.resolveExistingSessionId(sessionId);
    const resolvedB = this.resolveExistingSessionId(replaceSessionId);
    if (!resolvedA || !resolvedB) return false;
    const sessionStateA = this.deps.state.getState().sessionsById[resolvedA];
    if (sessionStateA?.status !== CallStatus.Active) return false;
    const sessionB = this.deps.sessionManager.getSession(resolvedB);
    if (!sessionB) return false;
    return this.deps.sessionManager.attendedTransfer(resolvedA, sessionB);
  }

  transferSession(sessionId: string, target: string, options?: ReferOptions) {
    const resolved = this.resolveExistingSessionId(sessionId);
    if (!resolved) return false;
    const sessionState = this.deps.state.getState().sessionsById[resolved];
    if (sessionState?.status === CallStatus.Active) {
      this.deps.sessionManager.transfer(resolved, target, options);
      return true;
    }
    return false;
  }

  sendInfoSession(
    sessionId: string,
    contentType: string,
    body?: string,
    options?: ExtraHeaders
  ) {
    const resolved = this.resolveExistingSessionId(sessionId);
    if (!resolved) return false;
    const sessionState = this.deps.state.getState().sessionsById[resolved];
    if (
      sessionState?.status !== CallStatus.Active &&
      sessionState?.status !== CallStatus.Hold
    ) {
      return false;
    }
    const session = this.deps.sessionManager.getSession(resolved);
    if (!session) return false;
    session.sendInfo(contentType, body, options);
    return true;
  }

  updateSession(sessionId: string, options?: RenegotiateOptions) {
    const resolved = this.resolveExistingSessionId(sessionId);
    if (!resolved) return false;
    const sessionState = this.deps.state.getState().sessionsById[resolved];
    if (
      sessionState?.status !== CallStatus.Active &&
      sessionState?.status !== CallStatus.Hold
    ) {
      return false;
    }
    const session = this.deps.sessionManager.getSession(resolved);
    if (!session) return false;
    return session.renegotiate(options);
  }

  getSession(sessionId: string) {
    return this.deps.sessionManager.getSession(sessionId);
  }

  getSessionIds() {
    return this.deps.sessionManager.getSessionIds();
  }

  getSessions() {
    return this.deps.sessionManager.getSessions();
  }

  cleanupAllSessions() {
    // Detach JsSIP event handlers before clearing the session map so that
    // session.off() is called while sessions are still accessible (Fix 3).
    for (const [sessionId] of this.sessionHandlers) {
      const session = this.deps.sessionManager.getSession(sessionId);
      if (session) this.detachSessionHandlers(sessionId, session);
    }
    this.lifecycle.cleanupAllCallStats();
    this.lifecycle.cleanupAllAudioBindings();
    this.lifecycle.releaseAllIncomingSessions();
    this.deps.sessionManager.cleanupAllSessions();
    this.deps.micRecovery.cleanupAll();
    this.sessionHandlers.clear();
    clearSessionsState(this.deps.state);
  }

  public cleanupSessionById(sessionId: string) {
    this.cleanupSession(sessionId);
  }

  private attachSessionHandlers(sessionId: string, session: RTCSession) {
    const handlers = this.createSessionHandlersFor(sessionId, session);
    this.sessionHandlers.set(sessionId, handlers);

    (Object.keys(handlers) as (keyof RTCSessionEventMap)[]).forEach((ev) => {
      const h = handlers[ev];
      if (h) session.on(ev, h);
    });
  }

  private detachSessionHandlers(sessionId: string, session: RTCSession) {
    const handlers = this.sessionHandlers.get(sessionId);
    if (!handlers || !session) return;
    try {
      (Object.keys(handlers) as (keyof RTCSessionEventMap)[]).forEach((ev) => {
        const h = handlers[ev];
        if (!h) return;
        try {
          detachSessionListener(session, ev, h);
        } catch (error) {
          console.error(
            "[react-jssip-kit] session handler detach failed",
            error
          );
        }
      });
    } finally {
      this.sessionHandlers.delete(sessionId);
    }
  }

  private cleanupSession(sessionId: string, session?: RTCSession) {
    this.lifecycle.cleanupCallStats(sessionId); // Fix 4: remove stats listeners
    this.lifecycle.cleanupAudioBinding(sessionId);
    this.lifecycle.releaseIncomingSession(sessionId);
    const targetSession =
      session ??
      this.deps.sessionManager.getSession(sessionId) ??
      this.deps.sessionManager.getRtc(sessionId)?.currentSession;
    if (targetSession) {
      this.detachSessionHandlers(sessionId, targetSession);
    }
    this.deps.micRecovery.disable(sessionId);
    this.deps.sessionManager.cleanupSession(sessionId);
    removeSessionState(this.deps.state, sessionId);
  }

  private createSessionHandlersFor(
    sessionId: string,
    session: RTCSession
  ): Partial<RTCSessionEventMap> {
    return createSessionHandlers({
      emitter: this.deps.emitter,
      state: this.deps.state,
      cleanupSession: () => this.cleanupSession(sessionId, session),
      enableMicrophoneRecovery: (confirmedSessionId) =>
        this.deps.micRecovery.enable(confirmedSessionId),
      holdOtherActiveSessions: () =>
        holdOtherSessions(this.deps.state, sessionId, (id) =>
          this.deps.sessionManager.getRtc(id)?.hold()
        ),
      iceCandidateReadyDelayMs: this.deps.getIceCandidateReadyDelayMs(),
      autoIceRestart: this.deps.getAutoIceRestart(),
      autoIceRestartMaxAttempts: this.deps.getAutoIceRestartMaxAttempts(),
      autoIceRestartDisconnectedDelayMs:
        this.deps.getAutoIceRestartDisconnectedDelayMs(),
      autoIceRestartRetryDelayMs:
        this.deps.getAutoIceRestartRetryDelayMs(),
      restartIce: () => session.renegotiate({ iceRestart: true }),
      sessionId,
    });
  }

  private resolveSessionId(sessionId?: string) {
    if (sessionId) return sessionId;
    const state = this.deps.state.getState();
    const activeId = state.sessionIds.find(
      (id) => state.sessionsById[id]?.status === CallStatus.Active
    );
    return activeId ?? state.sessionIds[0] ?? null;
  }

  private sessionExists(sessionId: string) {
    return (
      !!this.deps.sessionManager.getSession(sessionId) ||
      !!this.deps.sessionManager.getRtc(sessionId)
    );
  }

  private resolveExistingSessionId(sessionId?: string) {
    const id = this.resolveSessionId(sessionId);
    if (!id) return null;
    return this.sessionExists(id) ? id : null;
  }
}
