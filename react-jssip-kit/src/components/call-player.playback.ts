const DEFAULT_MIN_RETRY_INTERVAL_MS = 250;

type PlayableAudioElement = Pick<HTMLAudioElement, "play" | "srcObject">;

export type PlaybackController = {
  requestPlay: () => void;
  dispose: () => void;
};

export function createPlaybackController(
  audioElement: PlayableAudioElement,
  onPlaybackBlocked: (error: unknown) => void,
  minRetryIntervalMs = DEFAULT_MIN_RETRY_INTERVAL_MS
): PlaybackController {
  let disposed = false;
  let retryRequested = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let playInFlight: Promise<void> | null = null;
  let lastPlayAttemptAt = Number.NEGATIVE_INFINITY;

  const clearRetryTimer = () => {
    if (!retryTimer) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  };

  const requestPlay = () => {
    if (disposed || !audioElement.srcObject) return;
    if (playInFlight) {
      retryRequested = true;
      return;
    }
    if (retryTimer) return;

    const retryDelay = Math.max(
      0,
      minRetryIntervalMs - (Date.now() - lastPlayAttemptAt)
    );
    if (retryDelay > 0) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        requestPlay();
      }, retryDelay);
      return;
    }

    lastPlayAttemptAt = Date.now();
    let result: Promise<void> | undefined;
    try {
      result = audioElement.play?.();
    } catch (error) {
      onPlaybackBlocked(error);
      return;
    }
    if (!result) return;

    playInFlight = result
      .catch((error: unknown) => {
        if (!disposed) onPlaybackBlocked(error);
      })
      .finally(() => {
        playInFlight = null;
        if (!retryRequested || disposed) return;
        retryRequested = false;
        requestPlay();
      });
  };

  return {
    requestPlay,
    dispose: () => {
      disposed = true;
      retryRequested = false;
      clearRetryTimer();
    },
  };
}
