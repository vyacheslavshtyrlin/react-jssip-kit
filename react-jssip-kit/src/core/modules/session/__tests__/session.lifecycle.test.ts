import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RTCSessionEvent } from "../../../sip/types";
import type { RTCSession, TerminateOptions } from "../../../sip/types";
import { CallStatus, type SipSessionState } from "../../../contracts/state";
import { sipDebugLogger } from "../../debug/sip-debug.logger";
import { SipStateStore } from "../../state/sip.state.store";
import { SessionLifecycle } from "../session.lifecycle";
import type { SessionManager } from "../session.manager";

type Listener = (...args: unknown[]) => void;

class FakeTrack extends EventTarget {
  readonly kind = "audio";
  readonly id: string;
  readyState: MediaStreamTrackState = "live";

  constructor(id: string) {
    super();
    this.id = id;
  }
}

class FakeMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[] = []) {}

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }
}

class FakePeerConnection extends EventTarget {
  connectionState: RTCPeerConnectionState = "connected";
  iceConnectionState: RTCIceConnectionState = "connected";
  senders: RTCRtpSender[] = [];
  receivers: RTCRtpReceiver[] = [];

  getSenders(): RTCRtpSender[] {
    return this.senders;
  }

  getReceivers(): RTCRtpReceiver[] {
    return this.receivers;
  }
}

class FakeSession {
  readonly id: string;
  connection?: RTCPeerConnection;
  readonly terminate = vi.fn<(options?: TerminateOptions) => void>();
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
  mediaStream: MediaStream | null;
  hold: ReturnType<typeof vi.fn>;
};

class FakeSessionManager {
  readonly rtcById = new Map<string, FakeRtc>();
  liveSessionCount = 0;
  readonly getOrCreateRtc = vi.fn((sessionId: string) => {
    const existing = this.rtcById.get(sessionId);
    if (existing) return existing;
    const rtc: FakeRtc = { mediaStream: null, hold: vi.fn() };
    this.rtcById.set(sessionId, rtc);
    return rtc;
  });
  readonly setSession = vi.fn();
  readonly getRtc = vi.fn((sessionId: string) => this.rtcById.get(sessionId));
  readonly setSessionMedia = vi.fn((sessionId: string, stream: MediaStream) => {
    const rtc = this.getOrCreateRtc(sessionId);
    rtc.mediaStream = stream;
  });
  readonly getLiveSessionCount = vi.fn(() => this.liveSessionCount);
}

const asTrack = (track: FakeTrack): MediaStreamTrack =>
  track as unknown as MediaStreamTrack;

const asPeerConnection = (pc: FakePeerConnection): RTCPeerConnection =>
  pc as unknown as RTCPeerConnection;

const asRtcSession = (session: FakeSession): RTCSession =>
  session as unknown as RTCSession;

const createEvent = (
  session: FakeSession,
  originator: "local" | "remote",
  headers: Record<string, string> = { "X-Trace-Id": "trace-1" }
): RTCSessionEvent => {
  const request = {
    from: { uri: { user: "100" } },
    to: { uri: { user: "200" } },
    headers: Object.fromEntries(
      Object.keys(headers).map((name) => [name, [{ raw: headers[name] }]])
    ),
    getHeader: (name: string) => headers[name],
  };
  return {
    originator,
    session: asRtcSession(session),
    request,
  } as unknown as RTCSessionEvent;
};

const createActiveSessionState = (id: string): SipSessionState => ({
  id,
  status: CallStatus.Active,
  direction: "local",
  from: "100",
  to: "200",
  muted: false,
  acceptedAt: 1_000,
  headers: {},
});

const createHarness = (maxSessionCount = 2) => {
  const state = new SipStateStore();
  const sessionManager = new FakeSessionManager();
  const emit = vi.fn();
  const attachSessionHandlers = vi.fn();
  const cleanupSession = vi.fn();
  const lifecycle = new SessionLifecycle({
    state,
    sessionManager: sessionManager as unknown as SessionManager,
    emit: emit as never,
    attachSessionHandlers,
    cleanupSession,
    getMaxSessionCount: () => maxSessionCount,
  });
  return {
    attachSessionHandlers,
    cleanupSession,
    emit,
    lifecycle,
    sessionManager,
    state,
  };
};

describe("SessionLifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.spyOn(sipDebugLogger, "startCallStatsLogging").mockImplementation(
      () => {}
    );
    vi.spyOn(sipDebugLogger, "stopCallStatsLogging").mockImplementation(
      () => {}
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers outgoing audio, holds another active call, and stores headers", () => {
    const harness = createHarness();
    const active = createActiveSessionState("active");
    harness.state.setState({
      sessions: [active],
      sessionsById: { active },
      sessionIds: ["active"],
    });
    const activeRtc: FakeRtc = { mediaStream: null, hold: vi.fn() };
    harness.sessionManager.rtcById.set("active", activeRtc);
    const track = new FakeTrack("local-audio");
    const pc = new FakePeerConnection();
    pc.senders = [{ track: asTrack(track) } as RTCRtpSender];
    const session = new FakeSession("outgoing");
    session.connection = asPeerConnection(pc);
    const event = createEvent(session, "local", {
      "X-Trace-Id": "trace-1",
      Subject: "support",
    });

    harness.lifecycle.handleNewRTCSession(event);

    expect(harness.attachSessionHandlers).toHaveBeenCalledWith(
      "outgoing",
      asRtcSession(session)
    );
    expect(activeRtc.hold).toHaveBeenCalledOnce();
    expect(harness.sessionManager.setSessionMedia).toHaveBeenCalledOnce();
    expect(
      harness.sessionManager.rtcById
        .get("outgoing")
        ?.mediaStream?.getAudioTracks()
    ).toEqual([asTrack(track)]);
    expect(harness.state.getState().sessionsById.outgoing).toMatchObject({
      direction: "local",
      from: null,
      to: "200",
      status: CallStatus.Dialing,
      headers: { "x-trace-id": "trace-1", subject: "support" },
    });
    expect(harness.emit).toHaveBeenCalledWith("newRTCSession", event);

    harness.lifecycle.cleanupAudioBinding("outgoing");
    harness.lifecycle.cleanupCallStats("outgoing");
  });

  it("registers an incoming call and monitors its remote audio track", () => {
    const harness = createHarness();
    const track = new FakeTrack("remote-audio");
    const pc = new FakePeerConnection();
    pc.receivers = [{ track: asTrack(track) } as RTCRtpReceiver];
    const session = new FakeSession("incoming");
    session.connection = asPeerConnection(pc);
    const event = createEvent(session, "remote");

    harness.lifecycle.handleNewRTCSession(event);

    expect(harness.state.getState().sessionsById.incoming).toMatchObject({
      direction: "remote",
      from: "100",
      to: "200",
      status: CallStatus.Ringing,
    });
    expect(harness.emit).toHaveBeenCalledWith("newRTCSession", event);

    session.emit("confirmed");
    expect(sipDebugLogger.startCallStatsLogging).toHaveBeenCalledWith(
      "incoming",
      asRtcSession(session)
    );
    session.emit("ended");
    expect(sipDebugLogger.stopCallStatsLogging).toHaveBeenCalledWith(
      "incoming"
    );

    harness.lifecycle.cleanupAudioBinding("incoming");
    harness.lifecycle.cleanupCallStats("incoming");
    expect(session.listenerCount()).toBe(0);
  });

  it("rejects an incoming call over the limit and forwards failed", () => {
    const harness = createHarness(1);
    harness.sessionManager.liveSessionCount = 1;
    const session = new FakeSession("rejected");
    const failedEvent = { cause: "Busy" };
    session.terminate.mockImplementation(() => {
      session.emit("failed", failedEvent);
    });

    harness.lifecycle.handleNewRTCSession(createEvent(session, "remote"));

    expect(session.terminate).toHaveBeenCalledWith({
      status_code: 486,
      reason_phrase: "Busy Here",
    });
    expect(harness.emit).toHaveBeenCalledWith("failed", {
      cause: "Busy",
      sessionId: "rejected",
    });
    expect(session.listenerCount()).toBe(0);
    expect(harness.attachSessionHandlers).not.toHaveBeenCalled();
  });

  it("rolls back and rejects a remote call when initialization fails", () => {
    const harness = createHarness(1);
    const error = new Error("handler setup failed");
    harness.attachSessionHandlers.mockImplementation(() => {
      throw error;
    });
    const session = new FakeSession("incoming");
    const event = createEvent(session, "remote");

    expect(() => harness.lifecycle.handleNewRTCSession(event)).not.toThrow();
    expect(harness.cleanupSession).toHaveBeenCalledWith(
      "incoming",
      asRtcSession(session)
    );
    expect(session.terminate).toHaveBeenCalledWith({
      status_code: 500,
      reason_phrase: "Internal Error",
    });

    harness.attachSessionHandlers.mockReset();
    harness.sessionManager.liveSessionCount = 1;
    harness.lifecycle.handleNewRTCSession(event);
    expect(session.terminate).toHaveBeenLastCalledWith({
      status_code: 486,
      reason_phrase: "Busy Here",
    });
  });

  it("rolls back and rethrows a local initialization failure", () => {
    const harness = createHarness();
    const error = new Error("handler setup failed");
    harness.attachSessionHandlers.mockImplementation(() => {
      throw error;
    });
    const session = new FakeSession("outgoing");

    expect(() =>
      harness.lifecycle.handleNewRTCSession(createEvent(session, "local"))
    ).toThrow(error);
    expect(harness.cleanupSession).toHaveBeenCalledWith(
      "outgoing",
      asRtcSession(session)
    );
    expect(session.terminate).not.toHaveBeenCalled();
  });

  it("cleans every audio binding and call stats listener", () => {
    const harness = createHarness();
    const sessions = ["first", "second"].map((id) => {
      const track = new FakeTrack(`${id}-track`);
      const pc = new FakePeerConnection();
      pc.senders = [{ track: asTrack(track) } as RTCRtpSender];
      const session = new FakeSession(id);
      session.connection = asPeerConnection(pc);
      harness.lifecycle.handleNewRTCSession(createEvent(session, "local"));
      return session;
    });

    harness.lifecycle.cleanupAllAudioBindings();
    harness.lifecycle.cleanupAllCallStats();

    expect(sessions[0]?.listenerCount()).toBe(0);
    expect(sessions[1]?.listenerCount()).toBe(0);
    expect(() => harness.lifecycle.cleanupAllAudioBindings()).not.toThrow();
    expect(() => harness.lifecycle.cleanupAllCallStats()).not.toThrow();
  });
});
