import type { RTCSession } from "../../sip/types";

export type AudioBindOpts = {
  session: RTCSession;
  /**
   * Attempt to bind audio from the given PeerConnection.
   * Return true when binding succeeded (or was already done).
   * Return false to keep retrying.
   */
  tryBind: (pc: RTCPeerConnection | null) => boolean;
  /** Called once when the retry loop stops. `bound` = true means success. */
  onStop?: (bound: boolean) => void;
  /** Called once when max retries are exhausted before giving up. */
  onExhausted?: (pc: RTCPeerConnection | null, attempts: number) => void;
  /** Called inside onConfirmed when tryBind returns false (useful for diagnostic logs). */
  onConfirmedMiss?: (pc: RTCPeerConnection | null) => void;
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Whether to also listen to the `track` event on the PeerConnection. */
  listenPcTrackEvent?: boolean;
};

/**
 * Shared retry machinery for local and remote audio binding.
 *
 * Handles:
 *  - polling via setTimeout with exponential-free fixed delay
 *  - event-driven reattempts on PC state changes / new track / confirmed
 *  - one extra attempt after exhaustion when a new PC event fires
 *  - proper cleanup via named function references so session.off works
 */
export function createAudioBindRetry(opts: AudioBindOpts): () => void {
  const { session, tryBind, onStop, onExhausted, onConfirmedMiss } = opts;
  const maxAttempts = opts.maxAttempts ?? 50;
  const retryDelayMs = opts.retryDelayMs ?? 500;

  let attempts = 0;
  let retryScheduled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let exhausted = false;
  let exhaustedCheckUsed = false;
  let attachedPc: RTCPeerConnection | null = null;
  const attachedSessionEvents = new Set<
    "peerconnection" | "confirmed" | "ended" | "failed"
  >();

  const clearRetryTimer = () => {
    if (!retryTimer) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  };

  const detachPcListeners = (pc: RTCPeerConnection) => {
    pc.removeEventListener("signalingstatechange", onPcStateChange);
    pc.removeEventListener("connectionstatechange", onPcStateChange);
    pc.removeEventListener("iceconnectionstatechange", onPcStateChange);
    if (opts.listenPcTrackEvent) pc.removeEventListener("track", onTrack);
  };

  const stopRetry = (bound: boolean) => {
    if (stopped) return;
    stopped = true;
    clearRetryTimer();
    if (attachedPc) {
      detachPcListeners(attachedPc);
      attachedPc = null;
    }
    const sessionHandlers = {
      peerconnection: onPeer,
      confirmed: onConfirmed,
      ended: onEnded,
      failed: onFailed,
    } as const;
    attachedSessionEvents.forEach((event) => {
      try {
        session.off?.(event, sessionHandlers[event]);
      } catch (error) {
        console.error(
          "[react-jssip-kit] audio bind listener detach failed",
          error
        );
      }
    });
    attachedSessionEvents.clear();
    onStop?.(bound);
  };

  const scheduleRetry = (pc: RTCPeerConnection | null) => {
    if (stopped || retryScheduled || exhausted) return;
    if (attempts >= maxAttempts) {
      onExhausted?.(pc, attempts);
      exhausted = true;
      clearRetryTimer();
      return;
    }
    retryScheduled = true;
    attempts += 1;
    retryTimer = setTimeout(() => {
      retryScheduled = false;
      retryTimer = null;
      if (tryBind(pc)) {
        stopRetry(true);
        return;
      }
      scheduleRetry(pc);
    }, retryDelayMs);
  };

  /**
   * Single attempt that respects the exhaustion state.
   * Returns true and calls stopRetry when bound.
   */
  const tryOnce = (pc: RTCPeerConnection | null): boolean => {
    if (stopped) return false;
    if (exhausted) {
      if (exhaustedCheckUsed) return false;
      exhaustedCheckUsed = true;
      const bound = tryBind(pc);
      if (bound) stopRetry(true);
      return bound;
    }
    const bound = tryBind(pc);
    if (bound) stopRetry(true);
    return bound;
  };

  const onPcStateChange = () => {
    tryOnce(attachedPc);
  };

  const onTrack = () => {
    tryOnce(attachedPc);
  };

  const attachPcListeners = (pc: RTCPeerConnection | null) => {
    if (!pc || pc === attachedPc) return;
    if (attachedPc) detachPcListeners(attachedPc);
    attachedPc = pc;
    pc.addEventListener("signalingstatechange", onPcStateChange);
    pc.addEventListener("connectionstatechange", onPcStateChange);
    pc.addEventListener("iceconnectionstatechange", onPcStateChange);
    if (opts.listenPcTrackEvent) pc.addEventListener("track", onTrack);
  };

  const onPeer = (data: { peerconnection: RTCPeerConnection }) => {
    if (stopped) return;
    attachPcListeners(data.peerconnection);
    if (!tryOnce(data.peerconnection)) scheduleRetry(data.peerconnection);
  };

  const onConfirmed = () => {
    if (stopped) return;
    const currentPc =
      (session as RTCSession & { connection?: RTCPeerConnection })
        ?.connection ?? attachedPc;
    if (!tryOnce(currentPc)) {
      onConfirmedMiss?.(currentPc);
      scheduleRetry(currentPc);
    }
  };

  // Named references — required so session.off can find and remove them.
  const onEnded = () => stopRetry(false);
  const onFailed = () => stopRetry(false);

  // Attempt with any already-available connection.
  // If it succeeds we still register confirmed/ended/failed for lifecycle cleanup.
  // If it fails we also register the peerconnection listener and start retrying.
  const attachSessionListener = <
    K extends "peerconnection" | "confirmed" | "ended" | "failed",
  >(
    event: K,
    handler: {
      peerconnection: typeof onPeer;
      confirmed: typeof onConfirmed;
      ended: typeof onEnded;
      failed: typeof onFailed;
    }[K]
  ) => {
    attachedSessionEvents.add(event);
    session.on?.(event, handler);
  };

  const existingPc =
    (session as RTCSession & { connection?: RTCPeerConnection })?.connection ??
    null;

  try {
    if (!tryBind(existingPc)) {
      if (existingPc) {
        attachPcListeners(existingPc);
        scheduleRetry(existingPc);
      }
      attachSessionListener("peerconnection", onPeer);
    }

    attachSessionListener("confirmed", onConfirmed);
    attachSessionListener("ended", onEnded);
    attachSessionListener("failed", onFailed);
  } catch (error) {
    stopRetry(false);
    throw error;
  }

  return () => stopRetry(false);
}
