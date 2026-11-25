import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { openExternalUrl, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsInput } from "@getpaseo/plugin/client/ui";
import { beginTokenSetup, cancelTokenSetup, isCompleteSetupCode, setupCodeHelp, submitSetupCode, tokenSetupStatus } from "../shared/contracts";
import { Action } from "./design";

export function TokenSetupControl({ theme, accountId, label, disabled, onSaved }: {
  theme: PluginSurfaceProps["theme"];
  accountId?: string;
  label: string;
  disabled: boolean;
  onSaved(): void;
}) {
  const start = useRpc(beginTokenSetup);
  const check = useRpc(tokenSetupStatus);
  const submit = useRpc(submitSetupCode);
  const cancel = useRpc(cancelTokenSetup);
  const [id, setId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const delivered = useRef<string | null>(null);
  const mounted = useRef(false);
  const active = useRef<{ id: string; cancel: typeof cancel } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const job = active.current;
      active.current = null;
      if (job) void job.cancel({ id: job.id }).catch(() => {});
    };
  }, []);
  const task = useQuery({
    queryKey: ["relayline-token-setup", id],
    queryFn: () => {
      if (!id) throw new Error("No token setup is active.");
      return check({ id });
    },
    enabled: id !== null,
    refetchInterval: (query) => query.state.data?.phase === "saved" || query.state.data?.phase === "failed" || query.state.error ? false : 600,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const phase = task.data?.phase;
  const url = task.data?.url;
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13 };
  useEffect(() => {
    if (phase === "saved" && id && delivered.current !== id) {
      delivered.current = id;
      onSaved();
    }
  }, [phase, id, onSaved]);

  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not complete token setup.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      {!id || phase === "failed" || task.isError ? (
        <Action theme={theme} label={id ? "Start again" : "Create token with Claude Code"} icon="KeyRound" disabled={busy || disabled || !label.trim()}
          onPress={() => void perform(async () => {
            setCode("");
            const result = await start({ accountId, label });
            if (!mounted.current) {
              await cancel({ id: result.id });
              return;
            }
            active.current = { id: result.id, cancel };
            setId(result.id);
          })} />
      ) : null}
      {id && (!phase || phase === "starting") && !task.isError ? <Text style={muted}>Waiting for Claude Code’s sign-in link…</Text> : null}
      {id && phase === "authorize" && url ? (
        <View style={{ gap: 8 }}>
          <Action theme={theme} label="Open Claude sign-in" icon="ExternalLink" primary disabled={busy}
            onPress={() => void perform(() => openExternalUrl(url))} />
          <Text style={muted}>Approve the request in Claude, then paste the complete code, including the # in the middle.</Text>
          <SettingsCard>
            <SettingsInput label="Authorization code" secureTextEntry hint={code.trim() && !isCompleteSetupCode(code) ? setupCodeHelp : undefined}
              onChangeText={setCode} />
          </SettingsCard>
          <Action theme={theme} label="Complete sign-in" disabled={busy || !isCompleteSetupCode(code)}
            onPress={() => void perform(async () => { await submit({ id, code }); setCode(""); await task.refetch(); })} />
        </View>
      ) : null}
      {phase === "exchanging" || phase === "saving" ? (
        <Text accessibilityLiveRegion="polite" style={muted}>
          {phase === "exchanging" ? "Authorizing with Claude…" : "Saving the new token…"}
        </Text>
      ) : null}
      {id && phase !== "saving" && phase !== "saved" && phase !== "failed" && !task.isError ? (
        <Action theme={theme} label="Cancel token setup" disabled={busy}
          onPress={() => void perform(async () => { await cancel({ id }); active.current = null; setId(null); setCode(""); })} />
      ) : null}
      {error || task.data?.detail || task.isError ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.statusDanger, fontSize: 13 }}>
          {error || task.data?.detail || "Token setup ended. Start again to get a fresh link."}
        </Text>
      ) : null}
    </View>
  );
}
