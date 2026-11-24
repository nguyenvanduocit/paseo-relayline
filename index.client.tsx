import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { AccountScreen } from "./client/account-screen";
import { contributePills } from "./client/pill";
import { IncidentRow } from "./client/incident";
import { incidentRow, incidentSchema, resume } from "./shared/contracts";

function RelaylineItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="Repeat2" active={currentScreen?.screenId === "accounts"} onPress={() => openScreen({ screenId: "accounts" })} />;
}

export default function contribute(client: PluginClientContext) {
  const disposeScreen = client.addScreen({ id: "accounts", title: "Relayline", Component: AccountScreen });
  const disposeSidebar = client.addSidebarHeaderItem({ id: "accounts", title: "Relayline", Component: RelaylineItem });
  const disposeCommand = client.addCommandCenterItem({
    id: "switch", title: "Relayline: Manage this agent’s Claude account", icon: "Repeat2", context: "agent",
    onSelect({ agent, openScreen }) { openScreen({ screenId: "accounts", params: { agentId: agent.id } }); },
  });
  const disposeSlash = client.addSlashCommand({
    name: "relay-resume", description: "Continue the current Relayline incident", argumentHint: "", context: "agent",
    async onSubmit({ agent, rpc }) { await rpc(resume, { agentId: agent.id }); },
  });
  const disposePills = contributePills(client);
  const disposeRenderer = client.addTimelineRenderer({ ...incidentRow, schema: incidentSchema, Component: IncidentRow });
  return () => {
    disposeRenderer();
    disposePills();
    disposeSlash();
    disposeCommand();
    disposeSidebar();
    disposeScreen();
  };
}
