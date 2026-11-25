import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRpc, useSettings, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, SettingsCard, SettingsInput } from "@getpaseo/plugin/client/ui";
import { editAccount, importAccounts, poolStatus, preferences, saveAccount, setupLive, useAccount } from "../shared/contracts";
import { BackupPanel } from "./backup-panel";
import { TokenSetupControl } from "./token-setup";
import { Action, Status, accountStatus } from "./design";
import { PreferencesPanel } from "./preferences-panel";
import { QuotaDetails } from "./quota";

export function AccountScreen({ theme, params, layout }: PluginScreenProps) {
  const agentId = typeof params?.agentId === "string" ? params.agentId : undefined;
  const status = useRpc(poolStatus);
  const save = useRpc(saveAccount);
  const edit = useRpc(editAccount);
  const importExisting = useRpc(importAccounts);
  const setup = useRpc(setupLive);
  const activate = useRpc(useAccount);
  const settings = useSettings(preferences);
  const pool = useQuery({ queryKey: ["relayline-pool", agentId ?? null], queryFn: () => status({ agentId }), refetchInterval: 10_000 });
  const [draft, setDraft] = useState<{ id?: string; label: string; token: string } | null>(null);
  const [remove, setRemove] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  const [message, setMessage] = useState("");
  const colors = theme.colors;
  const accounts = pool.data?.accounts ?? [];
  const ready = accounts.filter((account) => account.health === "ready" && !account.parked).length;
  const attention = accounts.filter((account) => account.health === "rejected" && !account.parked).length;

  async function perform(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      if (success) setMessage(success);
      await pool.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The operation could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const muted = { color: colors.foregroundMuted, fontSize: 13 };
  const toolbar = { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: 8 };
  const editor = draft ? (
    <View key={draft.id ?? "new"} style={{ gap: 10 }}>
      <SettingsCard>
        <SettingsInput label="Account name" initialValue={draft.label} onChangeText={(label) => setDraft({ ...draft, label })} />
        <SettingsInput label="Existing OAuth token" secureTextEntry hint={draft.id ? "Leave blank to keep the current token." : "Paste a token if you already have one."}
          onChangeText={(token) => setDraft({ ...draft, token })} />
      </SettingsCard>
      <TokenSetupControl theme={theme} accountId={draft.id} label={draft.label} disabled={busy}
        onSaved={() => { setDraft(null); setMessage("Account saved."); void pool.refetch(); }} />
      <View style={toolbar}>
        <Action theme={theme} label="Save" primary disabled={busy || !draft.label.trim() || (!draft.id && !draft.token.trim())}
          onPress={() => void perform(async () => { await save(draft); setDraft(null); }, "Account saved.")} />
        <Action theme={theme} label="Cancel" disabled={busy} onPress={() => setDraft(null)} />
      </View>
    </View>
  ) : null;

  function enable() {
    void perform(async () => {
      await setup({});
      if (settings.status === "ready" && settings.values.accountPolicy === "off") {
        const saved = await settings.save({ ...settings.values, accountPolicy: "sticky" }, settings.revision);
        if (!saved) throw new Error("Live switching is ready. Choose a routing policy in Settings.");
      }
    }, "Live switching is ready.");
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }}
      contentContainerStyle={{ paddingHorizontal: layout.compact ? 16 : 28, paddingVertical: layout.compact ? 18 : 26, gap: 18, width: "100%", maxWidth: 780, alignSelf: "center" }}>
      <View style={{ flexDirection: layout.compact ? "column" : "row", alignItems: layout.compact ? "flex-start" : "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ gap: 5 }}>
          <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 22, fontWeight: "600" }}>Claude accounts</Text>
          {accounts.length > 0 ? <Text style={muted}>{ready} ready{attention ? ` · ${attention} need attention` : ""}</Text> : null}
        </View>
        <View style={toolbar}>
          <Action theme={theme} label="Add account" icon="Plus" primary disabled={busy || !!draft} onPress={() => setDraft({ label: "", token: "" })} />
          <Action theme={theme} label="Settings" icon={showSettings ? "ChevronUp" : "SlidersHorizontal"} expanded={showSettings}
            onPress={() => setShowSettings(!showSettings)} />
        </View>
      </View>

      {message ? <Text accessibilityLiveRegion="polite" style={muted}>{message}</Text> : null}
      {pool.isError ? <Text style={muted}>Could not read accounts from this host.</Text> : null}
      {pool.data && !pool.data.liveReady ? (
        <View style={{ ...toolbar, justifyContent: "space-between", padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10 }}>
          <View style={{ flex: 1, minWidth: 160, gap: 4 }}>
            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>Live switching</Text>
            <Text style={muted}>{pool.data.blockedByZeroSub
              ? "Disable ZeroSub in Paseo’s plugin settings after importing its accounts."
              : "Enable the launcher for new Claude sessions on this host."}</Text>
          </View>
          <Action theme={theme} label="Enable" disabled={busy || pool.data.blockedByZeroSub} onPress={enable} />
        </View>
      ) : null}
      {showSettings ? (
        <View style={{ padding: 14, borderRadius: 11, borderColor: colors.border, borderWidth: 1, gap: 14 }}>
          <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>Settings</Text>
          <PreferencesPanel theme={theme} settings={settings} liveReady={pool.data?.liveReady ?? false} />
        </View>
      ) : null}
      {draft && !draft.id ? editor : null}

      {accounts.length > 0 ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 11, overflow: "hidden", backgroundColor: colors.surface1 }}>
          {accounts.map((account, index) => {
            const open = expanded === account.id;
            const current = pool.data?.activeAccount === account.id;
            const accountState = accountStatus(account, theme);
            const fiveHours = account.quota?.windows.find((window) => window.id === "five_hour" && (window.resetsAt ?? 0) > Date.now());
            return (
              <View key={account.id} style={{ borderTopColor: colors.border, borderTopWidth: index ? 1 : 0 }}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} disabled={busy || !!draft}
                  onPress={() => { setExpanded(open ? null : account.id); setRemove(null); }}
                  style={({ pressed }) => ({
                    minHeight: layout.compact ? 53 : 49, flexDirection: "row", alignItems: "center", gap: 10,
                    paddingHorizontal: 14, paddingVertical: 7, backgroundColor: pressed || open ? colors.surface2 : colors.surface1,
                  })}>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{account.label}</Text>
                    {layout.compact ? <Status {...accountState} label={current ? "Current session" : accountState.label} /> : null}
                  </View>
                  {!layout.compact ? <Status {...accountState} label={current ? "Current session" : accountState.label} /> : null}
                  {fiveHours ? <Text style={muted}>{Math.round(100 - fiveHours.usedPercent)}% · 5h</Text> : null}
                  <Icon name={open ? "ChevronUp" : "ChevronDown"} size={15} color={colors.foregroundMuted} />
                </Pressable>
                {open ? (
                  <View style={{ padding: 14, gap: 12, backgroundColor: colors.surface0 }}>
                    {draft?.id === account.id ? editor : null}
                    <QuotaDetails quota={account.quota} theme={theme} />
                    <View style={toolbar}>
                      {agentId && pool.data?.activeAccount && !current && !account.parked && account.health === "ready" ? (
                        <Action theme={theme} label="Switch to this account" primary disabled={busy}
                          onPress={() => void perform(() => activate({ agentId, accountId: account.id }), "Account switched.")} />
                      ) : null}
                      <Action theme={theme} label="Edit" disabled={busy || !!draft} onPress={() => setDraft({ id: account.id, label: account.label, token: "" })} />
                      <Action theme={theme} label="Check" disabled={busy} onPress={() => void perform(() => edit({ id: account.id, action: "check" }), "Check complete.")} />
                      <Action theme={theme} label={account.parked ? "Restore" : "Pause"} disabled={busy}
                        onPress={() => void perform(() => edit({ id: account.id, action: account.parked ? "restore" : "park" }))} />
                      <Action theme={theme} label={remove === account.id ? "Confirm removal" : "Remove"} danger disabled={busy}
                        onPress={() => {
                          if (remove !== account.id) return setRemove(account.id);
                          void perform(async () => { await edit({ id: account.id, action: "remove" }); setRemove(null); }, "Account removed.");
                        }} />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : pool.data ? <Text style={muted}>Add a Claude account or import your existing accounts from ZeroSub.</Text> : null}

      <View style={toolbar}>
        <Action theme={theme} label="Backup & restore" icon="Archive" expanded={showBackups} disabled={busy} onPress={() => setShowBackups(!showBackups)} />
        <Action theme={theme} label="Import from ZeroSub" icon="Download" disabled={busy} onPress={() => void perform(async () => {
          const { count } = await importExisting({});
          setMessage(count ? `Imported ${count} accounts. Checking their tokens…` : "No new compatible accounts found.");
        })} />
      </View>
      {showBackups ? <BackupPanel theme={theme} hasAccounts={accounts.length > 0} onImported={() => void pool.refetch()} /> : null}
    </ScrollView>
  );
}
