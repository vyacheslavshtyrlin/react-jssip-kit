import { WebRTCSessionController } from "../media/webrtc-session.controller";
import type {
  AnswerOptions,
  DTMFOptions,
  ReferOptions,
  RTCSession,
  TerminateOptions,
} from "../../sip/types";

type SessionEntry = {
  rtc: WebRTCSessionController;
  session?: RTCSession | null;
  media?: MediaStream | null;
  ownsMediaTracks: boolean;
};

type PendingMedia = {
  stream: MediaStream;
  ownsTracks: boolean;
};

export class SessionManager {
  private entries = new Map<string, SessionEntry>();
  private pendingMedia: PendingMedia | null = null;

  /**
   * Set media that will be consumed by the NEXT getOrCreateRtc call.
   * Must be called before ua.call() because JsSIP emits newRTCSession
   * synchronously inside ua.call(), before it returns the session reference.
   */
  setPendingMedia(stream: MediaStream | null, ownsTracks = false) {
    const previous = this.pendingMedia;
    if (previous?.ownsTracks && previous.stream !== stream) {
      this.stopMediaStream(previous.stream);
    }
    this.pendingMedia = stream ? { stream, ownsTracks } : null;
  }

  private stopMediaStream(stream?: MediaStream | null) {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      if (track.readyState !== "ended") track.stop();
    }
  }

  getOrCreateRtc(sessionId: string, session?: RTCSession) {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      // Consume pendingMedia set before ua.call() — it must be applied here
      // because JsSIP fires newRTCSession synchronously inside ua.call(),
      // before ua.call() returns and the caller can set media externally.
      const pendingMedia = this.pendingMedia;
      this.pendingMedia = null;
      entry = {
        rtc: new WebRTCSessionController(),
        session: null,
        media: pendingMedia?.stream ?? null,
        ownsMediaTracks: pendingMedia?.ownsTracks ?? false,
      };
      this.entries.set(sessionId, entry);
    }
    if (session) {
      entry.session = session;
      entry.rtc.setSession(session);
    }
    if (entry.media) entry.rtc.setMediaStream(entry.media);
    return entry.rtc;
  }

  getRtc(sessionId: string) {
    return this.entries.get(sessionId)?.rtc ?? null;
  }

  setSession(sessionId: string, session: RTCSession) {
    const entry = this.entries.get(sessionId);
    if (entry) {
      entry.session = session;
      entry.rtc.setSession(session);
    } else {
      this.entries.set(sessionId, {
        rtc: new WebRTCSessionController(),
        session,
        media: null,
        ownsMediaTracks: false,
      });
    }
  }

  setSessionMedia(sessionId: string, stream: MediaStream, ownsTracks = false) {
    const entry = this.entries.get(sessionId) ?? {
      rtc: new WebRTCSessionController(),
      session: null,
      media: null,
      ownsMediaTracks: false,
    };
    if (entry.ownsMediaTracks && entry.media && entry.media !== stream) {
      this.stopMediaStream(entry.media);
    }
    entry.media = stream;
    entry.ownsMediaTracks = ownsTracks;
    entry.rtc.setMediaStream(stream);
    this.entries.set(sessionId, entry);
  }

  getSession(sessionId: string) {
    return this.entries.get(sessionId)?.session ?? null;
  }

  getSessionIds() {
    return Array.from(this.entries.keys());
  }

  getSessions() {
    return Array.from(this.entries.entries()).map(([id, entry]) => ({
      id,
      session: entry.session as RTCSession,
    }));
  }

  cleanupSession(sessionId: string) {
    const entry = this.entries.get(sessionId);
    if (entry) {
      entry.rtc.cleanup(entry.ownsMediaTracks);
      this.entries.delete(sessionId);
    }
  }

  cleanupAllSessions() {
    for (const [, entry] of this.entries.entries()) {
      entry.rtc.cleanup(entry.ownsMediaTracks);
    }
    this.entries.clear();
    if (this.pendingMedia?.ownsTracks) {
      this.stopMediaStream(this.pendingMedia.stream);
    }
    this.pendingMedia = null;
  }

  answer(sessionId: string, options: AnswerOptions) {
    const rtc = this.getRtc(sessionId);
    return rtc ? rtc.answer(options) : false;
  }

  hangup(sessionId: string, options?: TerminateOptions) {
    const rtc = this.getRtc(sessionId);
    return rtc ? rtc.hangup(options) : false;
  }

  mute(sessionId: string) {
    const rtc = this.getRtc(sessionId);
    return rtc ? rtc.mute() : false;
  }

  unmute(sessionId: string) {
    const rtc = this.getRtc(sessionId);
    return rtc ? rtc.unmute() : false;
  }

  hold(sessionId: string) {
    const rtc = this.getRtc(sessionId);
    return rtc ? rtc.hold() : false;
  }

  unhold(sessionId: string) {
    const rtc = this.getRtc(sessionId);
    return rtc ? rtc.unhold() : false;
  }

  sendDTMF(sessionId: string, tones: string | number, options?: DTMFOptions) {
    const rtc = this.getRtc(sessionId);
    return rtc ? rtc.sendDTMF(tones, options) : false;
  }

  transfer(sessionId: string, target: string, options?: ReferOptions) {
    const rtc = this.getRtc(sessionId);
    return rtc ? rtc.transfer(target, options) : false;
  }

  attendedTransfer(sessionId: string, replaceSession: RTCSession): boolean {
    const rtc = this.getRtc(sessionId);
    return rtc ? rtc.attendedTransfer(replaceSession) : false;
  }
}
