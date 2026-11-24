import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRpc, type PluginButtonContentProps, type PluginButtonRegistration, type PluginClientContext } from "@getpaseo/plugin/client";
import { poolStatus, useAccount } from "../shared/contracts";
import { QuotaDetails } from "./quota";

type AccountPopoverProps = PluginButtonContentProps & { agentId: string; openAccounts(): void };

function AccountPopover({ agentId, theme, close, openAccounts }: AccountPopoverProps) {
  const status = useRpc(poolStatus);
  const change = useRpc(useAccount);
  const pool = useQuery({ queryKey: ["relayline-pool", agentId], queryFn: () => status({ agentId }) });
  const usage = pool.data?.sessionUsage;
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const current = pool.data?.accounts.find((account) => account.id === pool.data?.activeAccount);
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };
  const foreground = { color: theme.colors.foreground, fontSize: 14 };
  async function select(accountId: string) {
    setPending(accountId);
    setError("");
    try {
      await change({ agentId, accountId });
      await pool.refetch();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The account switch could not be confirmed.");
    } finally {
      setPending(null);
    }
  }
  const alternatives = pool.data?.accounts.filter((account) => account.id !== current?.id && !account.parked && account.health === "ready") ?? [];
  return (
    <ScrollView style={{ maxHeight: 410 }} contentContainerStyle={{ padding: 12, gap: 10 }}>
      <Text style={{ ...foreground, fontWeight: "600" }}>{current?.label ?? "Claude account"}</Text>
      {pool.isLoading ? <Text style={muted}>Checking this session…</Text> : null}
      {pool.isError ? <Text style={muted}>Could not load accounts.</Text> : null}
      {current ? <QuotaDetails quota={current.quota} theme={theme} /> : pool.data ? (
        <Text style={muted}>This Claude session hasn’t joined Relayline. New sessions join when routing is enabled.</Text>
      ) : null}
      {usage && (usage.inputTokens !== undefined || usage.outputTokens !== undefined) ? (
        <Text style={muted}>Session usage reported by Paseo · {usage.inputTokens?.toLocaleString() ?? "—"} input · {usage.outputTokens?.toLocaleString() ?? "—"} output tokens</Text>
      ) : null}
      {current ? <View style={{ gap: 4 }}>
        {alternatives.length ? <Text style={muted}>Switch account</Text> : <Text style={muted}>No other verified account is ready.</Text>}
        {alternatives.map((account) => (
          <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`Switch to ${account.label}`} disabled={pending !== null}
            style={{ borderRadius: 7, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: theme.colors.surface0 }}
            onPress={() => void select(account.id)}>
            <Text style={foreground}>{pending === account.id ? "Switching…" : account.label}</Text>
          </Pressable>
        ))}
      </View> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={muted}>{error}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => { close(); openAccounts(); }}>
        <Text style={{ color: theme.colors.accent }}>Manage Claude accounts</Text>
      </Pressable>
    </ScrollView>
  );
}

export function contributePills(client: PluginClientContext) {
  const lifetime = new AbortController();
  const pills = new Map<string, { workspaceId: string; button: PluginButtonRegistration }>();
  let generation = 0;

  function remove(id: string) {
    pills.get(id)?.button.remove();
    pills.delete(id);
  }
  function track(agent: { id: string; workspaceId?: string | null; provider: string; archivedAt?: string | null }) {
    const { id, workspaceId } = agent;
    if (agent.provider !== "claude" || !workspaceId || agent.archivedAt) return remove(id);
    if (pills.get(id)?.workspaceId === workspaceId) return;
    remove(id);
    const openAccounts = () => client.openScreen({ screenId: "accounts", params: { agentId: id } });
    const button = client.addComposerPill({
      id: "claude-account", workspaceId, agentId: id,
      button: {
        title: "Switch Claude account or view quota", label: "Claude account", icon: "Repeat2",
        behavior: { kind: "popover", Content: (props) => <AccountPopover {...props} agentId={id} openAccounts={openAccounts} /> },
      },
    });
    pills.set(id, { workspaceId, button });
  }
  const sort = [{ key: "updated_at" as const, direction: "desc" as const }];
  async function loadOlder(cursor: string | null | undefined, seen: number) {
    while (cursor) {
      const page = await client.paseo.agents.list({ signal: lifetime.signal, sort, page: { cursor, limit: 200 } });
      if (lifetime.signal.aborted || seen !== generation) return;
      for (const { agent } of page.entries) track(agent);
      cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
    }
  }
  void client.paseo.agents.list({ signal: lifetime.signal, subscribe: {}, sort, page: { limit: 200 } }).then(({ subscription }) => {
    if (lifetime.signal.aborted) return;
    subscription.subscribe({
      snapshot({ entries, pageInfo }) {
        if (lifetime.signal.aborted) return;
        const seen = ++generation;
        for (const id of pills.keys()) remove(id);
        for (const { agent } of entries) track(agent);
        if (pageInfo.hasMore) void loadOlder(pageInfo.nextCursor, seen).catch(() => {});
      },
      update(message) {
        if (lifetime.signal.aborted || message.type !== "agent_update") return;
        const update = message.payload;
        if (update.kind === "remove") remove(update.agentId);
        else track(update.agent);
      },
    });
  }).catch(() => {});
  return () => {
    lifetime.abort();
    for (const id of pills.keys()) remove(id);
  };
}
