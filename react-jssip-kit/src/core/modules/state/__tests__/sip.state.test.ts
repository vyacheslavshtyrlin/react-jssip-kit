import { describe, expect, it } from "vitest";
import { SipStatus } from "../../../contracts/state";
import { getInitialSipState, shallowEqual } from "../sip.state";

describe("sip.state helpers", () => {
  it("creates an empty disconnected state", () => {
    expect(getInitialSipState()).toEqual({
      sipStatus: SipStatus.Disconnected,
      error: null,
      sessions: [],
      sessionsById: {},
      sessionIds: [],
    });
  });

  it("recognizes identical references and shallow-equal objects", () => {
    const value = { status: "connected", count: 1 };

    expect(shallowEqual(value, value)).toBe(true);
    expect(shallowEqual(value, { status: "connected", count: 1 })).toBe(true);
  });

  it.each([
    [null, {}],
    [{}, null],
    ["connected", "registered"],
    [{ status: "connected" }, { status: "registered" }],
    [{ status: "connected" }, { status: "connected", error: null }],
  ])("rejects values that are not shallow-equal", (left, right) => {
    expect(shallowEqual(left, right)).toBe(false);
  });
});
