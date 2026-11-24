import { afterEach, expect, test, vi } from "vitest";
import { parseQuota, readQuota } from "./quota";

afterEach(() => vi.unstubAllGlobals());

test("normalizes only known, finite provider quota windows", () => {
  const resets = "2026-11-25T10:00:00Z";
  expect(parseQuota({
    five_hour: { utilization: 32.5, resets_at: resets },
    seven_day: { utilization: 105, resets_at: null },
    seven_day_opus: { utilization: -1 },
    unknown: { utilization: 1 },
  })).toEqual([
    { id: "five_hour", label: "5 hours", usedPercent: 32.5, resetsAt: Date.parse(resets) },
    { id: "seven_day", label: "7 days", usedPercent: 100, resetsAt: null },
  ]);
});

test("distinguishes missing quota permission from missing authentication", async () => {
  vi.stubGlobal("fetch", async () => new Response(null, { status: 403 }));
  expect((await readQuota({})).quota).toMatchObject({ status: "restricted", windows: [] });
});

test("honors a usage endpoint retry-after without inventing quota", async () => {
  vi.stubGlobal("fetch", async () => new Response(null, { status: 429, headers: { "retry-after": "180" } }));
  const result = await readQuota({});
  expect(result.quota.status).toBe("unavailable");
  expect(result.retryAt).toBe(result.quota.checkedAt + 180_000);
});
