import { Text, View } from "react-native";
import type { useSettings, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import type { preferences, Preferences } from "../shared/contracts";

const routing = [
  { label: "Off", value: "off" },
  { label: "Reuse last working account", value: "sticky" },
  { label: "Spread new sessions", value: "spread" },
] as const;
const recovery = [
  { label: "Offer to continue", value: "manual" },
  { label: "Continue when safe", value: "automatic" },
  { label: "Record only", value: "observe" },
] as const;

export function PreferencesPanel({ theme, settings, liveReady }: {
  theme: PluginSurfaceProps["theme"];
  settings: ReturnType<typeof useSettings<typeof preferences.schema>>;
  liveReady: boolean;
}) {
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13 };
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    if (settings.status === "ready") void settings.save({ ...settings.values, [key]: value }, settings.revision);
  };
  if (settings.status === "loading") return <Text style={muted}>Loading preferences…</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsCard>
        <SettingsAction label="Preferences unavailable" actionLabel="Retry" onPress={() => void settings.reload()} />
      </SettingsCard>
    );
  }
  const { values, saving, saveError } = settings;
  return (
    <View style={{ gap: 14 }}>
      <SettingsSection title="Account routing">
        <SettingsCard>
          <SettingsSelect label="New Claude sessions" hint={liveReady ? "Choose how Relayline assigns a ready account." : "Enable live switching on this host first."}
            options={[...routing]} value={values.accountPolicy} disabled={saving || !liveReady}
            onValueChange={(value) => change("accountPolicy", value as Preferences["accountPolicy"])} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Interrupted turns">
        <SettingsCard>
          <SettingsSelect label="Recovery" options={[...recovery]} value={values.mode} disabled={saving}
            onValueChange={(value) => change("mode", value as Preferences["mode"])} />
          {values.mode === "automatic" ? (
            <SettingsSelect label="Wait before continuing" hint="Applies to turns that stopped before Claude produced a reply or ran a tool."
              options={["15", "45", "120"].map((value) => ({ label: `${value} seconds`, value }))} value={values.delay} disabled={saving}
              onValueChange={(value) => change("delay", value as Preferences["delay"])} />
          ) : null}
          <SettingsSelect label="Providers" options={[{ label: "All providers", value: "all" }, { label: "Claude only", value: "claude" }]}
            value={values.scope} disabled={saving} onValueChange={(value) => change("scope", value as Preferences["scope"])} />
        </SettingsCard>
      </SettingsSection>
      {saveError ? <Text accessibilityLiveRegion="polite" style={muted}>Could not save preferences. Reload and try again.</Text> : null}
    </View>
  );
}
