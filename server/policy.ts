import { followUp, type Incident } from "../shared/contracts";

interface ErrorNotice {
  code?: string;
  message: string;
}

interface TurnItem {
  type: string;
  text?: string;
}

const claudeQuotaRefusal = /^(?:\[System Error\]\s*)?You['’]ve (?:hit|reached) your (?:\d+-hour|weekly) limit\b/i;

export function classify({ code = "", message }: ErrorNotice): Incident["kind"] {
  if (claudeQuotaRefusal.test(message.trimStart())) return "quota";
  const detail = `${code} ${message.slice(0, 2_000)}`;
  if (/\b(?:401|403)\b|authentication_error|OAuth|invalid API key/i.test(detail)) return "authentication";
  if (/\b429\b|\bquota\b|usage limit|rate.limit|spend limit|out of credits/i.test(detail)) return "quota";
  if (/\b529\b|\boverloaded_error\b|\b(?:server|provider|api) (?:is )?overloaded\b/i.test(detail)) return "capacity";
  if (/\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_SOCKET)\b|\bsocket hang up\b|\bconnection reset\b|\bfetch failed\b|\bnetwork error\b/i.test(detail)) return "connection";
  if (/\b(?:502|503|504)\b|\bservice unavailable\b|\bbad gateway\b|\bgateway timeout\b/i.test(detail)) return "upstream";
  return "other";
}

export function isTransient(kind: Incident["kind"]): boolean {
  return kind === "capacity" || kind === "connection" || kind === "upstream";
}

export const claudeRefusal = /^(?:You['’]ve (?:hit|reached) your [^\n]{0,40}limit|Not logged in\s*·|Invalid API key\s*·)/i;

export function isRecoveryTurn(items: readonly TurnItem[]): boolean {
  return items.some((item) => item.type === "user_message" && item.text === followUp);
}

export function canContinueAutomatically(items: readonly TurnItem[], switched = false): boolean {
  let prompts = 0;
  for (const item of items) {
    if (item.type === "user_message") {
      if (item.text === followUp || !item.text?.trim()) return false;
      prompts++;
    } else if (switched && item.type === "assistant_message" && claudeRefusal.test(item.text?.trim() ?? "")) {
      continue;
    } else if (item.type !== "error" && item.type !== "notification" && item.type !== "plugin") {
      return false;
    }
  }
  return prompts === 1;
}
