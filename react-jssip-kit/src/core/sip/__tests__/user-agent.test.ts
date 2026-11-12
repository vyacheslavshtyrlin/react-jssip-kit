import type { UA } from "jssip";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SipConfiguration, UAConfiguration } from "../types";
import { SipUserAgent } from "../user-agent";

type FakeUa = {
  isRegistered: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
};

const createUa = (registered = false): FakeUa => ({
  isRegistered: vi.fn(() => registered),
  register: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  unregister: vi.fn(),
});

class TestSipUserAgent extends SipUserAgent {
  readonly applyDebugSpy = vi.fn();
  readonly createUaSpy = vi.fn<(config: UAConfiguration) => UA>();

  protected override applyDebug(debug?: boolean | string): void {
    this.applyDebugSpy(debug);
  }

  protected override createUA(config: UAConfiguration): UA {
    return this.createUaSpy(config);
  }
}

const config = (sockets: unknown = [{}]): Omit<SipConfiguration, "debug"> =>
  ({ sockets }) as Omit<SipConfiguration, "debug">;

describe("SipUserAgent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("builds a validated UA and exposes the active lifecycle", () => {
    const userAgent = new TestSipUserAgent();
    const ua = createUa();
    userAgent.createUaSpy.mockReturnValue(ua as unknown as UA);

    const result = userAgent.start("sip:100@example.test", "secret", config(), {
      debug: "JsSIP:UA",
    });

    expect(userAgent.createUaSpy).toHaveBeenCalledWith({
      sockets: [{}],
      uri: "sip:100@example.test",
      password: "secret",
    });
    expect(userAgent.applyDebugSpy).toHaveBeenCalledWith("JsSIP:UA");
    expect(ua.start).toHaveBeenCalledOnce();
    expect(result).toBe(ua);
    expect(userAgent.ua).toBe(ua);
    expect(userAgent.getUA()).toBe(ua);
    expect(userAgent.isStarted).toBe(true);
    expect(userAgent.isRegistered).toBe(false);
  });

  it.each([
    ["", "secret", [{}]],
    ["sip:100@example.test", "", [{}]],
    ["sip:100@example.test", "secret", null],
    ["sip:100@example.test", "secret", []],
  ])("rejects invalid connect arguments", (uri, password, sockets) => {
    const userAgent = new TestSipUserAgent();

    expect(() =>
      userAgent.validateStart(uri, password, config(sockets))
    ).toThrow("require uri, password, and at least one socket");
    expect(userAgent.createUaSpy).not.toHaveBeenCalled();
  });

  it("replaces an active UA and calls startup hooks in order", () => {
    const userAgent = new TestSipUserAgent();
    const first = createUa(true);
    const second = createUa();
    const beforeStart = vi.fn();
    userAgent.startPrepared(first as unknown as UA);

    userAgent.startPrepared(second as unknown as UA, { beforeStart });

    expect(first.unregister).toHaveBeenCalledOnce();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(beforeStart).toHaveBeenCalledWith(second);
    expect(second.start).toHaveBeenCalledOnce();
    expect(userAgent.ua).toBe(second);
  });

  it("rolls back startup while preserving the original error", () => {
    const userAgent = new TestSipUserAgent();
    const ua = createUa();
    const startupError = new Error("start failed");
    const cleanupError = new Error("handler cleanup failed");
    const stopError = new Error("stop failed");
    const onStartError = vi.fn(() => {
      throw cleanupError;
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    ua.start.mockImplementation(() => {
      throw startupError;
    });
    ua.stop.mockImplementation(() => {
      throw stopError;
    });

    expect(() =>
      userAgent.startPrepared(ua as unknown as UA, { onStartError })
    ).toThrow(startupError);
    expect(onStartError).toHaveBeenCalledWith(ua);
    expect(userAgent.ua).toBeNull();
    expect(userAgent.isStarted).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      "[react-jssip-kit] UA handler cleanup failed",
      cleanupError
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[react-jssip-kit] UA start cleanup failed",
      stopError
    );
  });

  it("registers only when needed and clears state even if stop fails", () => {
    const userAgent = new TestSipUserAgent();
    const ua = createUa(false);
    userAgent.register();
    expect(ua.register).not.toHaveBeenCalled();

    userAgent.startPrepared(ua as unknown as UA);
    userAgent.register();
    expect(ua.register).toHaveBeenCalledOnce();

    ua.isRegistered.mockReturnValue(true);
    expect(userAgent.isRegistered).toBe(true);
    const stopError = new Error("stop failed");
    ua.stop.mockImplementation(() => {
      throw stopError;
    });
    expect(() => userAgent.stop()).toThrow(stopError);
    expect(ua.unregister).toHaveBeenCalledOnce();
    expect(userAgent.ua).toBeNull();
  });

  it("updates debug without starting a UA", () => {
    const userAgent = new TestSipUserAgent();

    userAgent.setDebug(false);

    expect(userAgent.applyDebugSpy).toHaveBeenCalledWith(false);
  });
});
