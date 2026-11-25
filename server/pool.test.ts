import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preferences } from "../shared/contracts";

const bridge = vi.hoisted(() => ({ ready: true, update: vi.fn(), directory: "/tmp/relayline-demo" }));
vi.mock("./setup", () => ({
  liveConfigured: async () => bridge.ready,
  readHostConfig: async () => null,
  competingPlugin: () => false,
}));
vi.mock("./claude-live", () => ({
  liveClaudeDirectory: () => bridge.directory,
  updateClaudeToken: bridge.update,
}));

let root: string;
let pool: InstanceType<typeof import("./pool").Pool>;
const first = "sk-ant-oat-fixture-one";
const second = "sk-ant-oat-fixture-two";
const settings = preferences.schema.parse({ accountPolicy: "spread" });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relayline-pool-"));
  bridge.ready = true;
  bridge.update.mockReset().mockResolvedValue(123);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/oauth/usage")) return new Response(null, { status: 403 });
    const headers = init.headers as Record<string, string>;
    return new Response(null, { status: headers.Authorization.includes("fixture-rejected") ? 401 : 200 });
  }));
  pool = new (await import("./pool")).Pool(root);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

describe("account pool", () => {
  it("checks and redacts tokens, and leaves unverified or parked accounts out of routing", async () => {
    await pool.save({ label: "Rejected", token: "sk-ant-oat-fixture-rejected" });
    const { accounts } = await pool.save({ label: "Available", token: first });
    expect(accounts.map(({ health }) => health)).toEqual(["rejected", "ready"]);
    expect(JSON.stringify(accounts)).not.toContain(first);
    await pool.edit(accounts[1]!.id, "park");
    expect(await pool.open("example", settings)).toBeUndefined();
  });

  it("retains the launch during quota failover and temporarily excludes a limited account", async () => {
    await pool.save({ label: "First", token: first });
    await pool.save({ label: "Second", token: second });
    expect((await pool.open("example", settings))?.CLAUDE_CODE_OAUTH_TOKEN).toBe(first);
    expect(await pool.failover("example", "quota", settings)).toBe(true);
    expect(bridge.update).toHaveBeenCalledWith(bridge.directory, second);
    const { activeAccount, accounts } = await pool.view("example");
    expect(activeAccount).toBe(accounts[1]!.id);
    expect(accounts[0]!.health).toBe("cooling");
  });

  it("leaves the old assignment in place when Claude does not confirm the switch", async () => {
    await pool.save({ label: "First", token: first });
    const { accounts } = await pool.save({ label: "Second", token: second });
    await pool.open("example", settings);
    bridge.update.mockResolvedValueOnce(null);
    await expect(pool.move("example", accounts[1]!.id)).rejects.toThrow(/did not confirm/);
    expect((await pool.view("example")).activeAccount).toBe(accounts[0]!.id);
  });

  it("persists a replacement and updates already assigned sessions", async () => {
    const { accounts } = await pool.save({ label: "Account", token: first });
    await pool.open("example", settings);
    await pool.save({ id: accounts[0]!.id, label: "Account", token: second });
    expect(bridge.update).toHaveBeenCalledWith(bridge.directory, second);
    const disk = await readFile(join(root, "relayline", "accounts.json"), "utf8");
    expect(disk.includes(second)).toBe(true);
    expect(disk.includes(first)).toBe(false);
  });

  it("preserves a normal Claude launch while disabled or unconfigured", async () => {
    await pool.save({ label: "Available", token: first });
    expect(await pool.open("example", preferences.schema.parse({}))).toBeUndefined();
    bridge.ready = false;
    expect(await pool.open("example", settings)).toBeUndefined();
  });
});

it("keeps token health usable while pausing all quota probes on provider throttling", async () => {
  const fetcher = vi.fn(async (url: string) => url.endsWith("/api/oauth/usage")
    ? new Response(null, { status: 429, headers: { "retry-after": "600" } })
    : new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  await pool.save({ label: "First", token: first });
  const { accounts } = await pool.save({ label: "Second", token: second });
  expect(accounts.map((account) => account.health)).toEqual(["ready", "ready"]);
  expect(accounts.map((account) => account.quota?.status ?? null)).toEqual(["unavailable", null]);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/api/oauth/usage"))).toHaveLength(1);
});

it("imports encrypted backups additively and preserves the pause state of new accounts", async () => {
  const otherRoot = await mkdtemp(join(tmpdir(), "relayline-restore-"));
  try {
    const { Pool } = await import("./pool");
    const target = new Pool(otherRoot);
    const { accounts } = await pool.save({ label: "Backed up", token: second });
    await pool.edit(accounts[0]!.id, "park");
    await pool.save({ label: "Source duplicate", token: first });
    await target.save({ label: "Existing account", token: first });
    const password = "fixture-long-password";
    const { backup } = await pool.exportBackup(password);
    expect(await target.importBackup(backup, password)).toEqual({ added: 1, skipped: 1 });
    expect((await target.view()).accounts.map(({ label, parked }) => ({ label, parked }))).toEqual([
      { label: "Existing account", parked: false },
      { label: "Backed up", parked: true },
    ]);
    expect(await target.importBackup(backup, password)).toEqual({ added: 0, skipped: 2 });
  } finally {
    await rm(otherRoot, { recursive: true, force: true });
  }
});
