export const SIP_DEBUG_STORAGE_KEY = "sip-debug-enabled";
export const SIP_DEBUG_DISABLED_VALUE = "__sip-debug-disabled__";
export const SIP_DEBUG_DEFAULT_PATTERN = "JsSIP:*";

export type SipDebugSetting = boolean | string | undefined;

export function parsePersistedDebug(value: string | null): SipDebugSetting {
  if (!value) return undefined;
  if (value === SIP_DEBUG_DISABLED_VALUE) return false;
  return value;
}

export function serializeDebugSetting(debug: boolean | string): string {
  if (debug === false) return SIP_DEBUG_DISABLED_VALUE;
  if (typeof debug === "string") {
    return debug.trim() ? debug : SIP_DEBUG_DISABLED_VALUE;
  }
  return SIP_DEBUG_DEFAULT_PATTERN;
}
