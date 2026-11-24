import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { AccountScreen } from "./client/account-screen";
import { IncidentRow } from "./client/incident";
import { incidentRow, incidentSchema, resume } from "./shared/contracts";

function RelaylineItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="Repeat2" active={currentScreen?.screenId === "accounts"} onPress={() => openScreen({ screenId: "accounts" })} />;
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "accounts", title: "Relayline", Component: AccountScreen });
  client.addSidebarHeaderItem({ id: "accounts", title: "Relayline", Component: RelaylineItem });
  client.addCommandCenterItem({
    id: "switch", title: "Relayline: Manage this agent’s Claude account", icon: "Repeat2", context: "agent",
    onSelect({ agent, openScreen }) { openScreen({ screenId: "accounts", params: { agentId: agent.id } }); },
  });
  client.addSlashCommand({
    name: "relay-resume", description: "Continue the current Relayline incident", argumentHint: "", context: "agent",
    async onSubmit({ agent, rpc }) { await rpc(resume, { agentId: agent.id }); },
  });
  client.addTimelineRenderer({ ...incidentRow, schema: incidentSchema, Component: IncidentRow });
}
