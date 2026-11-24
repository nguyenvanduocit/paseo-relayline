import { createHash } from "node:crypto";
import type { PluginHookContext, PluginHookEvents } from "@getpaseo/plugin/server";
import { followUp, incidentRow, preferences, type Incident, type Preferences } from "../shared/contracts";
import type { Pool } from "./pool";
import { canContinueAutomatically, classify, claudeRefusal, isRecoveryTurn, isTransient } from "./policy";

type Paseo = PluginHookContext["paseo"];
type Ended = PluginHookEvents["agent.turn.after"];

interface IncidentRecord {
  incident: Incident;
  turnId: string;
  provider: string;
  timer?: ReturnType<typeof setTimeout>;
}

export class Recovery {
  private readonly records = new Map<string, IncidentRecord>();
  private readonly observing = new Map<string, object>();
  private settings = preferences.schema.parse({});
  private stopped = false;

  constructor(private readonly pool: Pool) {}

  configure(values: Preferences) {
    this.settings = values;
  }

  close() {
    this.stopped = true;
    for (const agentId of this.records.keys()) this.forget(agentId);
    this.observing.clear();
  }

  forget(agentId: string) {
    this.observing.delete(agentId);
    const record = this.records.get(agentId);
    if (record?.timer) clearTimeout(record.timer);
    this.records.delete(agentId);
  }

  async observe(paseo: Paseo, event: Ended) {
    if (this.stopped || event.agent.background || event.agent.parentAgentId || event.outcome.kind === "canceled" || !event.turnId) return;
    if (this.settings.scope === "claude" && event.agent.provider !== "claude") return;
    const { id: agentId, provider } = event.agent;
    const { turnId } = event;
    const id = createHash("sha256").update(JSON.stringify([agentId, turnId])).digest("hex").slice(0, 24);
    if (this.records.get(agentId)?.incident.id === id) return;
    const observation = {};
    this.observing.set(agentId, observation);
    try {
      const agent = paseo.agents.ref(agentId);
      const page = await agent.timeline.refetch({ direction: "tail", limit: 1, wholeTurns: true });
      if (this.observing.get(agentId) !== observation) return;
      const items = page.entries.filter((entry) => entry.turnId === turnId).map((entry) => entry.item);
      if (!items.some((item) => item.type === "user_message")) return;
      const lastReply = items.findLast((item) => item.type === "assistant_message");
      const refusal = event.agent.provider === "claude" && lastReply?.type === "assistant_message" &&
        claudeRefusal.test(lastReply.text.trim()) ? lastReply : undefined;
      const kind = event.outcome.kind === "failed" ? classify(event.outcome.error)
        : refusal?.type === "assistant_message" ? (/limit/i.test(refusal.text) ? "quota" : "authentication") : null;
      if (!kind) return;
      const switched = (kind === "quota" || kind === "authentication") &&
        await this.pool.failover(agentId, kind, this.settings).catch(() => false);
      if (this.observing.get(agentId) !== observation) return;
      this.forget(agentId);
      if (this.records.size >= 256) {
        const oldest = this.records.keys().next().value;
        if (oldest !== undefined) this.forget(oldest);
      }
      const record: IncidentRecord = {
        turnId, provider,
        incident: { id, kind, switched, stage: (isTransient(kind) || switched) && !isRecoveryTurn(items) &&
          this.settings.mode !== "observe" ? "ready" : "recorded" },
      };
      this.records.set(agentId, record);

      if (record.incident.stage === "ready" && this.settings.mode === "automatic" && canContinueAutomatically(items, switched)) {
        record.incident.stage = "scheduled";
        record.timer = setTimeout(() => {
          record.timer = undefined;
          void this.resume(paseo, agentId, id, true).catch(() => {
            console.warn("[Relayline] Could not verify the agent before recovery.");
          });
        }, Number(this.settings.delay) * 1_000);
        record.timer.unref();
      }
      await this.append(paseo, agentId, record);
    } finally {
      if (this.observing.get(agentId) === observation) this.observing.delete(agentId);
    }
  }

  async resume(paseo: Paseo, agentId: string, incidentId?: string, automatic = false): Promise<Incident["stage"]> {
    const record = this.records.get(agentId);
    if (!record || (incidentId && record.incident.id !== incidentId)) throw new Error("There is no current Relayline incident for this agent.");
    if (record.incident.stage !== "ready" && record.incident.stage !== "scheduled") return record.incident.stage;
    const canDispatch = () => this.records.get(agentId) === record && this.settings.mode !== "observe" &&
      (!automatic || this.settings.mode === "automatic") && (this.settings.scope === "all" || record.provider === "claude");
    if (!canDispatch() && !automatic) throw new Error("Recovery is disabled by the current Relayline settings.");
    if (record.timer) clearTimeout(record.timer);
    record.timer = undefined;
    // Claim before the first await, so a click and the timer cannot send twice.
    const { turnId, incident } = record;
    incident.stage = "superseded";
    if (canDispatch()) {
      const agent = paseo.agents.ref(agentId);
      const snapshot = (await agent.refresh())?.agent;
      if (snapshot && !snapshot.archivedAt && !snapshot.activeTurn && (snapshot.status === "error" || (incident.switched && snapshot.status === "idle")) && !snapshot.pendingPermissions?.length) {
        const page = await agent.timeline.refetch({ direction: "tail", limit: 1, wholeTurns: true });
        const items = page.entries.filter((entry) => entry.turnId === turnId).map((entry) => entry.item);
        if (canDispatch() && items.some((item) => item.type === "user_message") && (!automatic || canContinueAutomatically(items, incident.switched))) {
          try {
            await agent.send(followUp, { messageId: `relayline-${incident.id}`, activeTurnBehavior: "steer" });
            incident.stage = "sent";
          } catch {
            // The daemon may have received the prompt. Keep this incident consumed.
            incident.stage = "unconfirmed";
          }
        }
      }
    }
    await this.append(paseo, agentId, record);
    return incident.stage;
  }

  private async append(paseo: Paseo, agentId: string, record: IncidentRecord) {
    await paseo.agents.ref(agentId).timeline.append({
      type: "plugin",
      ...incidentRow,
      id: record.incident.id,
      data: { ...record.incident },
    });
  }
}
