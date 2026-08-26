import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionHandlers } from "../session.handlers";

class FakePeerConnection extends EventTarget {
  iceConnectionState: RTCIceConnectionState = "new";
}

const createIceHandlers = (restartIce: () => boolean, delayMs = 7000) => {
  const emitter = { emit: vi.fn() };
  const handlers = createSessionHandlers({
    emitter: emitter as never,
    state: {
      getState: () => ({ sessionsById: {} }),
      setState: vi.fn(),
    } as never,
    cleanupSession: vi.fn(),
    autoIceRestart: true,
    autoIceRestartMaxAttempts: 1,
    autoIceRestartDisconnectedDelayMs: delayMs,
    autoIceRestartRetryDelayMs: 250,
    restartIce,
    sessionId: "session-1",
  });
  const peerConnection = new FakePeerConnection();
  (handlers.peerconnection as (event: unknown) => void)({
    peerconnection: peerConnection,
  });

  return { emitter, peerConnection };
};

describe("createSessionHandlers auto ICE restart", () => {
  afterEach(() => vi.useRealTimers());

  it("retries after a competing renegotiation rejects the first request", () => {
    vi.useFakeTimers();
    const restartIce = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const { peerConnection } = createIceHandlers(restartIce);

    peerConnection.iceConnectionState = "failed";
    peerConnection.dispatchEvent(new Event("iceconnectionstatechange"));
    expect(restartIce).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(250);
    expect(restartIce).toHaveBeenCalledTimes(2);

    peerConnection.dispatchEvent(new Event("iceconnectionstatechange"));
    expect(restartIce).toHaveBeenCalledTimes(2);
  });

  it("does not restart a transient disconnected ICE transport", () => {
    vi.useFakeTimers();
    const restartIce = vi.fn<() => boolean>().mockReturnValue(true);
    const { peerConnection } = createIceHandlers(restartIce, 7000);

    peerConnection.iceConnectionState = "disconnected";
    peerConnection.dispatchEvent(new Event("iceconnectionstatechange"));
    vi.advanceTimersByTime(6999);
    expect(restartIce).not.toHaveBeenCalled();

    peerConnection.iceConnectionState = "connected";
    peerConnection.dispatchEvent(new Event("iceconnectionstatechange"));
    vi.advanceTimersByTime(1);
    expect(restartIce).not.toHaveBeenCalled();
  });

  it("cancels the recovery watchdog when ICE reconnects", () => {
    vi.useFakeTimers();
    const restartIce = vi.fn<() => boolean>().mockReturnValue(true);
    const { peerConnection } = createIceHandlers(restartIce);

    peerConnection.iceConnectionState = "failed";
    peerConnection.dispatchEvent(new Event("iceconnectionstatechange"));
    expect(restartIce).toHaveBeenCalledTimes(1);

    peerConnection.iceConnectionState = "connected";
    peerConnection.dispatchEvent(new Event("iceconnectionstatechange"));
    vi.advanceTimersByTime(10_000);
    expect(restartIce).toHaveBeenCalledTimes(1);
  });
});

describe("createSessionHandlers terminal session events", () => {
  it("cleans up the affected session after setRemoteDescription failure", () => {
    const cleanupSession = vi.fn();
    const handlers = createSessionHandlers({
      emitter: { emit: vi.fn() } as never,
      state: { getState: () => ({ sessionsById: {} }), setState: vi.fn() } as never,
      cleanupSession,
      autoIceRestart: false,
      autoIceRestartMaxAttempts: 0,
      autoIceRestartDisconnectedDelayMs: 0,
      autoIceRestartRetryDelayMs: 0,
      restartIce: () => false,
      sessionId: "session-1",
    });

    handlers["peerconnection:setremotedescriptionfailed"]?.(new Error("SDP"));

    expect(cleanupSession).toHaveBeenCalledTimes(1);
  });

  it("keeps the session after a duplicate remote answer in stable state", () => {
    const cleanupSession = vi.fn();
    const emitter = { emit: vi.fn() };
    const setState = vi.fn();
    const handlers = createSessionHandlers({
      emitter: emitter as never,
      state: { getState: () => ({ sessionsById: {} }), setState } as never,
      cleanupSession,
      autoIceRestart: false,
      autoIceRestartMaxAttempts: 0,
      autoIceRestartDisconnectedDelayMs: 0,
      autoIceRestartRetryDelayMs: 0,
      restartIce: () => false,
      sessionId: "session-1",
    });
    const error = new Error(
      "Failed to execute 'setRemoteDescription' on 'RTCPeerConnection': " +
        "Failed to set remote answer sdp: Called in wrong state: stable"
    );

    handlers["peerconnection:setremotedescriptionfailed"]?.(error);

    expect(cleanupSession).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith(
      "peerconnection:setremotedescriptionfailed",
      error
    );
    expect(setState).toHaveBeenCalledWith({
      error: `peerconnection:setremotedescriptionfailed: ${error.message}`,
    });
  });

  it("includes the session id in the global failed payload", () => {
    const emitter = { emit: vi.fn() };
    const handlers = createSessionHandlers({
      emitter: emitter as never,
      state: { getState: () => ({ sessionsById: {} }), setState: vi.fn() } as never,
      cleanupSession: vi.fn(),
      autoIceRestart: false,
      autoIceRestartMaxAttempts: 0,
      autoIceRestartDisconnectedDelayMs: 0,
      autoIceRestartRetryDelayMs: 0,
      restartIce: () => false,
      sessionId: "session-1",
    });

    (handlers.failed as (event: { cause: string }) => void)({ cause: "Busy" });

    expect(emitter.emit).toHaveBeenCalledWith("failed", {
      cause: "Busy",
      sessionId: "session-1",
    });
  });
});