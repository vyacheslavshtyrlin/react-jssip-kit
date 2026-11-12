import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RTCSession } from "../../../sip/types";
import { WebRTCSessionController } from "../webrtc-session.controller";

class FakeTrack extends EventTarget {
  readonly kind = "audio";
  readonly id: string;
  enabled = true;
  readyState: MediaStreamTrackState = "live";
  readonly stop = vi.fn(() => {
    this.readyState = "ended";
  });

  constructor(id: string) {
    super();
    this.id = id;
  }
}

class FakeMediaStream {
  private tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track);
  }

  removeTrack(track: MediaStreamTrack): void {
    this.tracks = this.tracks.filter((current) => current !== track);
  }
}

const asTrack = (track: FakeTrack): MediaStreamTrack =>
  track as unknown as MediaStreamTrack;

const asStream = (stream: FakeMediaStream): MediaStream =>
  stream as unknown as MediaStream;

const createSession = (connection?: RTCPeerConnection) =>
  ({
    connection,
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

describe("WebRTCSessionController", () => {
  beforeEach(() => {
    vi.stubGlobal("MediaStream", FakeMediaStream);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns false when session commands have no session", () => {
    const controller = new WebRTCSessionController();

    expect(controller.answer()).toBe(false);
    expect(controller.hangup()).toBe(false);
    expect(controller.mute()).toBe(false);
    expect(controller.unmute()).toBe(false);
    expect(controller.hold()).toBe(false);
    expect(controller.unhold()).toBe(false);
    expect(controller.sendDTMF("1")).toBe(false);
    expect(controller.transfer("sip:200@example.test")).toBe(false);
    expect(controller.attendedTransfer(createSession())).toBe(false);
  });

  it("delegates call controls and updates local audio state", () => {
    const controller = new WebRTCSessionController();
    const session = createSession();
    const track = new FakeTrack("track-1");
    controller.setSession(session);
    controller.setMediaStream(asStream(new FakeMediaStream([asTrack(track)])));
    const answerOptions = { mediaConstraints: { audio: true, video: false } };

    expect(controller.answer(answerOptions)).toBe(true);
    expect(controller.mute()).toBe(true);
    expect(track.enabled).toBe(false);
    expect(controller.unmute()).toBe(true);
    expect(track.enabled).toBe(true);
    expect(controller.hold()).toBe(true);
    expect(controller.unhold()).toBe(true);
    expect(controller.sendDTMF("12", { duration: 200 })).toBe(true);
    expect(controller.transfer("sip:300@example.test")).toBe(true);

    expect(session.answer).toHaveBeenCalledWith(answerOptions);
    expect(session.mute).toHaveBeenCalledWith({ audio: true });
    expect(session.unmute).toHaveBeenCalledWith({ audio: true });
    expect(session.hold).toHaveBeenCalledOnce();
    expect(session.unhold).toHaveBeenCalledOnce();
    expect(session.sendDTMF).toHaveBeenCalledWith("12", { duration: 200 });
    expect(session.refer).toHaveBeenCalledWith(
      "sip:300@example.test",
      undefined
    );
  });

  it("uses the default hangup reason and tolerates a terminated session", () => {
    const controller = new WebRTCSessionController();
    const session = createSession();
    vi.mocked(session.terminate).mockImplementation(() => {
      throw new Error("already terminated");
    });
    controller.setSession(session);

    expect(controller.hangup()).toBe(true);
    expect(session.terminate).toHaveBeenCalledWith({
      status_code: 486,
      reason_phrase: "Busy Here",
    });
  });

  it("performs an attended transfer using the replacement identity", () => {
    const controller = new WebRTCSessionController();
    const session = createSession();
    const replacement = createSession();
    controller.setSession(session);

    expect(controller.attendedTransfer(replacement)).toBe(true);
    expect(session.refer).toHaveBeenCalledWith("sip:200@example.test", {
      replaces: replacement,
    });
  });

  it("detaches senders, optionally stops owned tracks, and clears state", () => {
    const replaceTrack = vi.fn().mockResolvedValue(undefined);
    const pc = {
      connectionState: "connected",
      signalingState: "stable",
      getSenders: () => [{ replaceTrack }],
    } as unknown as RTCPeerConnection;
    const session = createSession(pc);
    const track = new FakeTrack("track-1");
    const controller = new WebRTCSessionController();
    controller.setSession(session);
    controller.setMediaStream(asStream(new FakeMediaStream([asTrack(track)])));

    controller.cleanup(true);

    expect(replaceTrack).toHaveBeenCalledWith(null);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(controller.currentSession).toBeNull();
    expect(controller.mediaStream).toBeNull();
  });

  it("does not touch senders on an already closed PeerConnection", () => {
    const replaceTrack = vi.fn();
    const pc = {
      connectionState: "closed",
      signalingState: "closed",
      getSenders: () => [{ replaceTrack }],
    } as unknown as RTCPeerConnection;
    const controller = new WebRTCSessionController();
    controller.setSession(createSession(pc));

    controller.cleanup();

    expect(replaceTrack).not.toHaveBeenCalled();
  });

  it("replaces the audio sender and disposes the previous track", async () => {
    const oldTrack = new FakeTrack("old");
    const nextTrack = new FakeTrack("next");
    const replaceTrack = vi.fn().mockResolvedValue(undefined);
    const pc = {
      getSenders: () => [
        { track: asTrack(oldTrack), replaceTrack },
        { track: { kind: "video" }, replaceTrack: vi.fn() },
      ],
    } as unknown as RTCPeerConnection;
    const stream = new FakeMediaStream([asTrack(oldTrack)]);
    const controller = new WebRTCSessionController();
    controller.setSession(createSession(pc));
    controller.setMediaStream(asStream(stream));

    await expect(
      controller.replaceAudioTrack(asTrack(nextTrack))
    ).resolves.toBe(true);

    expect(replaceTrack).toHaveBeenCalledWith(asTrack(nextTrack));
    expect(stream.getAudioTracks()).toEqual([asTrack(nextTrack)]);
    expect(oldTrack.stop).toHaveBeenCalledOnce();
  });

  it("creates a media stream when replacing the first audio track", async () => {
    const nextTrack = new FakeTrack("next");
    const pc = { getSenders: () => [] } as unknown as RTCPeerConnection;
    const controller = new WebRTCSessionController();
    controller.setSession(createSession(pc));

    await expect(
      controller.replaceAudioTrack(asTrack(nextTrack))
    ).resolves.toBe(true);

    expect(controller.mediaStream?.getAudioTracks()).toEqual([
      asTrack(nextTrack),
    ]);
  });
});
