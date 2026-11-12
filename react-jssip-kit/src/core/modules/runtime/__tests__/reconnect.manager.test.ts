import { afterEach, describe, expect, it, vi } from "vitest";
import { ReconnectManager } from "../reconnect.manager";

describe("ReconnectManager", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries with exponential backoff and reports exhaustion", async () => {
    vi.useFakeTimers();
    const onAttempt = vi.fn();
    const onExhausted = vi.fn();
    let manager: ReconnectManager;
    manager = new ReconnectManager(
      { enabled: true, maxAttempts: 3, delayMs: 100, backoffMultiplier: 2 },
      () => {
        onAttempt();
        manager.scheduleNext();
      },
      onExhausted
    );

    manager.start();
    await vi.advanceTimersByTimeAsync(99);
    expect(onAttempt).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onAttempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(onAttempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(400);

    expect(onAttempt).toHaveBeenCalledTimes(3);
    expect(onExhausted).toHaveBeenCalledOnce();
    expect(manager.isActive()).toBe(false);
  });

  it("does not start a second retry chain while active", async () => {
    vi.useFakeTimers();
    const onAttempt = vi.fn();
    const manager = new ReconnectManager(
      { enabled: true, delayMs: 100 },
      onAttempt,
      vi.fn()
    );

    manager.start();
    manager.start();
    await vi.advanceTimersByTimeAsync(100);

    expect(onAttempt).toHaveBeenCalledOnce();
  });

  it("cancels a pending attempt", async () => {
    vi.useFakeTimers();
    const onAttempt = vi.fn();
    const manager = new ReconnectManager(
      { enabled: true, delayMs: 100 },
      onAttempt,
      vi.fn()
    );

    manager.start();
    manager.cancel();
    await vi.runAllTimersAsync();

    expect(onAttempt).not.toHaveBeenCalled();
    expect(manager.isActive()).toBe(false);
  });

  it("starts from the first delay again after cancellation", async () => {
    vi.useFakeTimers();
    const onAttempt = vi.fn();
    const manager = new ReconnectManager(
      { enabled: true, delayMs: 100, backoffMultiplier: 2 },
      onAttempt,
      vi.fn()
    );

    manager.start();
    await vi.advanceTimersByTimeAsync(100);
    manager.scheduleNext();
    manager.cancel();
    manager.start();
    await vi.advanceTimersByTimeAsync(99);
    expect(onAttempt).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(onAttempt).toHaveBeenCalledTimes(2);
  });

  it("retries when an attempt callback throws", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("transport failed");
    const onAttempt = vi
      .fn<() => void>()
      .mockImplementationOnce(() => {
        throw error;
      })
      .mockImplementation(() => {});
    const manager = new ReconnectManager(
      { enabled: true, maxAttempts: 2, delayMs: 100 },
      onAttempt,
      vi.fn()
    );

    manager.start();
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(150);

    expect(onAttempt).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      "[react-jssip-kit] reconnect attempt failed",
      error
    );
  });
});
