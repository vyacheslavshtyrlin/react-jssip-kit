import { afterEach, describe, expect, it, vi } from "vitest";
import type { RTCSessionEvent } from "../../../sip/types";
import type { RTCSession } from "../../../sip/types";
import { CallStatus, type SipSessionState } from "../../../contracts/state";
import type { JssipEventEmitter } from "../../event/event-target.emitter";
import type { MicRecoveryManager } from "../../media/mic-recovery.manager";
import { SipStateStore } from "../../state/sip.state.store";
import type { JsSIPEventMap } from "../../../sip/types";
import { SessionModule } from "../session.module";
import type { SessionManager } from "../session.manager";

type Listener = (...args: unknown[]) => void;

class FakePeerConnection extends EventTarget {
  iceConnectionState: RTCIceConnectionState = "new";
}

class FakeSession {
  readonly id: string;
  connection?: RTCPeerConnection;
  readonly answer = vi.fn();
  readonly terminate = vi.fn();
  readonly mute = vi.fn();
  readonly unmute = vi.fn();
  readonly hold = vi.fn();
  readonly unhold = vi.fn();
  readonly sendDTMF = vi.fn();
  readonly refer = vi.fn();
  readonly sendInfo = vi.fn();
  readonly renegotiate = vi.fn(() => true);
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(id: string) {
    this.id = id;
  }

  on(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of Array.from(this.listeners.get(event) ?? [])) {
      listener(...args);
    }
  }

  listenerCount(): number {
    return Array.from(this.listeners.values()).reduce(
      (count, listeners) => count + listeners.size,
      0
    );
  }
}

type FakeRtc = {
  currentSession: RTCSession | null;
  mediaStream: MediaStream | null;
  hold: ReturnType<typeof vi.fn>;
};

class FakeSessionManager {
  readonly sessions = new Map<string, RTCSession>();
  readonly rtcs = new Map<string, FakeRtc>();
  answerResult = true;
  hangupResults = new Map<string, boolean>();
  attendedTransferResult = true;

  readonly getOrCreateRtc = vi.fn((sessionId: string, session?: RTCSession) => {
    let rtc = this.rtcs.get(sessionId);
    if (!rtc) {
      rtc = {
        currentSession: session ?? null,
        mediaStream: {} as MediaStream,
        hold: vi.fn(),
      };
      this.rtcs.set(sessionId, rtc);
    }
    if (session) rtc.currentSession = session;
    return rtc;
  });
  readonly setSession = vi.fn((sessionId: string, session: RTCSession) => {
    this.sessions.set(sessionId, session);
    this.getOrCreateRtc(sessionId, session);
  });
  readonly setSessionMedia = vi.fn();
  readonly setPendingMedia = vi.fn();
  readonly getSession = vi.fn(
    (sessionId: string) => this.sessions.get(sessionId) ?? null
  );
  readonly getRtc = vi.fn(
    (sessionId: string) => this.rtcs.get(sessionId) ?? null
  );
  readonly getSessionIds = vi.fn(() => Array.from(this.sessions.keys()));
  readonly getSessions = vi.fn(() =>
    Array.from(this.sessions, ([id, session]) => ({ id, session }))
  );
  readonly getLiveSessionCount = vi.fn(() => this.sessions.size);
  readonly answer = vi.fn(() => this.answerResult);
  readonly hangup = vi.fn(
    (sessionId: string) => this.hangupResults.get(sessionId) ?? true
  );
  readonly mute = vi.fn(() => true);
  readonly unmute = vi.fn(() => true);
  readonly hold = vi.fn(() => true);
  readonly unhold = vi.fn(() => true);
  readonly sendDTMF = vi.fn(() => true);
  readonly transfer = vi.fn(() => true);
  readonly attendedTransfer = vi.fn(() => this.attendedTransferResult);
  readonly cleanupSession = vi.fn((sessionId: string) => {
    this.sessions.delete(sessionId);
    this.rtcs.delete(sessionId);
  });
  readonly cleanupAllSessions = vi.fn(() => {
    this.sessions.clear();
    this.rtcs.clear();
  });

  add(sessionId: string, session: RTCSession): void {
    this.sessions.set(sessionId, session);
    this.rtcs.set(sessionId, {
      currentSession: session,
      mediaStream: {} as MediaStream,
      hold: vi.fn(),
    });
  }
}

const asRtcSession = (session: FakeSession): RTCSession =>
  session as unknown as RTCSession;

const createState = (
  id: string,
  status: SipSessionState["status"],
  muted = false
): SipSessionState => ({
  id,
  status,
  direction: "local",
  from: "100",
  to: "200",
  muted,
  acceptedAt: status === CallStatus.Active ? 1_000 : null,
  headers: {},
});

const setSessionStates = (
  store: SipStateStore,
  sessions: SipSessionState[]
) => {
  store.setState({
    sessions,
    sessionIds: sessions.map((session) => session.id),
    sessionsById: Object.fromEntries(
      sessions.map((session) => [session.id, session])
    ),
  });
};

const createHarness = () => {
  const state = new SipStateStore();
  const sessionManager = new FakeSessionManager();
  const emitter = { emit: vi.fn() };
  const micRecovery = {
    enable: vi.fn(),
    disable: vi.fn(),
    cleanupAll: vi.fn(),
  };
  const module = new SessionModule({
    state,
    emitter: emitter as unknown as JssipEventEmitter<JsSIPEventMap>,
    sessionManager: sessionManager as unknown as SessionManager,
    micRecovery: micRecovery as unknown as MicRecoveryManager,
    getMaxSessionCount: () => 2,
    getIceCandidateReadyDelayMs: () => 0,
    getAutoIceRestart: () => true,
    getAutoIceRestartMaxAttempts: () => 1,
    getAutoIceRestartDisconnectedDelayMs: () => 100,
    getAutoIceRestartRetryDelayMs: () => 50,
  });
  return { emitter, micRecovery, module, sessionManager, state };
};

describe("SessionModule", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("forwards media and session setters and exposes session queries", () => {
    const { module, sessionManager } = createHarness();
    const session = new FakeSession("session-1");
    const stream = {} as MediaStream;
    sessionManager.add("session-1", asRtcSession(session));

    module.setSessionMedia("session-1", stream);
    module.setSession("session-2", asRtcSession(new FakeSession("session-2")));
    module.setPendingMedia(stream);

    expect(sessionManager.setSessionMedia).toHaveBeenCalledWith(
      "session-1",
      stream
    );
    expect(sessionManager.setPendingMedia).toHaveBeenCalledWith(stream);
    expect(module.getSession("session-1")).toBe(asRtcSession(session));
    expect(module.getSessionIds()).toEqual(["session-1", "session-2"]);
    expect(module.getSessions()).toHaveLength(2);
  });

  it("answers and hangs up only existing sessions", () => {
    const { module, sessionManager } = createHarness();
    const session = new FakeSession("session-1");
    const stream = {} as MediaStream;
    sessionManager.add("session-1", asRtcSession(session));
    const options = { mediaStream: stream };

    expect(module.answerSession("session-1", options)).toBe(true);
    expect(sessionManager.setSessionMedia).toHaveBeenCalledWith(
      "session-1",
      stream
    );
    expect(sessionManager.answer).toHaveBeenCalledWith("session-1", options);
    expect(module.hangupSession("session-1", { status_code: 603 })).toBe(true);
    expect(module.answerSession("missing")).toBe(false);
    expect(module.hangupSession("")).toBe(false);
  });

  it("hangs up every session and reports partial failure", () => {
    const { module, sessionManager } = createHarness();
    expect(module.hangupAll()).toBe(false);
    sessionManager.add("first", asRtcSession(new FakeSession("first")));
    sessionManager.add("second", asRtcSession(new FakeSession("second")));
    sessionManager.hangupResults.set("second", false);

    expect(module.hangupAll({ status_code: 603 })).toBe(false);
    expect(sessionManager.hangup).toHaveBeenNthCalledWith(1, "first", {
      status_code: 603,
    });
    expect(sessionManager.hangup).toHaveBeenNthCalledWith(2, "second", {
      status_code: 603,
    });
  });

  it("resolves the active session for mute and hold toggles", () => {
    const { module, sessionManager, state } = createHarness();
    const active = createState("active", CallStatus.Active);
    const held = createState("held", CallStatus.Hold, true);
    setSessionStates(state, [held, active]);
    sessionManager.add("active", asRtcSession(new FakeSession("active")));
    sessionManager.add("held", asRtcSession(new FakeSession("held")));

    expect(module.toggleMuteSession()).toBe(true);
    expect(sessionManager.mute).toHaveBeenCalledWith("active");
    expect(module.toggleMuteSession("held")).toBe(true);
    expect(sessionManager.unmute).toHaveBeenCalledWith("held");
    expect(module.toggleHoldSession()).toBe(true);
    expect(sessionManager.hold).toHaveBeenCalledWith("active");
    expect(module.toggleHoldSession("held")).toBe(true);
    expect(sessionManager.unhold).toHaveBeenCalledWith("held");

    const ringing = createState("ringing", CallStatus.Ringing);
    setSessionStates(state, [ringing]);
    sessionManager.add("ringing", asRtcSession(new FakeSession("ringing")));
    expect(module.toggleHoldSession("ringing")).toBe(false);
    expect(module.toggleMuteSession("missing")).toBe(false);
  });

  it("allows DTMF and blind transfer only for an active session", () => {
    const { module, sessionManager, state } = createHarness();
    const active = createState("active", CallStatus.Active);
    const held = createState("held", CallStatus.Hold);
    setSessionStates(state, [active, held]);
    sessionManager.add("active", asRtcSession(new FakeSession("active")));
    sessionManager.add("held", asRtcSession(new FakeSession("held")));

    expect(module.sendDTMFSession("active", "12", { duration: 200 })).toBe(
      true
    );
    expect(
      module.transferSession("active", "sip:300@example.test", {
        extraHeaders: ["X-Test: value"],
      })
    ).toBe(true);
    expect(module.sendDTMFSession("held", "1")).toBe(false);
    expect(module.transferSession("held", "sip:300@example.test")).toBe(false);
    expect(module.sendDTMFSession("missing", "1")).toBe(false);
  });

  it("validates both legs of an attended transfer", () => {
    const { module, sessionManager, state } = createHarness();
    const first = new FakeSession("first");
    const second = new FakeSession("second");
    setSessionStates(state, [
      createState("first", CallStatus.Active),
      createState("second", CallStatus.Hold),
    ]);
    sessionManager.add("first", asRtcSession(first));
    sessionManager.add("second", asRtcSession(second));

    expect(module.attendedTransferSession("first", "second")).toBe(true);
    expect(sessionManager.attendedTransfer).toHaveBeenCalledWith(
      "first",
      asRtcSession(second)
    );
    expect(module.attendedTransferSession("second", "first")).toBe(false);
    expect(module.attendedTransferSession("first", "missing")).toBe(false);

    sessionManager.sessions.delete("second");
    sessionManager.rtcs.set("second", {
      currentSession: null,
      mediaStream: null,
      hold: vi.fn(),
    });
    expect(module.attendedTransferSession("first", "second")).toBe(false);
  });

  it("sends INFO and renegotiates active or held sessions", () => {
    const { module, sessionManager, state } = createHarness();
    const active = new FakeSession("active");
    const held = new FakeSession("held");
    const ringing = new FakeSession("ringing");
    setSessionStates(state, [
      createState("active", CallStatus.Active),
      createState("held", CallStatus.Hold),
      createState("ringing", CallStatus.Ringing),
    ]);
    sessionManager.add("active", asRtcSession(active));
    sessionManager.add("held", asRtcSession(held));
    sessionManager.add("ringing", asRtcSession(ringing));

    expect(
      module.sendInfoSession("active", "application/test", "body", {
        extraHeaders: ["X-Test: value"],
      })
    ).toBe(true);
    expect(module.sendInfoSession("held", "application/test")).toBe(true);
    expect(
      module.updateSession("active", {
        rtcOfferConstraints: { iceRestart: true },
      })
    ).toBe(true);
    held.renegotiate.mockReturnValue(false);
    expect(module.updateSession("held")).toBe(false);
    expect(module.sendInfoSession("ringing", "application/test")).toBe(false);
    expect(module.updateSession("ringing")).toBe(false);
    expect(module.sendInfoSession("missing", "application/test")).toBe(false);
  });

  it("attaches handlers and performs ICE restart with offer constraints", () => {
    vi.useFakeTimers();
    const { emitter, micRecovery, module, sessionManager, state } =
      createHarness();
    const session = new FakeSession("session-1");
    const event = {
      originator: "local",
      session: asRtcSession(session),
      request: {
        from: { uri: { user: "100" } },
        to: { uri: { user: "200" } },
        headers: {},
        getHeader: vi.fn(),
      },
    } as unknown as RTCSessionEvent;

    module.handleNewRTCSession(event);
    expect(session.listenerCount()).toBeGreaterThan(0);
    expect(state.getState().sessionsById["session-1"]?.status).toBe(
      CallStatus.Dialing
    );
    expect(emitter.emit).toHaveBeenCalledWith("newRTCSession", event);

    const pc = new FakePeerConnection();
    session.emit("peerconnection", { peerconnection: pc });
    pc.iceConnectionState = "failed";
    pc.dispatchEvent(new Event("iceconnectionstatechange"));
    expect(session.renegotiate).toHaveBeenCalledWith({
      rtcOfferConstraints: { iceRestart: true },
    });

    session.emit("confirmed", { originator: "remote" });
    expect(micRecovery.enable).toHaveBeenCalledWith("session-1");

    module.cleanupAllSessions();
    expect(session.listenerCount()).toBe(0);
    expect(sessionManager.cleanupAllSessions).toHaveBeenCalledOnce();
    expect(micRecovery.cleanupAll).toHaveBeenCalledOnce();
    expect(state.getState().sessions).toEqual([]);
  });

  it("cleans a single session by id", () => {
    const { micRecovery, module, sessionManager, state } = createHarness();
    const session = new FakeSession("session-1");
    sessionManager.add("session-1", asRtcSession(session));
    setSessionStates(state, [createState("session-1", CallStatus.Active)]);

    module.cleanupSessionById("session-1");

    expect(micRecovery.disable).toHaveBeenCalledWith("session-1");
    expect(sessionManager.cleanupSession).toHaveBeenCalledWith("session-1");
    expect(state.getState().sessions).toEqual([]);
    expect(() => module.cleanupSessionById("missing")).not.toThrow();
  });
});
