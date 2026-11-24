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

const health = z.enum(["unchecked", "ready", "rejected", "unreachable", "cooling"]);
export const poolView = z.object({
  accounts: z.array(z.object({ id: z.string(), label: z.string(), health, parked: z.boolean(), availableAt: z.number().nullable() })),
  activeAccount: z.string().nullable(),
  liveReady: z.boolean(),
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
