import type { RTCSession } from "./types";

type SessionEventEmitter = RTCSession & {
  off?: (event: string, handler: unknown) => void;
  removeListener?: (event: string, handler: unknown) => void;
};

/** Detach a JsSIP session listener across supported EventEmitter variants. */
export function detachSessionListener(
  session: RTCSession,
  event: string,
  handler: unknown
): boolean {
  const emitter = session as SessionEventEmitter;
  if (typeof emitter.off === "function") {
    emitter.off(event, handler);
    return true;
  }
  if (typeof emitter.removeListener === "function") {
    emitter.removeListener(event, handler);
    return true;
  }
  return false;
}