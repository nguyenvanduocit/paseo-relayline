import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { resume, type Incident } from "../shared/contracts";

const title: Record<Incident["kind"], string> = {
  capacity: "Provider at capacity",
  connection: "Connection interrupted",
  upstream: "Provider temporarily unavailable",
  quota: "Provider limit reached",
  authentication: "Provider credentials refused",
  other: "Agent turn stopped",
};
const details: Record<Incident["stage"], string> = {
  ready: "Continue from this conversation.",
  scheduled: "Automatic continuation scheduled.",
  recorded: "Review the provider error above.",
  sent: "Continuation sent.",
  superseded: "This incident is no longer current.",
  unconfirmed: "Paseo could not confirm delivery. Check the conversation before retrying.",
};

export function IncidentRow({ item, agentId, theme }: PluginTimelineItemProps<Incident>) {
  const retry = useRpc(resume);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Incident["stage"]>();
  const [error, setError] = useState(false);
  const current = stage ?? item.data.stage;
  return (
    <View style={{ gap: 5, padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface0 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{title[item.data.kind]}</Text>
      <Text style={{ color: theme.colors.foregroundMuted }}>{item.data.switched ? "Claude account switched. " : ""}{details[current]}</Text>
      {error ? <Text style={{ color: theme.colors.foregroundMuted }}>This incident could not be continued. Check the latest turn.</Text> : null}
      {current === "ready" || current === "scheduled" ? (
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => {
          setBusy(true);
          setError(false);
          void retry({ agentId, incidentId: item.data.id }).then((result) => setStage(result.stage), () => setError(true)).finally(() => setBusy(false));
        }}>
          <Text style={{ color: theme.colors.accent }}>{busy ? "Continuing…" : "Continue task"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
