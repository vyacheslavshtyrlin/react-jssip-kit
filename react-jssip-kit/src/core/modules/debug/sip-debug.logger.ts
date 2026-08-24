import { detachSessionListener } from "../../sip/session-listeners";
type PcSnapshot = {
  connectionState?: RTCPeerConnectionState;
  signalingState?: RTCSignalingState;
  iceConnectionState?: RTCIceConnectionState;
};

const describePc = (pc?: RTCPeerConnection | null): PcSnapshot => ({
  connectionState: pc?.connectionState,
  signalingState: pc?.signalingState,
  iceConnectionState: pc?.iceConnectionState,
});

export class SipDebugLogger {
  private enabled = false;
  private statsStops = new Map<string, () => void>();

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.statsStops.forEach((stop) => stop());
      this.statsStops.clear();
    }
  }

  isEnabled() {
    return this.enabled;
  }

  logLocalAudioError(
    sessionId: string,
    message: string,
    pc?: RTCPeerConnection | null,
    extra?: Record<string, unknown>
  ) {
    if (!this.enabled) return;
    console.error(message, {
      sessionId,
      pc: describePc(pc),
      ...extra,
    });
    void this.logOutboundStats(sessionId, pc, message);
  }

  logRemoteAudioError(
    sessionId: string,
    message: string,
    pc?: RTCPeerConnection | null,
    extra?: Record<string, unknown>
  ) {
    if (!this.enabled) return;
    console.error(message, {
      sessionId,
      pc: describePc(pc),
      ...extra,
    });
    void this.logInboundStats(sessionId, pc, message);
  }

  logMicRecoveryDrop(payload: {
    sessionId?: string;
    trackLive?: boolean;
    senderLive?: boolean;
  }) {
    if (!this.enabled) return;
    console.error("[sip] microphone dropped", payload);
  }

  logIceReady(sessionId: string, payload: Record<string, unknown>) {
    if (!this.enabled) return;
    console.info("[sip] ice ready", { sessionId, ...payload });
  }

  logIceReadyConfig(sessionId: string, delayMs: number) {
    if (!this.enabled) return;
    console.info("[sip] ice ready config", { sessionId, delayMs });
  }

  logIceRestart(sessionId: string, payload: Record<string, unknown>) {
    if (!this.enabled) return;
    console.info("[sip] ice restart", { sessionId, ...payload });
  }

  startCallStatsLogging(sessionId: string, session: any) {
    if (!this.enabled || this.statsStops.has(sessionId)) return;

    let pc: RTCPeerConnection | null =
      (session as { connection?: RTCPeerConnection })?.connection ?? null;
    const onPeer = (data: { peerconnection: RTCPeerConnection }) => {
      pc = data.peerconnection;
    };
    session.on?.("peerconnection", onPeer);

    const intervalMs = 3000;
    const logStats = async () => {
      if (!this.enabled || !pc?.getStats) return;
      try {
        const report = await pc.getStats();
        const { outboundAudio, inboundAudio } = collectAudioStats(report);
        console.info("[sip] call stats", {
          sessionId,
          pc: describePc(pc),
          outboundAudio,
          inboundAudio,
        });
      } catch (err) {
        console.error("[sip] call stats failed", { sessionId, error: err });
      }
    };

    const timer = setInterval(() => {
      void logStats();
    }, intervalMs);
    void logStats();

    const stop = () => {
      clearInterval(timer);
      detachSessionListener(session, "peerconnection", onPeer);
      this.statsStops.delete(sessionId);
    };
    this.statsStops.set(sessionId, stop);
  }

  stopCallStatsLogging(sessionId: string) {
    const stop = this.statsStops.get(sessionId);
    if (stop) stop();
  }

  private async logOutboundStats(
    sessionId: string,
    pc?: RTCPeerConnection | null,
    context?: string
  ) {
    if (!pc?.getStats) return;
    try {
      const report = await pc.getStats();
      const { outboundAudio } = collectAudioStats(report);
      if (outboundAudio.length) {
        console.info("[sip] outgoing audio stats", {
          sessionId,
          context,
          outboundAudio,
        });
      }
    } catch (err) {
      console.error("[sip] outgoing audio stats failed", {
        sessionId,
        context,
        error: err,
      });
    }
  }

  private async logInboundStats(
    sessionId: string,
    pc?: RTCPeerConnection | null,
    context?: string
  ) {
    if (!pc?.getStats) return;
    try {
      const report = await pc.getStats();
      const { inboundAudio } = collectAudioStats(report);
      if (inboundAudio.length) {
        console.error("[sip] incoming audio stats", {
          sessionId,
          context,
          inboundAudio,
        });
      }
    } catch (err) {
      console.error("[sip] incoming audio stats failed", {
        sessionId,
        context,
        error: err,
      });
    }
  }
}

export const sipDebugLogger = new SipDebugLogger();

function collectAudioStats(report: RTCStatsReport) {
  const outboundAudio: Array<Record<string, unknown>> = [];
  const inboundAudio: Array<Record<string, unknown>> = [];

  report.forEach((stat) => {
    const kind = (stat as any).kind ?? (stat as any).mediaType;
    if (stat.type === "outbound-rtp" && kind === "audio") {
      outboundAudio.push({
        id: stat.id,
        packetsSent: (stat as any).packetsSent,
        bytesSent: (stat as any).bytesSent,
        jitter: (stat as any).jitter,
        roundTripTime: (stat as any).roundTripTime,
      });
    }
    if (stat.type === "inbound-rtp" && kind === "audio") {
      inboundAudio.push({
        id: stat.id,
        packetsReceived: (stat as any).packetsReceived,
        packetsLost: (stat as any).packetsLost,
        bytesReceived: (stat as any).bytesReceived,
        jitter: (stat as any).jitter,
        roundTripTime: (stat as any).roundTripTime,
      });
    }
  });

  return { outboundAudio, inboundAudio };
}
