import JsSIP from "jssip";
import {
  parsePersistedDebug,
  serializeDebugSetting,
  SIP_DEBUG_DEFAULT_PATTERN,
  SIP_DEBUG_STORAGE_KEY,
} from "./sip-debug.storage";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface SipDebugToggleResult {
  debug: boolean;
  text: string;
}

export class SipDebugger {
  private readonly storageKey: string;
  private readonly defaultPattern: string;
  private enabled = false;

  constructor(
    storageKey = SIP_DEBUG_STORAGE_KEY,
    defaultPattern = SIP_DEBUG_DEFAULT_PATTERN
  ) {
    this.storageKey = storageKey;
    this.defaultPattern = defaultPattern;
  }

  initFromSession(storage: StorageLike | null = safeSessionStorage()): void {
    try {
      const saved = parsePersistedDebug(
        storage?.getItem(this.storageKey) ?? null
      );
      if (saved === false) {
        if (typeof JsSIP?.debug?.disable === "function") {
          JsSIP.debug.disable();
        } else if (typeof JsSIP?.debug?.enable === "function") {
          JsSIP.debug.enable("");
        }
        this.enabled = false;
        return;
      }
      if (saved) {
        this.enable(
          typeof saved === "string" ? saved : this.defaultPattern,
          storage
        );
      }
    } catch {
      /* ignore */
    }
  }

  enable(
    pattern: string = this.defaultPattern,
    storage: StorageLike | null = safeSessionStorage()
  ): void {
    try {
      const effectivePattern = pattern.trim() ? pattern : this.defaultPattern;
      if (typeof JsSIP?.debug?.enable === "function") {
        JsSIP.debug.enable(effectivePattern);
      }
      storage?.setItem?.(
        this.storageKey,
        serializeDebugSetting(effectivePattern)
      );
      try {
        (window as any).sipDebugBridge?.(effectivePattern);
      } catch {
        /* ignore */
      }
      this.enabled = true;
    } catch {
      /* ignore */
    }
  }

  disable(storage: StorageLike | null = safeSessionStorage()): void {
    try {
      if (typeof JsSIP?.debug?.disable === "function") {
        JsSIP.debug.disable();
      } else if (typeof JsSIP?.debug?.enable === "function") {
        JsSIP.debug.enable("");
      }
      storage?.setItem?.(this.storageKey, serializeDebugSetting(false));
      try {
        (window as any).sipDebugBridge?.(false);
      } catch {
        /* ignore */
      }
      this.enabled = false;
    } catch {
      /* ignore */
    }
  }

  toggle(
    pattern: string = this.defaultPattern,
    storage: StorageLike | null = safeSessionStorage()
  ): void {
    if (this.isEnabled()) {
      this.disable(storage);
    } else {
      this.enable(pattern, storage);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  attachToWindow(win: Window & typeof globalThis = window): void {
    const api = {
      enableDebug: (): SipDebugToggleResult => {
        this.enable();
        return { debug: this.isEnabled(), text: "press F5" };
      },
      disableDebug: (): SipDebugToggleResult => {
        this.disable();
        return { debug: this.isEnabled(), text: "press F5" };
      },
      toggleDebug: (): SipDebugToggleResult => {
        this.toggle();
        return { debug: this.isEnabled(), text: "press F5" };
      },
      debugState: (): SipDebugToggleResult => ({
        debug: this.isEnabled(),
        text: this.isEnabled() ? "enabled" : "disabled",
      }),
      sipState: () => {
        try {
          const getter = (win as any).sipState;
          return typeof getter === "function"
            ? getter()
            : "sipState helper not available; ensure client debug is enabled";
        } catch {
          return "sipState helper not available";
        }
      },
      sipSessions: () => {
        try {
          const getter = (win as any).sipSessions;
          return typeof getter === "function"
            ? getter()
            : "sipSessions helper not available; ensure client debug is enabled";
        } catch {
          return "sipSessions helper not available";
        }
      },
    };

    try {
      (win as any).sipSupport = api;
    } catch {
      /* ignore */
    }
  }
}

function safeSessionStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export const sipDebugger = new SipDebugger();
if (typeof window !== "undefined") {
  sipDebugger.attachToWindow();
  sipDebugger.initFromSession();
}
