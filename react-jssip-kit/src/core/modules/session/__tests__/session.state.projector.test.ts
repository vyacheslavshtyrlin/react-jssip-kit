import { describe, expect, it, vi } from "vitest";
import {
  CallStatus,
  SipStatus,
  type SipSessionState,
} from "../../../contracts/state";
import { SipStateStore } from "../../state/sip.state.store";
import {
  clearSessionsState,
  holdOtherSessions,
  removeSessionState,
  upsertSessionState,
} from "../session.state.projector";

const createSession = (
  id: string,
  status: SipSessionState["status"]
): SipSessionState => ({
  id,
  status,
  direction: "local",
  from: "100",
  to: "200",
  muted: false,
  acceptedAt: null,
  headers: { "x-test": id },
});

describe("session state projector", () => {
  it("registers a new session with defaults", () => {
    const store = new SipStateStore();

    upsertSessionState(store, "session-1", {
      status: CallStatus.Dialing,
      direction: "local",
      to: "200",
    });

    const expected: SipSessionState = {
      id: "session-1",
      status: CallStatus.Dialing,
      direction: "local",
      from: null,
      to: "200",
      muted: false,
      acceptedAt: null,
      headers: {},
    };
    expect(store.getState().sessionsById["session-1"]).toEqual(expected);
    expect(store.getState().sessionIds).toEqual(["session-1"]);
    expect(store.getState().sessions).toEqual([expected]);
  });

  it("updates an existing session without changing its order", () => {
    const store = new SipStateStore();
    upsertSessionState(
      store,
      "session-1",
      createSession("session-1", CallStatus.Ringing)
    );
    upsertSessionState(
      store,
      "session-2",
      createSession("session-2", CallStatus.Hold)
    );

    upsertSessionState(store, "session-1", {
      status: CallStatus.Active,
      acceptedAt: 1_000,
    });

    expect(store.getState().sessionIds).toEqual(["session-1", "session-2"]);
    expect(store.getState().sessions).toHaveLength(2);
    expect(store.getState().sessions[0]).toMatchObject({
      id: "session-1",
      status: CallStatus.Active,
      acceptedAt: 1_000,
      headers: { "x-test": "session-1" },
    });
    expect(store.getState().sessionsById["session-1"]).toBe(
      store.getState().sessions[0]
    );
  });

  it("holds only other active sessions", () => {
    const store = new SipStateStore();
    const target = createSession("target", CallStatus.Active);
    const active = createSession("active", CallStatus.Active);
    const held = createSession("held", CallStatus.Hold);
    store.setState({
      sessions: [target, active, held],
      sessionsById: { target, active, held },
      sessionIds: ["target", "missing", "active", "held"],
    });
    const hold = vi.fn();

    holdOtherSessions(store, "target", hold);

    expect(hold).toHaveBeenCalledOnce();
    expect(hold).toHaveBeenCalledWith("active");
  });

  it("removes only the requested session and clears the error", () => {
    const store = new SipStateStore();
    const first = createSession("session-1", CallStatus.Active);
    const second = createSession("session-2", CallStatus.Hold);
    store.setState({
      sipStatus: SipStatus.Registered,
      error: "old session error",
      sessions: [first, second],
      sessionsById: { "session-1": first, "session-2": second },
      sessionIds: ["session-1", "session-2"],
    });

    removeSessionState(store, "session-1");

    expect(store.getState()).toMatchObject({
      sipStatus: SipStatus.Registered,
      error: null,
      sessions: [second],
      sessionsById: { "session-2": second },
      sessionIds: ["session-2"],
    });
  });

  it("does nothing when removing an unknown session", () => {
    const store = new SipStateStore();
    const listener = vi.fn();
    store.subscribeInternal(listener);

    removeSessionState(store, "missing");

    expect(listener).not.toHaveBeenCalled();
  });

  it("clears all session projections and the current error", () => {
    const store = new SipStateStore();
    const session = createSession("session-1", CallStatus.Active);
    store.setState({
      error: "transport failed",
      sessions: [session],
      sessionsById: { "session-1": session },
      sessionIds: ["session-1"],
    });

    clearSessionsState(store);

    expect(store.getState()).toMatchObject({
      error: null,
      sessions: [],
      sessionsById: {},
      sessionIds: [],
    });
  });
});
