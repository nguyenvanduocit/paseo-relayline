import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRpc, useSettings, type PluginScreenProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { editAccount, importAccounts, poolStatus, preferences, saveAccount, setupLive, useAccount, type Preferences } from "../shared/contracts";

import { QuotaDetails } from "./quota";

const healthLabel = {
  unchecked: "Checking token", ready: "Ready", rejected: "Replace token",
  unreachable: "Check unavailable", cooling: "Cooling down",
};

export function AccountScreen({ theme, params }: PluginScreenProps) {
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
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    if (settings.status === "ready") void settings.save({ ...settings.values, [key]: value }, settings.revision);
  };
  async function perform(action: () => Promise<unknown>, success: string) {
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
  const muted = { color: theme.colors.foregroundMuted };
  const editor = draft ? (
    <SettingsCard key={draft.id ?? "new"}>
      <SettingsInput label="Account name" initialValue={draft.label} onChangeText={(label) => setDraft({ ...draft, label })} />
      <SettingsInput label="OAuth token" secureTextEntry hint={draft.id ? "Leave blank to keep the current token." : undefined}
        onChangeText={(token) => setDraft({ ...draft, token })} />
      <SettingsAction label={draft.id ? "Account changes" : "Add this account"} actionLabel="Save"
        disabled={busy || !draft.label.trim() || (!draft.id && !draft.token.trim())}
        onPress={() => void perform(async () => { await save(draft); setDraft(null); }, "Account saved.")} />
      <SettingsAction label="Discard changes" actionLabel="Cancel" disabled={busy} onPress={() => setDraft(null)} />
    </SettingsCard>
  ) : null;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: 16, gap: 16, width: "100%", maxWidth: 820, alignSelf: "center" }}>
      {message ? <Text accessibilityLiveRegion="polite" style={muted}>{message}</Text> : null}
      {pool.isError ? <Text style={muted}>Could not read accounts from this host.</Text> : null}
      <SettingsSection title="Claude accounts">
        <SettingsCard>
          <SettingsAction label="New Claude account" hint="Use a token from Claude Code’s setup-token command."
            actionLabel="Add" disabled={busy || !!draft} onPress={() => setDraft({ label: "", token: "" })} />
          <SettingsAction label="Existing ZeroSub accounts" hint="Import compatible OAuth tokens and their names."
            actionLabel="Import" disabled={busy} onPress={() => void perform(async () => {
              const { count } = await importExisting({});
              setMessage(count ? `Imported ${count} accounts. Checking their tokens…` : "No new compatible accounts found.");
            }, "")} />
        </SettingsCard>
        {draft && !draft.id ? editor : null}
        {pool.data?.accounts.length ? <SettingsCard>
          {pool.data.accounts.map((account) => (
            <View key={account.id}>
              <SettingsAction label={account.label} hint={[
                account.parked ? "Parked" : healthLabel[account.health],
                pool.data?.activeAccount === account.id ? "In use by this agent" : null,
                ...((account.quota?.windows ?? []).filter((window) => window.id === "five_hour" && !!window.resetsAt && window.resetsAt > Date.now())
                  .map((window) => `5h: ${Math.round(100 - window.usedPercent)}% left`)),
              ].filter(Boolean).join(" · ")} actionLabel={expanded === account.id ? "Done" : "Manage"} disabled={busy || !!draft}
                onPress={() => {
                  setExpanded(expanded === account.id ? null : account.id);
                  setRemove(null);
                }} />
              {agentId && pool.data?.activeAccount && pool.data.activeAccount !== account.id && !account.parked && account.health === "ready" ? (
                <SettingsAction label="This conversation" actionLabel="Switch account" disabled={busy}
                  onPress={() => void perform(() => activate({ agentId, accountId: account.id }), "Account switched.")} />
              ) : null}
              {expanded === account.id ? <>
                <SettingsAction label="Name or OAuth token" actionLabel="Edit" disabled={busy || !!draft}
                  onPress={() => setDraft({ id: account.id, label: account.label, token: "" })} />
                {draft?.id === account.id ? editor : null}
                <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}><QuotaDetails quota={account.quota} theme={theme} /></View>
                <SettingsAction label="Token health" actionLabel="Check" disabled={busy}
                  onPress={() => void perform(() => edit({ id: account.id, action: "check" }), "Check complete.")} />
                <SettingsAction label={account.parked ? "Allow automatic selection" : "Take out of rotation"}
                  actionLabel={account.parked ? "Restore" : "Park"} disabled={busy}
                  onPress={() => void perform(() => edit({ id: account.id, action: account.parked ? "restore" : "park" }), "")} />
                <SettingsAction label={remove === account.id ? "Remove from Relayline? Claude keeps its login." : "Remove account"}
                  actionLabel={remove === account.id ? "Confirm removal" : "Remove"} disabled={busy}
                  onPress={() => {
                    if (remove !== account.id) return setRemove(account.id);
                    void perform(async () => { await edit({ id: account.id, action: "remove" }); setRemove(null); }, "Account removed.");
                  }} />
              </> : null}
            </View>
          ))}
        </SettingsCard> : null}
      </SettingsSection>
      <SettingsSection title="Routing and recovery">
        <SettingsCard>
          {!pool.data?.liveReady ? <SettingsAction label="Live account switching"
            hint={pool.data?.blockedByZeroSub ? "ZeroSub is still routing Claude. Disable it in Paseo Settings → Plugins after importing the accounts." :
              "Set up the Claude launcher on this host. This changes Paseo’s Claude command."}
            actionLabel="Enable" disabled={busy || pool.isLoading || !!pool.data?.blockedByZeroSub} onPress={() => void perform(async () => {
              await setup({});
              if (settings.status === "ready" && settings.values.accountPolicy === "off") {
                const saved = await settings.save({ ...settings.values, accountPolicy: "sticky" }, settings.revision);
                if (!saved) throw new Error("Live switching is ready. Choose an account policy below.");
              }
            }, "Live switching is ready.")} /> : null}
          <SettingsAction label="Account and recovery options" actionLabel={optionsVisible ? "Hide" : "Customize"}
            onPress={() => setOptionsVisible(!optionsVisible)} />
          {optionsVisible && (settings.status === "ready" ? (
            <>
              <SettingsSelect label="Account policy" hint="Choose which verified account new Claude sessions start on."
                options={[{ label: "Off", value: "off" }, { label: "Last working account", value: "sticky" }, { label: "Spread new sessions", value: "spread" }]}
                value={settings.values.accountPolicy} disabled={settings.saving || !pool.data?.liveReady}
                onValueChange={(value) => change("accountPolicy", value as Preferences["accountPolicy"])} />
              <SettingsSelect label="After an interrupted turn"
                options={[{ label: "Offer to continue", value: "manual" }, { label: "Continue automatically when safe", value: "automatic" }, { label: "Record only", value: "observe" }]}
                value={settings.values.mode} disabled={settings.saving}
                onValueChange={(value) => change("mode", value as Preferences["mode"])} />
              {settings.values.mode === "automatic" ? (
                <SettingsSelect label="Wait before continuing" options={["15", "45", "120"].map((value) => ({ label: `${value} seconds`, value }))}
                  value={settings.values.delay} disabled={settings.saving}
                  onValueChange={(value) => change("delay", value as Preferences["delay"])} />
              ) : null}
              <SettingsSelect label="Recovery providers" options={[{ label: "All providers", value: "all" }, { label: "Claude only", value: "claude" }]}
                value={settings.values.scope} disabled={settings.saving}
                onValueChange={(value) => change("scope", value as Preferences["scope"])} />
            </>
          ) : <View style={{ padding: 12 }}><Text style={muted}>{settings.status === "loading" ? "Loading preferences…" : "Preferences are unavailable."}</Text></View>)}
        </SettingsCard>
        {settings.saveError ? <Text style={muted}>Could not save preferences. Reopen this screen and try again.</Text> : null}
      </SettingsSection>
    </ScrollView>
  );
}
