import type { RTCSession } from "../../../sip/types";
import type { SipClient } from "../../../client";
import { describe, expect, it, vi } from "vitest";
import { createSipEventManager } from "../sip-event-manager.adapter";

type ClientHandler = (payload?: unknown) => void;

const createSession = (id: string) => ({
  id,
  on: vi.fn(),
  off: vi.fn(),
});

const createClient = (initialSession?: ReturnType<typeof createSession>) => {
  const handlers = new Map<string, Set<ClientHandler>>();
  const on = vi.fn((event: string, handler: ClientHandler) => {
    const bucket = handlers.get(event) ?? new Set<ClientHandler>();
    bucket.add(handler);
    handlers.set(event, bucket);
    return () => bucket.delete(handler);
  });
  const emit = (event: string, payload?: unknown) => {
    handlers.get(event)?.forEach((handler) => handler(payload));
  };
  const getSession = vi.fn((id: string) =>
    initialSession?.id === id ? (initialSession as unknown as RTCSession) : null
  );
  return {
    client: { on, getSession } as unknown as SipClient,
    emit,
    getSession,
    on,
  };
};

describe("createSipEventManager", () => {
  it("delegates UA subscriptions to the client", () => {
    const { client, on } = createClient();
    const manager = createSipEventManager(client);
    const handler = vi.fn();

    manager.onUA("connected", handler);

    expect(on).toHaveBeenCalledWith("connected", handler);
  });

  it("attaches to an existing session and detaches on cleanup", () => {
    const session = createSession("session-1");
    const { client } = createClient(session);
    const manager = createSipEventManager(client);
    const handler = vi.fn();

    const off = manager.onSession("session-1", "accepted", handler);
    const wrapped = session.on.mock.calls[0]?.[1];
    const payload = { originator: "remote" };
    wrapped(payload);
    off();

    expect(session.on).toHaveBeenCalledWith("accepted", wrapped);
    expect(handler).toHaveBeenCalledWith(payload);
    expect(session.off).toHaveBeenCalledWith("accepted", wrapped);
  });

  it("waits for the matching session and detaches on disconnect", () => {
    const { client, emit } = createClient();
    const manager = createSipEventManager(client);
    const wrong = createSession("other");
    const matching = createSession("session-1");

    manager.onSession("session-1", "ended", vi.fn());
    emit("newRTCSession", { session: wrong });
    emit("newRTCSession", { session: matching });
    emit("newRTCSession", { session: matching });
    emit("disconnected");

    expect(wrong.on).not.toHaveBeenCalled();
    expect(matching.on).toHaveBeenCalledOnce();
    expect(matching.off).toHaveBeenCalledOnce();
  });

  it("switches to a replacement object for the same session id", () => {
    const first = createSession("session-1");
    const second = createSession("session-1");
    const { client, emit } = createClient(first);
    const manager = createSipEventManager(client);

    manager.onSession("session-1", "failed", vi.fn());
    emit("newRTCSession", { session: second });

    expect(first.off).toHaveBeenCalledOnce();
    expect(second.on).toHaveBeenCalledOnce();
  });

  it("isolates session attach and detach failures", () => {
    const first = createSession("session-1");
    const second = createSession("session-1");
    const attachError = new Error("attach failed");
    const detachError = new Error("detach failed");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    first.off.mockImplementation(() => {
      throw detachError;
    });
    second.on.mockImplementation(() => {
      throw attachError;
    });
    const { client, emit } = createClient(first);
    const manager = createSipEventManager(client);

    manager.onSession("session-1", "confirmed", vi.fn());
    emit("newRTCSession", { session: second });

    expect(consoleError).toHaveBeenCalledWith(
      "[react-jssip-kit] session event listener detach failed",
      detachError
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[react-jssip-kit] session event listener attach failed",
      attachError
    );
    consoleError.mockRestore();
  });
});
