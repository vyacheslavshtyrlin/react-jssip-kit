import { describe, expect, it, vi } from "vitest";
import { JssipEventEmitter } from "../event-target.emitter";

type Events = {
  connected: { transport: string };
  stopped: undefined;
};

describe("JssipEventEmitter", () => {
  it("delivers payloads and stops after unsubscribe", () => {
    const emitter = new JssipEventEmitter<Events>();
    const listener = vi.fn();
    const off = emitter.on("connected", listener);

    emitter.emit("connected", { transport: "wss" });
    off();
    emitter.emit("connected", { transport: "tcp" });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ transport: "wss" });
  });

  it("keeps notifying other listeners when one throws", () => {
    const emitter = new JssipEventEmitter<Events>();
    const error = new Error("listener failed");
    const next = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    emitter.on("stopped", () => {
      throw error;
    });
    emitter.on("stopped", next);

    emitter.emit("stopped");

    expect(next).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "[react-jssip-kit] event listener failed",
      { event: "stopped", error }
    );
    consoleError.mockRestore();
  });

  it("handles repeated unsubscribe and events without listeners", () => {
    const emitter = new JssipEventEmitter<Events>();
    const off = emitter.on("stopped", vi.fn());

    off();
    off();

    expect(() => emitter.emit("stopped")).not.toThrow();
  });
});
