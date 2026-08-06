import { useEffect, useMemo, useState } from "react";
import { CallStatus } from "../core/contracts/state";
import { useSipKernel } from "./useSip";
import { useSipSelector } from "./useSipSelector";

export type CallQuality = {
  rtt: number;
  packetLoss: number;
  jitter: number;
  level: "good" | "medium" | "poor";
};

const POLL_INTERVAL_MS = 3000;

function computeLevel(
  rtt: number,
  packetLoss: number,
  jitter: number
): CallQuality["level"] {
  if (rtt > 300 || packetLoss > 0.1 || jitter > 50) return "poor";
  if (rtt < 150 && packetLoss < 0.03 && jitter < 20) return "good";
  return "medium";
}

async function readStats(
  pc: RTCPeerConnection,
  prevReceived: { current: number },
  prevLost: { current: number }
): Promise<CallQuality | null> {
  const report = await pc.getStats();
  let rtt = 0;
  let jitter = 0;
  let packetsReceived = 0;
  let packetsLost = 0;
  let hasInbound = false;

  report.forEach((stat) => {
    const kind = (stat as any).kind ?? (stat as any).mediaType;

    if (stat.type === "inbound-rtp" && kind === "audio") {
      hasInbound = true;
      jitter = ((stat as any).jitter ?? 0) * 1000;
      packetsReceived = (stat as any).packetsReceived ?? 0;
      packetsLost = (stat as any).packetsLost ?? 0;
    }

    if (stat.type === "candidate-pair" && (stat as any).state === "succeeded") {
      const raw = (stat as any).currentRoundTripTime;
      if (typeof raw === "number") rtt = raw * 1000;
    }
  });

  if (!hasInbound) return null;

  const deltaReceived = packetsReceived - prevReceived.current;
  const deltaLost = packetsLost - prevLost.current;
  prevReceived.current = packetsReceived;
  prevLost.current = packetsLost;

  const total = deltaReceived + Math.max(0, deltaLost);
  const packetLoss = total > 0 ? Math.max(0, deltaLost) / total : 0;

  return {
    rtt,
    packetLoss,
    jitter,
    level: computeLevel(rtt, packetLoss, jitter),
  };
}

export function useCallQuality(sessionId?: string): CallQuality | null {
  const { media } = useSipKernel();
  const sessions = useSipSelector((s) => s.sessions);
  const [quality, setQuality] = useState<CallQuality | null>(null);

  const resolvedSessionId = useMemo(() => {
    if (sessionId) return sessionId;
    const active = sessions.find((s) => s.status === CallStatus.Active);
    return active?.id ?? sessions[0]?.id;
  }, [sessionId, sessions]);

  useEffect(() => {
    if (!resolvedSessionId) {
      setQuality(null);
      return;
    }

    let disposed = false;
    let peerConnection: RTCPeerConnection | null = null;
    let generation = 0;
    let counters = {
      received: { current: 0 },
      lost: { current: 0 },
    };
    const inFlight = new Set<RTCPeerConnection>();
    const poll = async () => {
      const pc = peerConnection;
      if (!pc) return;
      if (inFlight.has(pc)) return;

      const pollGeneration = generation;
      const pollCounters = counters;
      inFlight.add(pc);
      try {
        const result = await readStats(
          pc,
          pollCounters.received,
          pollCounters.lost
        );
        if (
          result &&
          !disposed &&
          pollGeneration === generation &&
          pc === peerConnection
        ) {
          setQuality(result);
        }
      } catch {
        // ignore stats errors
      } finally {
        inFlight.delete(pc);
      }
    };

    const unsubscribe = media.observePeerConnection(
      resolvedSessionId,
      (nextPeerConnection) => {
        peerConnection = nextPeerConnection;
        generation += 1;
        counters = {
          received: { current: 0 },
          lost: { current: 0 },
        };
        setQuality(null);
        void poll();
      }
    );
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      generation += 1;
      clearInterval(timer);
      unsubscribe();
    };
  }, [media, resolvedSessionId]);

  return quality;
}
