import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { copyText, SettingsCard, SettingsInput } from "@getpaseo/plugin/client/ui";
import { exportBackup, importBackup, maxBackupSize, minBackupPassword } from "../shared/contracts";
import { Action } from "./design";
import { canUseBackupFiles, downloadBackup, pickBackup } from "./web";

type Theme = PluginSurfaceProps["theme"];

function validPassword(password: string) {
  return password.length >= minBackupPassword && password.length <= 256;
}

function useOperation() {
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setProblem("");
    try {
      await action();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The backup operation failed.");
    } finally {
      setBusy(false);
    }
  }
  return { message, setMessage, problem, busy, perform };
}

function Feedback({ theme, message, problem }: { theme: Theme; message: string; problem: string }) {
  const colors = theme.colors;
  return (
    <>
      {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 13 }}>{message}</Text> : null}
      {problem ? <Text accessibilityLiveRegion="polite" style={{ color: colors.statusDanger, fontSize: 13 }}>{problem}</Text> : null}
    </>
  );
}

function Section({ theme, title, description, children }: {
  theme: Theme; title: string; description: string; children: React.ReactNode;
}) {
  const colors = theme.colors;
  return (
    <View style={{ padding: 14, gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 11 }}>
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>{title}</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{description}</Text>
      {children}
    </View>
  );
}

function CreateBackup({ theme }: { theme: Theme }) {
  const create = useRpc(exportBackup);
  const { message, setMessage, problem, busy, perform } = useOperation();
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState("");
  const [result, setResult] = useState("");
  const [formVersion, setFormVersion] = useState(0);
  const row = { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 };

  return (
    <Section theme={theme} title="Create backup"
      description={`Saves account names, tokens and pause status in an encrypted file. Use a password of at least ${minBackupPassword} characters — you need it to restore.`}>
      <SettingsCard key={formVersion}>
        <SettingsInput label="Backup password" secureTextEntry onChangeText={setPassword} disabled={busy} />
        <SettingsInput label="Confirm password" secureTextEntry onChangeText={setConfirmed} disabled={busy} />
      </SettingsCard>
      <Action theme={theme} label={busy ? "Encrypting…" : "Create encrypted backup"} icon="Archive"
        disabled={busy || !validPassword(password) || confirmed !== password}
        onPress={() => void perform(async () => {
          const exported = await create({ password });
          setResult(exported.backup);
          setMessage(`Encrypted backup ready · ${exported.count} accounts`);
          setPassword("");
          setConfirmed("");
          setFormVersion((value) => value + 1);
        })} />
      {result ? <View style={row}>
        {canUseBackupFiles() ? <Action theme={theme} primary label="Download backup" icon="Download" onPress={() => downloadBackup(result)} /> : null}
        <Action theme={theme} label="Copy encrypted backup" onPress={() => void perform(async () => {
          await copyText(result);
          setMessage("Encrypted backup copied.");
        })} />
      </View> : null}
      <Feedback theme={theme} message={message} problem={problem} />
    </Section>
  );
}

function RestoreBackup({ theme, onRestored }: { theme: Theme; onRestored(): void }) {
  const restore = useRpc(importBackup);
  const { message, setMessage, problem, busy, perform } = useOperation();
  const [password, setPassword] = useState("");
  const [source, setSource] = useState("");
  const [formVersion, setFormVersion] = useState(0);
  const colors = theme.colors;

  return (
    <Section theme={theme} title="Restore from backup"
      description="Choose or paste a Relayline backup and enter its password. Accounts already in the pool are kept as they are; the rest are added.">
      {canUseBackupFiles() ? <Action theme={theme} label="Choose backup file" icon="Upload" disabled={busy} onPress={() => void perform(async () => {
        const backup = await pickBackup();
        if (backup !== null) { setSource(backup); setMessage("Backup file loaded. Enter its password to restore."); }
      })} /> : null}
      <TextInput accessibilityLabel="Encrypted backup" placeholder={canUseBackupFiles() ? "Or paste the encrypted backup" : "Paste the encrypted backup"}
        placeholderTextColor={colors.foregroundMuted} value={source} onChangeText={setSource} multiline autoCapitalize="none"
        autoCorrect={false} maxLength={maxBackupSize} editable={!busy}
        style={{ color: colors.foreground, borderColor: colors.border, borderWidth: 1, borderRadius: 6, minHeight: 68, padding: 8 }} />
      <SettingsCard key={formVersion}>
        <SettingsInput label="Backup password" secureTextEntry onChangeText={setPassword} disabled={busy} />
      </SettingsCard>
      <Action theme={theme} label={busy ? "Restoring…" : "Restore accounts"} primary
        disabled={busy || !validPassword(password) || !source.trim()}
        onPress={() => void perform(async () => {
          const restored = await restore({ backup: source, password });
          setMessage(restored.skipped
            ? `Restored ${restored.added} accounts · ${restored.skipped} already in the pool`
            : `Restored ${restored.added} accounts`);
          setPassword("");
          setSource("");
          setFormVersion((value) => value + 1);
          onRestored();
        })} />
      <Feedback theme={theme} message={message} problem={problem} />
    </Section>
  );
}

export function BackupPanel({ theme, hasAccounts, onImported }: {
  theme: Theme; hasAccounts: boolean; onImported(): void;
}) {
  return (
    <View style={{ gap: 12 }}>
      <RestoreBackup theme={theme} onRestored={onImported} />
      {hasAccounts ? <CreateBackup theme={theme} /> : null}
    </View>
  );
}
