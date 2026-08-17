import { useEffect, useRef } from "react";
import type { SessionIceRecoveryExhaustedPayload } from "../core/sip/types";
import { useSipKernel } from "./useSip";

export function useSessionIceRecoveryExhausted(
  handler?: (payload: SessionIceRecoveryExhaustedPayload) => void
) {
  const { events } = useSipKernel();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const hasHandler = !!handler;

  useEffect(() => {
    if (!hasHandler) return;
    return events.onSessionIceRecoveryExhausted((payload) =>
      handlerRef.current?.(payload)
    );
  }, [events, hasHandler]);
}
