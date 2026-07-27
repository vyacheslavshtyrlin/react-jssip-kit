import type { SipSessionState } from "../core/contracts/state";
import { CallStatus } from "../core/contracts/state";
import { useSipInternalSelector } from "./useSipInternalSelector";

export function useSipSession(sessionId?: string): SipSessionState | null {
  return useSipInternalSelector((state) =>
    sessionId ? (state.sessionsById[sessionId] ?? null) : null
  );
}

export function useActiveSipSession(): SipSessionState | null {
  return useSipInternalSelector(
    (state) =>
      state.sessions.find((session) => session.status === CallStatus.Active) ??
      null
  );
}
