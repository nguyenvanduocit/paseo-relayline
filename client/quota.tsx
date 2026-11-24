import { Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { Quota } from "../shared/contracts";

type Theme = PluginSurfaceProps["theme"];

export function QuotaDetails({ quota, theme }: { quota: Quota | null; theme: Theme }) {
  const small = { fontSize: 12, color: theme.colors.foregroundMuted };
  if (!quota || quota.status !== "available") {
    const label = quota?.status === "restricted" ? "This OAuth token can’t read plan quota."
      : quota?.status === "unavailable" ? "Anthropic didn’t return a quota reading." : "Plan quota hasn’t been checked.";
    return <Text style={small}>{label}</Text>;
  }
  return (
    <View style={{ gap: 8 }}>
      {quota.windows.map((window) => {
        const reset = window.resetsAt !== null && window.resetsAt <= Date.now();
        const remaining = Math.round((100 - window.usedPercent) * 10) / 10;
        const label = reset ? "Waiting for a fresh reading" : `${remaining}% remaining`;
        return (
          <View key={window.id} style={{ gap: 4 }}>
            <Text style={small}>{window.label} · {label}</Text>
            {!reset ? (
              <View accessible accessibilityRole="progressbar" accessibilityLabel={`${window.label} remaining`}
                accessibilityValue={{ min: 0, max: 100, now: remaining }}
                style={{ height: 4, overflow: "hidden", borderRadius: 2, backgroundColor: theme.colors.surface0 }}>
                <View style={{ width: `${remaining}%`, height: 4, backgroundColor: theme.colors.accent }} />
              </View>
            ) : null}
            {window.resetsAt && !reset ? <Text style={small}>Resets {new Date(window.resetsAt).toLocaleString()}</Text> : null}
          </View>
        );
      })}
      <Text style={small}>Checked {new Date(quota.checkedAt).toLocaleTimeString()}</Text>
    </View>
  );
}
