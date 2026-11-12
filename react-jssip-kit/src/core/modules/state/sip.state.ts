import type { InternalSipState } from "../../contracts/state";
import { SipStatus } from "../../contracts/state";

export function getInitialSipState(): InternalSipState {
  return {
    sipStatus: SipStatus.Disconnected,
    error: null,
    sessions: [],
    sessionsById: {},
    sessionIds: [],
  };
}

export function shallowEqual(objA: unknown, objB: unknown): boolean {
  if (objA === objB) return true;
  if (
    typeof objA !== "object" ||
    objA === null ||
    typeof objB !== "object" ||
    objB === null
  ) {
    return false;
  }
  const recordA = objA as Record<string, unknown>;
  const recordB = objB as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (recordA[key] !== recordB[key]) return false;
  }
  return true;
}
