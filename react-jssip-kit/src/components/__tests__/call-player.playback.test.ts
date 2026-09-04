import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaybackController } from "../call-player.playback";

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("createPlaybackController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries once when a request arrives while play is pending", async () => {
    let resolveFirst!: () => void;
    const firstPlay = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const audio = {
      srcObject: {} as MediaProvider,
      play: vi
        .fn<() => Promise<void>>()
        .mockReturnValueOnce(firstPlay)
        .mockResolvedValue(undefined),
    };
    const controller = createPlaybackController(audio, vi.fn(), 0);

    controller.requestPlay();
    controller.requestPlay();
    expect(audio.play).toHaveBeenCalledTimes(1);

    resolveFirst();
    await flushPromises();
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("coalesces rapid retry requests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const audio = {
      srcObject: {} as MediaProvider,
      play: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    const controller = createPlaybackController(audio, vi.fn(), 250);

    controller.requestPlay();
    await flushPromises();
    vi.advanceTimersByTime(10);
    controller.requestPlay();
    controller.requestPlay();

    expect(audio.play).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(240);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("reports a rejected play without an unhandled rejection", async () => {
    const error = new DOMException("Blocked", "NotAllowedError");
    const onPlaybackBlocked = vi.fn();
    const audio = {
      srcObject: {} as MediaProvider,
      play: vi.fn<() => Promise<void>>().mockRejectedValue(error),
    };
    const controller = createPlaybackController(audio, onPlaybackBlocked, 0);

    controller.requestPlay();
    await flushPromises();

    expect(onPlaybackBlocked).toHaveBeenCalledWith(error);
  });

  it("cancels a scheduled retry on dispose", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const audio = {
      srcObject: {} as MediaProvider,
      play: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    const controller = createPlaybackController(audio, vi.fn(), 250);

    controller.requestPlay();
    await flushPromises();
    controller.requestPlay();
    controller.dispose();
    await vi.advanceTimersByTimeAsync(250);

    expect(audio.play).toHaveBeenCalledTimes(1);
  });
});
