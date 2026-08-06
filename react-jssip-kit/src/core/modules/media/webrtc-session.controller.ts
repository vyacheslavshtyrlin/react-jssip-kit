import type {
  AnswerOptions,
  DTMFOptions,
  ReferOptions,
  RTCSession,
  TerminateOptions,
} from "../../sip/types";

export class WebRTCSessionController {
  currentSession: RTCSession | null = null;
  mediaStream: MediaStream | null = null;

  public setSession(session: RTCSession | null) {
    this.currentSession = session;
  }

  public setMediaStream(stream: MediaStream) {
    this.mediaStream = stream;
  }

  private getPC(): RTCPeerConnection | null {
    return (this.currentSession as any)?.connection ?? null;
  }

  public cleanup(stopTracks: boolean = false): void {
    const pc = this.getPC();
    const isClosed =
      pc?.connectionState === "closed" || pc?.signalingState === "closed";

    if (pc && typeof pc.getSenders === "function") {
      if (!isClosed) {
        for (const sender of pc.getSenders()) {
          try {
            void sender.replaceTrack(null).catch(() => {});
          } catch {
            // ignore if sender/pc already closed
          }
        }
      }
    }

    if (stopTracks && this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
    }

    this.mediaStream = null;
    this.currentSession = null;
  }

  public answer(options: AnswerOptions = {}): boolean {
    return this.currentSession
      ? (this.currentSession.answer(options), true)
      : false;
  }

  public hangup(options?: TerminateOptions): boolean {
    if (!this.currentSession) return false;
    try {
      this.currentSession.terminate(
        options ?? ({ status_code: 486, reason_phrase: "Busy Here" } as any)
      );
    } catch {
      // Session may already be terminated at the JsSIP level; ignore.
    }
    return true;
  }

  public mute(): boolean {
    this.mediaStream
      ?.getAudioTracks()
      .forEach((track) => (track.enabled = false));
    return this.currentSession
      ? (this.currentSession.mute({ audio: true }), true)
      : false;
  }

  public unmute(): boolean {
    this.mediaStream
      ?.getAudioTracks()
      .forEach((track) => (track.enabled = true));
    return this.currentSession
      ? (this.currentSession.unmute({ audio: true }), true)
      : false;
  }

  public hold(): boolean {
    return this.currentSession ? (this.currentSession.hold(), true) : false;
  }

  public unhold(): boolean {
    return this.currentSession ? (this.currentSession.unhold(), true) : false;
  }

  public sendDTMF(tones: string | number, options?: DTMFOptions): boolean {
    return this.currentSession
      ? (this.currentSession.sendDTMF(tones, options), true)
      : false;
  }

  public transfer(target: string, options?: ReferOptions): boolean {
    return this.currentSession
      ? (this.currentSession.refer(target as any, options), true)
      : false;
  }

  public attendedTransfer(replaceSession: RTCSession): boolean {
    if (!this.currentSession) return false;
    const target = replaceSession.remote_identity.uri;
    this.currentSession.refer(target, { replaces: replaceSession });
    return true;
  }

  public async replaceAudioTrack(
    nextAudioTrack: MediaStreamTrack
  ): Promise<boolean> {
    const pc = this.getPC();
    if (!pc) return false;

    if (!this.mediaStream) this.mediaStream = new MediaStream();

    const old = this.mediaStream.getAudioTracks()[0];
    this.mediaStream.addTrack(nextAudioTrack);
    if (old) this.mediaStream.removeTrack(old);

    const sender = pc
      .getSenders?.()
      .find((entry) => entry.track?.kind === "audio");
    if (sender) await sender.replaceTrack(nextAudioTrack);

    if (old && old !== nextAudioTrack) old.stop();

    return true;
  }
}
