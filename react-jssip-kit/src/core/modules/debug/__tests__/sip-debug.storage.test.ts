import { describe, expect, it } from "vitest";
import {
  parsePersistedDebug,
  serializeDebugSetting,
  SIP_DEBUG_DEFAULT_PATTERN,
  SIP_DEBUG_DISABLED_VALUE,
} from "../sip-debug.storage";

describe("SIP debug storage", () => {
  it.each([null, ""])("treats %s as an absent override", (value) => {
    expect(parsePersistedDebug(value)).toBeUndefined();
  });

  it("restores disabled and custom debug settings", () => {
    expect(parsePersistedDebug(SIP_DEBUG_DISABLED_VALUE)).toBe(false);
    expect(parsePersistedDebug("JsSIP:Transport")).toBe("JsSIP:Transport");
  });

  it("serializes every supported runtime setting", () => {
    expect(serializeDebugSetting(false)).toBe(SIP_DEBUG_DISABLED_VALUE);
    expect(serializeDebugSetting(true)).toBe(SIP_DEBUG_DEFAULT_PATTERN);
    expect(serializeDebugSetting("JsSIP:UA")).toBe("JsSIP:UA");
    expect(serializeDebugSetting("   ")).toBe(SIP_DEBUG_DISABLED_VALUE);
  });
});
