import type { PluginClientContext } from "@getpaseo/plugin/client";
import { expect, test, vi } from "vitest";
import { contributePills } from "./pill";

vi.mock("react-native", () => ({ ActivityIndicator: "span", Pressable: "button", ScrollView: "div", Text: "span", TextInput: "input", View: "div" }));

vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: "span", useToast: () => ({ show: vi.fn() }) }));

test("registers a popover for Claude chat, follows upserts and removes pills on cleanup", async () => {
  const observe = vi.fn();
  const remove = vi.fn();
  const addComposerPill = vi.fn(() => ({ remove }));
  const list = vi.fn(async (_options: { signal: AbortSignal }) => ({ subscription: { subscribe: observe } }));
  const client = { addComposerPill, paseo: { agents: { list } } } as unknown as PluginClientContext;
  const cleanup = contributePills(client);
  await vi.waitFor(() => expect(observe).toHaveBeenCalledOnce());
  const listener = observe.mock.calls[0]![0];
  listener.snapshot({
    entries: [
      { agent: { id: "claude-agent", workspaceId: "workspace", provider: "claude" } },
      { agent: { id: "codex-agent", workspaceId: "workspace", provider: "codex" } },
    ],
    pageInfo: { hasMore: false },
  });
  expect(addComposerPill).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    agentId: "claude-agent", workspaceId: "workspace",
    button: expect.objectContaining({ label: "Claude account", behavior: expect.objectContaining({ kind: "popover" }) }),
  }));
  listener.update({ type: "agent_update", payload: {
    kind: "upsert", agent: { id: "another-claude-agent", workspaceId: "workspace", provider: "claude" },
  } });
  expect(addComposerPill).toHaveBeenCalledTimes(2);
  listener.update({ type: "agent_update", payload: { kind: "remove", agentId: "claude-agent" } });
  expect(remove).toHaveBeenCalledOnce();
  cleanup();
  expect(remove).toHaveBeenCalledTimes(2);
  expect(list.mock.calls[0]![0].signal.aborted).toBe(true);
});
