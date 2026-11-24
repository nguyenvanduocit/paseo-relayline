import { Icon } from "@getpaseo/plugin/client/ui";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Pressable, Text, View } from "react-native";
import type { z } from "zod";
import type { poolView } from "../shared/contracts";

type PluginTheme = PluginSurfaceProps["theme"];

export type Account = z.output<typeof poolView>["accounts"][number];

export function accountStatus(account: Account, theme: PluginTheme) {
  const colors = theme.colors;
  if (account.parked) return { label: "Paused", color: colors.foregroundMuted };
  switch (account.health) {
    case "ready": return { label: "Ready", color: colors.statusSuccess };
    case "rejected": return { label: "Replace token", color: colors.statusDanger };
    case "cooling": return { label: "Cooling down", color: colors.statusWarning };
    case "unchecked": return { label: "Checking", color: colors.foregroundMuted };
    case "unreachable": return { label: "Check unavailable", color: colors.statusWarning };
  }
}

export function Action({ theme, label, icon, onPress, disabled, primary, danger }: {
  theme: PluginTheme;
  label: string;
  icon?: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  const colors = theme.colors;
  const ink = primary ? colors.accentForeground : danger ? colors.statusDanger : colors.foreground;
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
        minHeight: 34, paddingHorizontal: 10, borderRadius: 7, opacity: disabled ? 0.45 : 1,
        backgroundColor: primary ? colors.accent : pressed ? colors.surface2 : colors.surface1,
        borderColor: primary ? colors.accent : colors.border, borderWidth: 1,
      })}>
      {icon ? <Icon name={icon} size={14} color={ink} /> : null}
      <Text style={{ color: ink, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function Status({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ color, fontSize: 12 }}>{label}</Text>
    </View>
  );
}
