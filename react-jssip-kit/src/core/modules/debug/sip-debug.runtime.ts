import type { SipState } from "../../contracts/state";
import {
  parsePersistedDebug,
  serializeDebugSetting,
  SIP_DEBUG_STORAGE_KEY,
  type SipDebugSetting,
} from "./sip-debug.storage";

type DebugRuntimeDeps = {
  getState: () => SipState;
  onChange: (listener: (state: SipState) => void) => () => void;
  getSessions: () => unknown;
  setDebugEnabled: (enabled: boolean) => void;
};

export class SipDebugRuntime {
  private readonly deps: DebugRuntimeDeps;
  private stateLogOff?: () => void;

  constructor(deps: DebugRuntimeDeps) {
    this.deps = deps;
  }

  attachBridge(setDebug: (debug?: boolean | string) => void): void {
    if (typeof window === "undefined") return;
    (window as any).sipDebugBridge = (debug?: boolean | string) =>
      setDebug(debug ?? true);
  }

  getPersistedDebug(): SipDebugSetting {
    if (typeof window === "undefined") return undefined;
    try {
      return parsePersistedDebug(
        window.sessionStorage.getItem(SIP_DEBUG_STORAGE_KEY)
      );
    } catch {
      return undefined;
    }
  }

  persistDebugOverride(debug?: boolean | string): void {
    if (typeof window === "undefined") return;
    try {
      if (debug === undefined) {
        window.sessionStorage.removeItem(SIP_DEBUG_STORAGE_KEY);
        return;
      }
      window.sessionStorage.setItem(
        SIP_DEBUG_STORAGE_KEY,
        serializeDebugSetting(debug)
      );
    } catch {
      /* ignore */
    }
  }

  syncInspector(effectiveDebug?: boolean | string): void {
    if (typeof window === "undefined") return;

    const enabled = Boolean(effectiveDebug);
    this.deps.setDebugEnabled(enabled);
    this.toggleStateLogger(enabled);

    const win = window as any;
    const disabledInspector = () => {
      console.warn("SIP debug inspector disabled; enable debug to inspect.");
      return null;
    };

    win.sipState = () => (enabled ? this.deps.getState() : disabledInspector());
    win.sipSessions = () =>
      enabled ? this.deps.getSessions() : disabledInspector();
  }

  cleanup(): void {
    this.toggleStateLogger(false);
  }

  private toggleStateLogger(enabled: boolean): void {
    if (!enabled) {
      this.stateLogOff?.();
      this.stateLogOff = undefined;
      return;
    }
    if (this.stateLogOff) return;

    let prev = this.deps.getState();
    console.info("[sip][state]", { initial: true }, prev);

    this.stateLogOff = this.deps.onChange((next) => {
      console.info("[sip][state]", next);
      prev = next;
    });
  }
}
