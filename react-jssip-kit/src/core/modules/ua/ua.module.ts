import type { UA } from "jssip";
import type { SipUserAgent } from "../../sip/user-agent";
import type { SipConfiguration, UAEventMap } from "../../sip/types";
import { createUAHandlers } from "./ua.handlers";

type UaModuleDeps = {
  userAgent: SipUserAgent;
  createHandlers: () => Partial<UAEventMap>;
};

export class UaModule {
  private readonly userAgent: SipUserAgent;
  private readonly uaHandlers: Partial<UAEventMap>;
  private readonly uaHandlerKeys: (keyof UAEventMap)[];

  constructor(deps: UaModuleDeps) {
    this.userAgent = deps.userAgent;
    this.uaHandlers = deps.createHandlers();
    this.uaHandlerKeys = Object.keys(this.uaHandlers) as (keyof UAEventMap)[];
  }

  start(
    uri: string,
    password: string,
    config: Omit<SipConfiguration, "debug">,
    debug?: boolean | string
  ) {
    const ua = this.prepareStart(uri, password, config);
    this.startPrepared(ua, debug);
  }

  prepareStart(
    uri: string,
    password: string,
    config: Omit<SipConfiguration, "debug">
  ) {
    return this.userAgent.prepareStart(uri, password, config);
  }

  startPrepared(ua: UA, debug?: boolean | string) {
    this.stop();
    this.userAgent.startPrepared(ua, {
      debug,
      beforeStart: () => this.attachHandlers(),
      onStartError: () => this.detachHandlers(),
    });
  }

  stop() {
    this.detachHandlers();
    this.userAgent.stop();
  }

  register() {
    this.userAgent.register();
  }

  setDebug(debug?: boolean | string) {
    this.userAgent.setDebug(debug);
  }

  private attachHandlers() {
    const ua = this.userAgent.ua;
    if (!ua) return;

    this.detachHandlers();
    this.uaHandlerKeys.forEach((event) => {
      const handler = this.uaHandlers[event];
      if (handler) ua.on(event, handler);
    });
  }

  private detachHandlers() {
    const ua = this.userAgent.ua;
    if (!ua) return;
    this.uaHandlerKeys.forEach((event) => {
      const handler = this.uaHandlers[event];
      // jssip 3.13.x UA.d.ts only declares `on`; removeListener is
      // available at runtime via EventEmitter but not typed in the declaration
      if (!handler) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ua as any).removeListener(event, handler);
      } catch (error) {
        console.error("[react-jssip-kit] UA handler detach failed", error);
      }
    });
  }
}

export function createUaHandlers(deps: Parameters<typeof createUAHandlers>[0]) {
  return createUAHandlers(deps);
}
