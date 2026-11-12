import { afterEach, describe, expect, it, vi } from "vitest";
import type { RTCSession } from "../../../sip/types";
import { SessionManager } from "../session.manager";

class FakeTrack {
  readonly kind = "audio";
  readonly id: string;
  enabled = true;
  readyState: MediaStreamTrackState;
  readonly stop = vi.fn(() => {
    this.readyState = "ended";
  });

  constructor(id: string, readyState: MediaStreamTrackState = "live") {
    this.id = id;
    this.readyState = readyState;
  }
}

class FakeMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[] = []) {}

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }
}

const asTrack = (track: FakeTrack): MediaStreamTrack =>
  track as unknown as MediaStreamTrack;

const asStream = (stream: FakeMediaStream): MediaStream =>
  stream as unknown as MediaStream;

const createSession = () =>
  ({
    answer: vi.fn(),
    terminate: vi.fn(),
    mute: vi.fn(),
    unmute: vi.fn(),
    hold: vi.fn(),
    unhold: vi.fn(),
    sendDTMF: vi.fn(),
    refer: vi.fn(),
    remote_identity: { uri: "sip:200@example.test" },
  }) as unknown as RTCSession;

describe("SessionManager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("consumes pending media only for the next controller", () => {
    const manager = new SessionManager();
    const stream = asStream(
      new FakeMediaStream([asTrack(new FakeTrack("pending"))])
    );
    manager.setPendingMedia(stream, true);

    const first = manager.getOrCreateRtc("first");
    const second = manager.getOrCreateRtc("second");

    expect(first.mediaStream).toBe(stream);
    expect(second.mediaStream).toBeNull();
    expect(manager.getOrCreateRtc("first")).toBe(first);
  });

  it("stops replaced owned pending media but preserves external media", () => {
    const manager = new SessionManager();
    const ownedTrack = new FakeTrack("owned");
    const endedTrack = new FakeTrack("ended", "ended");
    const externalTrack = new FakeTrack("external");
    const nextTrack = new FakeTrack("next");
    manager.setPendingMedia(
      asStream(new FakeMediaStream([asTrack(ownedTrack), asTrack(endedTrack)])),
      true
    );

    manager.setPendingMedia(
      asStream(new FakeMediaStream([asTrack(externalTrack)])),
      false
    );
    manager.setPendingMedia(
      asStream(new FakeMediaStream([asTrack(nextTrack)])),
      false
    );

    expect(ownedTrack.stop).toHaveBeenCalledOnce();
    expect(endedTrack.stop).not.toHaveBeenCalled();
    expect(externalTrack.stop).not.toHaveBeenCalled();
  });

  it("updates session references and reports only live sessions", () => {
    const manager = new SessionManager();
    const first = createSession();
    const second = createSession();
    manager.getOrCreateRtc("pending");
    const firstRtc = manager.getOrCreateRtc("first", first);
    manager.setSession("second", second);

    expect(manager.getSession("first")).toBe(first);
    expect(manager.getSession("second")).toBe(second);
    expect(manager.getSession("missing")).toBeNull();
    expect(manager.getLiveSessionCount()).toBe(2);
    expect(manager.getSessionIds()).toEqual(["pending", "first", "second"]);
    expect(manager.getSessions()).toEqual([
      { id: "pending", session: null },
      { id: "first", session: first },
      { id: "second", session: second },
    ]);

    const replacement = createSession();
    manager.setSession("first", replacement);
    expect(manager.getRtc("first")).toBe(firstRtc);
    expect(firstRtc.currentSession).toBe(replacement);
  });

  it("stops an old owned stream when session media is replaced", () => {
    const manager = new SessionManager();
    const oldTrack = new FakeTrack("old");
    const nextTrack = new FakeTrack("next");
    const oldStream = asStream(new FakeMediaStream([asTrack(oldTrack)]));
    const nextStream = asStream(new FakeMediaStream([asTrack(nextTrack)]));

    manager.setSessionMedia("session-1", oldStream, true);
    manager.setSessionMedia("session-1", nextStream, true);

    expect(oldTrack.stop).toHaveBeenCalledOnce();
    expect(nextTrack.stop).not.toHaveBeenCalled();
    expect(manager.getRtc("session-1")?.mediaStream).toBe(nextStream);
  });

  it("does not stop caller-owned media during replacement or cleanup", () => {
    const manager = new SessionManager();
    const firstTrack = new FakeTrack("first");
    const secondTrack = new FakeTrack("second");
    manager.setSessionMedia(
      "session-1",
      asStream(new FakeMediaStream([asTrack(firstTrack)])),
      false
    );
    manager.setSessionMedia(
      "session-1",
      asStream(new FakeMediaStream([asTrack(secondTrack)])),
      false
    );

    manager.cleanupSession("session-1");

    expect(firstTrack.stop).not.toHaveBeenCalled();
    expect(secondTrack.stop).not.toHaveBeenCalled();
    expect(manager.getRtc("session-1")).toBeNull();
  });

  it("stops owned media during per-session and global cleanup", () => {
    const manager = new SessionManager();
    const sessionTrack = new FakeTrack("session");
    const anotherTrack = new FakeTrack("another");
    const pendingTrack = new FakeTrack("pending");
    manager.setSessionMedia(
      "session-1",
      asStream(new FakeMediaStream([asTrack(sessionTrack)])),
      true
    );
    manager.setSessionMedia(
      "session-2",
      asStream(new FakeMediaStream([asTrack(anotherTrack)])),
      true
    );
    manager.setPendingMedia(
      asStream(new FakeMediaStream([asTrack(pendingTrack)])),
      true
    );

    manager.cleanupSession("session-1");
    manager.cleanupAllSessions();

    expect(sessionTrack.stop).toHaveBeenCalledOnce();
    expect(anotherTrack.stop).toHaveBeenCalledOnce();
    expect(pendingTrack.stop).toHaveBeenCalledOnce();
    expect(manager.getSessionIds()).toEqual([]);
  });

  it("delegates call commands to the matching controller", () => {
    const manager = new SessionManager();
    const session = createSession();
    const replacement = createSession();
    manager.setSession("session-1", session);
    const answerOptions = { mediaConstraints: { audio: true, video: false } };
    const terminateOptions = { status_code: 603, reason_phrase: "Decline" };

    expect(manager.answer("session-1", answerOptions)).toBe(true);
    expect(manager.hangup("session-1", terminateOptions)).toBe(true);
    expect(manager.mute("session-1")).toBe(true);
    expect(manager.unmute("session-1")).toBe(true);
    expect(manager.hold("session-1")).toBe(true);
    expect(manager.unhold("session-1")).toBe(true);
    expect(manager.sendDTMF("session-1", "12", { duration: 200 })).toBe(true);
    expect(
      manager.transfer("session-1", "sip:300@example.test", {
        extraHeaders: ["X-Test: value"],
      })
    ).toBe(true);
    expect(manager.attendedTransfer("session-1", replacement)).toBe(true);

    expect(session.answer).toHaveBeenCalledWith(answerOptions);
    expect(session.terminate).toHaveBeenCalledWith(terminateOptions);
    expect(session.mute).toHaveBeenCalledWith({ audio: true });
    expect(session.unmute).toHaveBeenCalledWith({ audio: true });
    expect(session.hold).toHaveBeenCalledOnce();
    expect(session.unhold).toHaveBeenCalledOnce();
    expect(session.sendDTMF).toHaveBeenCalledWith("12", { duration: 200 });
    expect(session.refer).toHaveBeenCalledWith("sip:300@example.test", {
      extraHeaders: ["X-Test: value"],
    });
    expect(session.refer).toHaveBeenCalledWith("sip:200@example.test", {
      replaces: replacement,
    });
  });

  it("returns false for commands targeting an unknown session", () => {
    const manager = new SessionManager();
    const replacement = createSession();

    expect(manager.answer("missing", {})).toBe(false);
    expect(manager.hangup("missing")).toBe(false);
    expect(manager.mute("missing")).toBe(false);
    expect(manager.unmute("missing")).toBe(false);
    expect(manager.hold("missing")).toBe(false);
    expect(manager.unhold("missing")).toBe(false);
    expect(manager.sendDTMF("missing", "1")).toBe(false);
    expect(manager.transfer("missing", "sip:200@example.test")).toBe(false);
    expect(manager.attendedTransfer("missing", replacement)).toBe(false);
  });
});
