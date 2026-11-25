import { describe, expect, it } from "vitest";
import { followUp } from "../shared/contracts";
import { canContinueAutomatically, classify, isRecoveryTurn, isTransient } from "./policy";

describe("provider failure classification", () => {
  it.each([
    ["529 overloaded_error", "capacity"],
    ["HTTP 503 Service Unavailable", "upstream"],
    ["ECONNRESET", "connection"],
    ["HTTP 429 Usage limit", "quota"],
    ["You've hit your 5-hour limit · resets 6:30pm (Asia/Saigon)", "quota"],
    ["[System Error] You’ve reached your weekly limit · resets Monday", "quota"],
    ["HTTP 401 OAuth token invalid", "authentication"],
    ["Repository is missing", "other"],
    ["You've hit your context limit", "other"],
    ["429 Rate limit during HTTP 503 retry", "quota"],
  ])("classifies %s", (message, kind) => {
    expect(classify({ message })).toBe(kind);
  });

  it("leaves account problems out of the transient retry policy", () => {
    expect(isTransient("quota")).toBe(false);
    expect(isTransient("authentication")).toBe(false);
  });
});

describe("automatic continuation", () => {
  const user = { type: "user_message", text: "Draft a summary" };
  it("requires a single prompt and an otherwise untouched turn", () => {
    expect(canContinueAutomatically([user, { type: "error" }])).toBe(true);
    expect(canContinueAutomatically([{ type: "error" }])).toBe(false);
    expect(canContinueAutomatically([user, user])).toBe(false);
    expect(canContinueAutomatically([user, { type: "tool_call" }])).toBe(false);
    expect(canContinueAutomatically([user, { type: "assistant_message", text: "I changed a file" }])).toBe(false);
  });
  it("can continue from a Claude limit after switching accounts", () => {
    const refusal = { type: "assistant_message", text: "You've hit your usage limit" };
    expect(canContinueAutomatically([user, refusal])).toBe(false);
    expect(canContinueAutomatically([user, refusal], true)).toBe(true);
    expect(canContinueAutomatically([user, { type: "tool_call" }, refusal], true)).toBe(false);
  });
  it("recognizes its own continuation and stops", () => {
    const retry = [{ type: "user_message", text: followUp }];
    expect(isRecoveryTurn(retry)).toBe(true);
    expect(canContinueAutomatically(retry)).toBe(false);
  });
});
