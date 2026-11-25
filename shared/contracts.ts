import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const preferences = defineSettings({
  id: "recovery",
  scope: "host",
  version: 1,
  schema: z.object({
    mode: z.enum(["manual", "automatic", "observe"]).default("manual"),
    scope: z.enum(["all", "claude"]).default("all"),
    accountPolicy: z.enum(["off", "sticky", "spread"]).default("off"),
    delay: z.enum(["15", "45", "120"]).default("45"),
  }),
});

export const incidentSchema = z.object({
  id: z.string(),
  kind: z.enum(["capacity", "connection", "upstream", "quota", "authentication", "other"]),
  switched: z.boolean().default(false),
  stage: z.enum(["recorded", "ready", "scheduled", "sent", "superseded", "unconfirmed"]),
});

export type Incident = z.infer<typeof incidentSchema>;
export type Preferences = z.output<typeof preferences.schema>;
export const incidentRow = { kind: "recovery-incident", version: 1 } as const;
export const resume = defineRpc({
  name: "relayline.resume",
  input: z.object({ agentId: z.string(), incidentId: z.string().optional() }),
  output: z.object({ stage: incidentSchema.shape.stage }),
});

export const followUp =
  "Continue the previous task from where it stopped. Use the conversation and existing work. Inspect uncertain side effects before repeating any action.";

const quotaSchema = z.object({
  status: z.enum(["available", "restricted", "unavailable"]),
  checkedAt: z.number(),
  windows: z.array(z.object({ id: z.string(), label: z.string(), usedPercent: z.number(), resetsAt: z.number().nullable() })),
});
export type Quota = z.infer<typeof quotaSchema>;

const health = z.enum(["unchecked", "ready", "rejected", "unreachable", "cooling"]);
export const poolView = z.object({
  accounts: z.array(z.object({ id: z.string(), label: z.string(), health, parked: z.boolean(), availableAt: z.number().nullable(), quota: quotaSchema.nullable() })),
  activeAccount: z.string().nullable(),
  liveReady: z.boolean(),
  blockedByZeroSub: z.boolean(),
  sessionUsage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }).nullable().default(null),
});
export const poolStatus = defineRpc({ name: "relayline.pool.status",
  input: z.object({ agentId: z.string().optional() }), output: poolView });
export const saveAccount = defineRpc({ name: "relayline.pool.save",
  input: z.object({ id: z.string().optional(), label: z.string().trim().min(1).max(64), token: z.string().trim().max(8192) }),
  output: poolView });
export const importAccounts = defineRpc({ name: "relayline.pool.import",
  input: z.object({}), output: z.object({ count: z.number() }) });
export const editAccount = defineRpc({ name: "relayline.pool.edit",
  input: z.object({ id: z.string(), action: z.enum(["park", "restore", "remove", "check"]) }), output: poolView });
export const useAccount = defineRpc({ name: "relayline.pool.use",
  input: z.object({ agentId: z.string(), accountId: z.string() }), output: poolView });

export const setupLive = defineRpc({ name: "relayline.pool.setup",
  input: z.object({}), output: z.object({ ready: z.boolean() }) });

export const maxBackupSize = 1_500_000;
export const minBackupPassword = 12;
const backupPassword = z.string().min(minBackupPassword).max(256);
export const exportBackup = defineRpc({
  name: "relayline.backup.export",
  input: z.object({ password: backupPassword }),
  output: z.object({ backup: z.string().max(maxBackupSize), count: z.number() }),
});
export const importBackup = defineRpc({
  name: "relayline.backup.import",
  input: z.object({ password: backupPassword, backup: z.string().trim().min(1).max(maxBackupSize) }),
  output: z.object({ added: z.number(), skipped: z.number() }),
});

export const setupTokenState = z.object({
  id: z.string(),
  phase: z.enum(["starting", "authorize", "exchanging", "saving", "saved", "failed"]),
  url: z.string().nullable(),
  detail: z.string().nullable(),
});
const setupId = z.object({ id: z.string().uuid() });
export const beginTokenSetup = defineRpc({
  name: "relayline.token.begin",
  input: z.object({ accountId: z.string().optional(), label: z.string().trim().min(1).max(64) }),
  output: setupTokenState,
});
export const tokenSetupStatus = defineRpc({ name: "relayline.token.status", input: setupId, output: setupTokenState });
export const setupCodeHelp = "Paste the complete code from Claude, including the # and the characters after it.";
export function isCompleteSetupCode(code: string): boolean {
  return /^(?!sk-ant-oat)[\x21-\x22\x24-\x7e]+#[\x21-\x22\x24-\x7e]+$/.test(code.trim());
}

export const submitSetupCode = defineRpc({
  name: "relayline.token.submit",
  input: setupId.extend({ code: z.string().trim().min(1).max(2048).regex(/^[\x21-\x7e]+$/) }),
  output: setupTokenState,
});
export const cancelTokenSetup = defineRpc({ name: "relayline.token.cancel", input: setupId, output: z.object({}) });
