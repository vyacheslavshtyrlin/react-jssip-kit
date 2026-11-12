import { describe, expect, it, vi } from "vitest";
import { SipStatus } from "../../../contracts/state";
import { createUAHandlers } from "../ua.handlers";

const createHarness = () => {
  const emit = vi.fn();
  const setState = vi.fn();
  const onConnected = vi.fn();
  const onDisconnected = vi.fn();
  const onNewRTCSession = vi.fn();
  const handlers = createUAHandlers({
    emitter: { emit } as never,
    state: { setState } as never,
    onConnected,
    onDisconnected,
    onNewRTCSession,
  });
  return {
    emit,
    handlers,
    onConnected,
    onDisconnected,
    onNewRTCSession,
    setState,
  };
};

describe("createUAHandlers", () => {
  it("projects connection and registration events into state", () => {
    const { emit, handlers, onConnected, onDisconnected, setState } =
      createHarness();
    const event = { socket: {} };

    handlers.connecting?.(event as never);
    handlers.connected?.(event as never);
    handlers.registered?.(event as never);
    handlers.unregistered?.(event as never);
    handlers.disconnected?.(event as never);

    expect(setState).toHaveBeenNthCalledWith(1, {
      sipStatus: SipStatus.Connecting,
    });
    expect(setState).toHaveBeenNthCalledWith(2, {
      sipStatus: SipStatus.Connected,
    });
    expect(setState).toHaveBeenNthCalledWith(3, {
      sipStatus: SipStatus.Registered,
      error: null,
    });
    expect(setState).toHaveBeenNthCalledWith(4, {
      sipStatus: SipStatus.Unregistered,
    });
    expect(onConnected).toHaveBeenCalledTimes(2);
    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(emit.mock.calls.map(([name]) => name)).toEqual([
      "connecting",
      "connected",
      "registered",
      "unregistered",
      "disconnected",
    ]);
  });

  it.each([
    [{ cause: "Forbidden" }, "Forbidden"],
    [{}, "registration failed"],
  ])("stores registration failure cause from %o", (event, expectedError) => {
    const { emit, handlers, setState } = createHarness();
    vi.spyOn(console, "error").mockImplementation(() => {});

    handlers.registrationFailed?.(event as never);

    expect(setState).toHaveBeenCalledWith({
      sipStatus: SipStatus.RegistrationFailed,
      error: expectedError,
    });
    expect(emit).toHaveBeenCalledWith("registrationFailed", event);
  });

  it("forwards message, options, SIP and RTC session events", () => {
    const { emit, handlers, onNewRTCSession } = createHarness();
    const event = { originator: "remote" };

    handlers.newMessage?.(event as never);
    handlers.newOptions?.(event as never);
    handlers.sipEvent?.(event as never);
    handlers.newRTCSession?.(event as never);

    expect(emit).toHaveBeenCalledWith("newMessage", event);
    expect(emit).toHaveBeenCalledWith("newOptions", event);
    expect(emit).toHaveBeenCalledWith("sipEvent", event);
    expect(onNewRTCSession).toHaveBeenCalledWith(event);
  });
});
