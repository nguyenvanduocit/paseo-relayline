import { z } from "zod";
import type { Quota } from "../shared/contracts";

const usages = {
  five_hour: "5 hours",
  seven_day: "7 days",
  seven_day_sonnet: "Sonnet · 7 days",
  seven_day_opus: "Opus · 7 days",
} as const;

const window = z.object({ utilization: z.number().min(0).finite(), resets_at: z.string().nullable().optional() });

export function parseQuota(input: unknown): Quota["windows"] {
  const body = z.record(z.string(), z.unknown()).safeParse(input);
  if (!body.success) return [];
  return Object.entries(usages).flatMap(([key, label]) => {
    const result = window.safeParse(body.data[key]);
    if (!result.success) return [];
    const date = Date.parse(result.data.resets_at ?? "");
    return [{
      id: key, label, usedPercent: Math.min(100, result.data.utilization),
      resetsAt: Number.isFinite(date) ? date : null,
    }];
  });
}

export async function readQuota(headers: Record<string, string>): Promise<{ quota: Quota; retryAt?: number }> {
  const checkedAt = Date.now();
  const missing = (status: Quota["status"]): Quota => ({ status, checkedAt, windows: [] });
  try {
    const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers, signal: AbortSignal.timeout(5_000), redirect: "error",
    });
    if (response.ok) {
      const windows = parseQuota(await response.json());
      return { quota: windows.length ? { status: "available", checkedAt, windows } : missing("unavailable") };
    }
    await response.body?.cancel();
    if (response.status === 429) {
      const retry = response.headers.get("retry-after");
      const seconds = Number(retry);
      const when = retry && Number.isFinite(seconds) ? checkedAt + seconds * 1_000 : Date.parse(retry ?? "");
      return { quota: missing("unavailable"), retryAt: Math.max(checkedAt + 90_000, Number.isFinite(when) ? when : 0) };
    }
    return { quota: missing(response.status === 403 ? "restricted" : "unavailable") };
  } catch {
    return { quota: missing("unavailable") };
  }
}
