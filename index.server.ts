import type { PluginServerContext } from "@getpaseo/plugin/server";
import { Recovery } from "./server/recovery";
import { Pool } from "./server/pool";
import { enableLive } from "./server/setup";
import { TokenSetup } from "./server/token-setup";
import {
  beginTokenSetup, cancelTokenSetup, editAccount, exportBackup, importAccounts, importBackup,
  poolStatus, preferences, resume, saveAccount, setupLive, submitSetupCode, tokenSetupStatus, useAccount,
} from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  const pool = new Pool();
  const recovery = new Recovery(pool);
  const tokenSetup = new TokenSetup(pool);
  let values = preferences.schema.parse({});
  const refresh = () => void pool.recheck().catch(() => console.warn("[Relayline] Could not check account health."));
  const timer = setInterval(refresh, 300_000);
  timer.unref();
  refresh();
  const settings = server.registerSettings(preferences);
  const unsubscribe = settings.subscribe((state) => {
    if (state.status === "ready") recovery.configure(values = state.values);
  });
  const ready = settings.read().then((state) => {
    if (state.status === "ready") recovery.configure(values = state.values);
  }).catch(() => {});
  server.before("agent.session_open", async ({ request }) => {
    if (request.provider !== "claude" || request.background || request.purpose !== "interactive") return;
    await ready;
    const env = await pool.open(request.agentId, values).catch(() => undefined);
    return env ? { ...request, env: { ...request.env, ...env } } : undefined;
  });
  server.handle(setupLive, async () => {
    try { return await enableLive(); } catch (error) {
      throw new Error(error instanceof Error && !("cmd" in error) ? error.message : "Paseo could not reload its Claude command.");
    }
  });
  server.handle(poolStatus, async ({ agentId }, { paseo }) => {
    const [poolView, session] = await Promise.all([
      pool.view(agentId),
      agentId ? paseo.agents.ref(agentId).refresh().catch(() => null) : null,
    ]);
    return { ...poolView, sessionUsage: session?.agent.lastUsage ?? null };
  });
  server.handle(saveAccount, (input) => pool.save(input));
  server.handle(beginTokenSetup, (input) => tokenSetup.begin(input));
  server.handle(tokenSetupStatus, ({ id }) => tokenSetup.status(id));
  server.handle(submitSetupCode, ({ id, code }) => tokenSetup.submit(id, code));
  server.handle(cancelTokenSetup, ({ id }) => {
    tokenSetup.cancel(id);
    return {};
  });
  server.handle(exportBackup, ({ password }) => pool.exportBackup(password));
  server.handle(importBackup, async ({ backup, password }) => {
    const result = await pool.importBackup(backup, password);
    refresh();
    return result;
  });
  server.handle(editAccount, ({ id, action }) => pool.edit(id, action));
  server.handle(importAccounts, async () => {
    const count = await pool.importZeroSub();
    refresh();
    return { count };
  });
  server.handle(useAccount, async ({ agentId, accountId }) => {
    await pool.move(agentId, accountId);
    return pool.view(agentId);
  });
  server.on("agent.turn_ended", (event, { paseo }) => {
    void ready.then(() => recovery.observe(paseo, event)).catch(() => {
      console.warn("[Relayline] Could not inspect an interrupted turn.");
    });
  });
  server.on("agent.turn_started", ({ agent }, { paseo }) => {
    void recovery.supersede(paseo, agent.id).catch(() => {});
  });
  const forgetAgent = (id: string) => {
    recovery.forget(id);
    pool.clear(id);
  };
  server.on("agent.archived", ({ agent }) => forgetAgent(agent.id));
  server.on("agent.closed", ({ agent }) => forgetAgent(agent.id));
  server.handle(resume, async ({ agentId, incidentId }, { paseo }) => ({ stage: await recovery.resume(paseo, agentId, incidentId) }));
  return () => {
    clearInterval(timer);
    unsubscribe();
    recovery.close();
    tokenSetup.dispose();
  };
}
