/** Adds library metadata without replacing JsSIP's native event object. */
export function withSessionId<T>(payload: T, sessionId: string): T & { sessionId: string } {
  if (!payload || typeof payload !== "object") {
    return { payload, sessionId } as T & { sessionId: string };
  }
  try {
    Object.defineProperty(payload, "sessionId", {
      configurable: true,
      enumerable: true,
      value: sessionId,
      writable: true,
    });
    return payload as T & { sessionId: string };
  } catch {
    return { ...payload, sessionId } as T & { sessionId: string };
  }
}