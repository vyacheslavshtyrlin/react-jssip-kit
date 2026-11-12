import type { UA } from "jssip";
import { describe, expect, it, vi } from "vitest";
import type { SipUserAgent } from "../../../sip/user-agent";
import type { SipConfiguration, UAEventMap } from "../../../sip/types";
import { UaModule } from "../ua.module";

type StartOptions = Parameters<SipUserAgent["startPrepared"]>[1];

const createHarness = () => {
  const ua = {
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const preparedUa = { name: "prepared" } as unknown as UA;
  const userAgent = {
    get ua() {
      return ua as unknown as UA;
    },
    prepareStart: vi.fn(() => preparedUa),
    startPrepared: vi.fn(),
    stop: vi.fn(),
    register: vi.fn(),
    setDebug: vi.fn(),
  };
  const handlers: Partial<UAEventMap> = {
    connected: vi.fn(),
    disconnected: vi.fn(),
  };
  const module = new UaModule({
    userAgent: userAgent as unknown as SipUserAgent,
    createHandlers: () => handlers,
  });
  return { handlers, module, preparedUa, ua, userAgent };
};

describe("UaModule", () => {
  it("prepares and starts a UA with managed handlers", () => {
    const { handlers, module, preparedUa, ua, userAgent } = createHarness();
    const config = { sockets: [{}] } as unknown as Omit<
      SipConfiguration,
      "debug"
    >;

    module.start("sip:100@example.test", "secret", config, "JsSIP:UA");

    expect(userAgent.prepareStart).toHaveBeenCalledWith(
      "sip:100@example.test",
      "secret",
      config
    );
    expect(userAgent.stop).toHaveBeenCalledOnce();
    expect(userAgent.startPrepared).toHaveBeenCalledWith(
      preparedUa,
      expect.objectContaining({ debug: "JsSIP:UA" })
    );

    const options = userAgent.startPrepared.mock.calls[0]?.[1] as StartOptions;
    options?.beforeStart?.(preparedUa);
    expect(ua.on).toHaveBeenCalledWith("connected", handlers.connected);
    expect(ua.on).toHaveBeenCalledWith("disconnected", handlers.disconnected);

    options?.onStartError?.(preparedUa);
    expect(ua.removeListener).toHaveBeenCalledWith(
      "connected",
      handlers.connected
    );
  });

  it("delegates register and runtime debug settings", () => {
    const { module, userAgent } = createHarness();

    module.register();
    module.setDebug(false);

    expect(userAgent.register).toHaveBeenCalledOnce();
    expect(userAgent.setDebug).toHaveBeenCalledWith(false);
  });

  it("detaches every handler before stopping", () => {
    const { handlers, module, ua, userAgent } = createHarness();

    module.stop();

    expect(ua.removeListener).toHaveBeenCalledWith(
      "connected",
      handlers.connected
    );
    expect(ua.removeListener).toHaveBeenCalledWith(
      "disconnected",
      handlers.disconnected
    );
    expect(userAgent.stop).toHaveBeenCalledOnce();
  });

  it("continues detaching after an EventEmitter failure", () => {
    const { module, ua } = createHarness();
    const error = new Error("remove failed");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    ua.removeListener.mockImplementationOnce(() => {
      throw error;
    });

    module.stop();

    expect(ua.removeListener).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith(
      "[react-jssip-kit] UA handler detach failed",
      error
    );
    consoleError.mockRestore();
  });
});
