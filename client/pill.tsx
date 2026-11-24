import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRpc, type PluginButtonContentProps, type PluginButtonRegistration, type PluginClientContext } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { poolStatus, useAccount } from "../shared/contracts";
import { QuotaDetails } from "./quota";

type AccountPopoverProps = PluginButtonContentProps & { agentId: string; openAccounts(): void };

function AccountPopover({ agentId, theme, layout, close, openAccounts }: AccountPopoverProps) {
  const status = useRpc(poolStatus);
  const change = useRpc(useAccount);
  const toast = useToast();
  const pool = useQuery({ queryKey: ["relayline-pool", agentId], queryFn: () => status({ agentId }) });
  const [pending, setPending] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [error, setError] = useState("");
  const colors = theme.colors;
  const current = pool.data?.accounts.find((account) => account.id === pool.data?.activeAccount);
  const usage = pool.data?.sessionUsage;
  const hasUsage = usage?.inputTokens !== undefined || usage?.outputTokens !== undefined;
  const quotaWindow = current?.quota?.windows.find((window) => window.resetsAt !== null && window.resetsAt > Date.now());
  const muted = { color: colors.foregroundMuted, fontSize: 12 };
  const foreground = { color: colors.foreground, fontSize: 13 };
  const row = { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 };

  async function select(accountId: string, label: string) {
    setPending(accountId);
    setError("");
    try {
      await change({ agentId, accountId });
      void pool.refetch();
      close();
      toast.show(`Switched to ${label}`, { variant: "success" });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The account switch could not be confirmed.");
    } finally {
      setPending(null);
    }
  }

  const alternatives = pool.data?.accounts.filter((account) => account.id !== current?.id && !account.parked && account.health === "ready") ?? [];
  const searchTerm = search.trim().toLocaleLowerCase();
  const matches = alternatives.filter((account) => account.label.toLocaleLowerCase().includes(searchTerm));
  const usageLabel = quotaWindow ? `${Math.round(100 - quotaWindow.usedPercent)}% · ${quotaWindow.label}`
    : current?.quota?.status === "restricted" ? "Quota hidden" : "Usage";

  return (
    <View style={{ width: layout.compact ? "100%" : 292, maxWidth: "100%", gap: 10 }}>
      <View style={{ gap: 5 }}>
        <Text style={muted}>Current account</Text>
        <View style={row}>
          {current ? <Icon name="CircleCheck" size={15} color={colors.statusSuccess} /> : null}
          <Text numberOfLines={1} style={{ ...foreground, flex: 1, minWidth: 0, fontSize: 14, fontWeight: "600" }}>
            {current?.label ?? (pool.isLoading ? "Loading…" : "Unassigned")}
          </Text>
          {current ? (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showUsage }} onPress={() => setShowUsage(!showUsage)}
              style={{ ...row, gap: 4, paddingVertical: 4, paddingHorizontal: 5 }}>
              <Text style={muted}>{usageLabel}</Text>
              <Icon name={showUsage ? "ChevronUp" : "ChevronDown"} size={12} color={colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
        {showUsage && current ? (
          <View style={{ paddingVertical: 4, gap: 7 }}>
            <QuotaDetails quota={current.quota} theme={theme} />
            {hasUsage ? <Text style={muted}>Session tokens · {usage?.inputTokens?.toLocaleString() ?? "—"} in · {usage?.outputTokens?.toLocaleString() ?? "—"} out</Text> : null}
          </View>
        ) : null}
      </View>

      {pool.isError ? <Text style={muted}>Could not load accounts.</Text> : null}
      {pool.data && !current ? <Text style={muted}>New sessions can join the account pool when routing is enabled.</Text> : null}

      {current && alternatives.length > 0 ? (
        <View style={{ gap: 6, borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 }}>
          {alternatives.length > 5 ? (
            <View style={{ ...row, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 7 }}>
              <Icon name="Search" size={13} color={colors.foregroundMuted} />
              <TextInput accessibilityLabel="Find account" placeholder="Find account" autoCapitalize="none" autoCorrect={false}
                placeholderTextColor={colors.foregroundMuted} value={search} onChangeText={setSearch}
                style={{ ...foreground, flex: 1, minHeight: 28, padding: 0 }} />
            </View>
          ) : <Text style={muted}>Switch account</Text>}
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: layout.compact ? 176 : 160 }}
            accessibilityLabel="Available Claude accounts">
            {matches.map((account) => (
              <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`Switch to ${account.label}`} disabled={pending !== null}
                style={({ pressed }) => ({
                  ...row, minHeight: 32, paddingHorizontal: 6, borderRadius: 5,
                  backgroundColor: pressed || hover === account.id ? colors.surface2 : "transparent",
                })}
                onHoverIn={() => setHover(account.id)} onHoverOut={() => setHover(null)}
                onPress={() => void select(account.id, account.label)}>
                <Text numberOfLines={1} style={{ ...foreground, flex: 1, minWidth: 0 }}>{account.label}</Text>
                {pending === account.id ? <ActivityIndicator size="small" color={colors.accent} /> :
                  <Icon name="ArrowUpRight" size={13} color={colors.foregroundMuted} />}
              </Pressable>
            ))}
            {matches.length === 0 ? <Text style={{ ...muted, padding: 5 }}>No matching accounts.</Text> : null}
          </ScrollView>
        </View>
      ) : current ? <Text style={muted}>No other verified account is ready.</Text> : null}

      {error ? <Text accessibilityLiveRegion="polite" style={{ ...muted, color: colors.statusDanger }}>{error}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => { close(); openAccounts(); }}
        style={{ ...row, borderTopWidth: 1, borderColor: colors.border, paddingTop: 8, minHeight: 28 }}>
        <Icon name="Settings2" size={14} color={colors.foregroundMuted} />
        <Text style={muted}>Manage accounts</Text>
      </Pressable>
    </View>
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
