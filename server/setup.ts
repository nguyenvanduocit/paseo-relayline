import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const paseoHome = process.env.PASEO_HOME || join(homedir(), ".paseo");
export const relayHome = join(paseoHome, "relayline");
const bridge = join(relayHome, "claude-live.py");
const config = join(paseoHome, "config.json");

interface HostConfig {
  agents?: { providers?: { claude?: { command?: unknown; [key: string]: unknown } } };
  plugins?: { relayline?: { path?: string }; zerosub?: { enabled?: boolean }; "zerosub-oauth"?: { enabled?: boolean } };
}

export async function readHostConfig(): Promise<HostConfig> {
  return JSON.parse(await readFile(config, "utf8")) as HostConfig;
}

export function competingPlugin(settings: HostConfig) {
  return [settings.plugins?.zerosub, settings.plugins?.["zerosub-oauth"]].some((entry) => entry && entry.enabled !== false);
}

export async function liveConfigured(): Promise<boolean> {
  const settings = await readHostConfig().catch(() => null);
  const command = settings?.agents?.providers?.claude?.command;
  return !!settings && !competingPlugin(settings) && Array.isArray(command) && command[1] === bridge &&
    await access(bridge).then(() => true, () => false);
}

async function findCommand(name: string): Promise<string> {
  const { stdout } = await exec("which", [name], { timeout: 3_000 });
  const path = stdout.trim();
  if (!isAbsolute(path)) throw new Error(`${name} is required on the Paseo host.`);
  return path;
}

export async function enableLive() {
  if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("Live switching requires a macOS or Linux host.");
  const before = await readFile(config, "utf8");
  const settings = JSON.parse(before) as HostConfig;
  if (competingPlugin(settings)) throw new Error("Disable ZeroSub's routing after importing its accounts, then enable Relayline.");
  const provider = (settings.agents ??= {}).providers ??= {};
  const claude = provider.claude ??= {};
  const existing = claude.command;
  const previousRelay = Array.isArray(existing) && existing[1] === bridge;
  const previousZeroSub = Array.isArray(existing) && typeof existing[1] === "string" &&
    /\/zerosub-oauth\/server\/claude-live\.py$/.test(existing[1]);
  if (existing && !previousRelay && !previousZeroSub) throw new Error("The host already has a custom Claude command. Restore the standard command before enabling Relayline.");
  const source = settings.plugins?.relayline?.path;
  if (!source || !isAbsolute(source)) throw new Error("Paseo did not provide the installed Relayline directory.");
  const [python, claudePath, paseo] = await Promise.all([findCommand("python3"), findCommand("claude"), findCommand("paseo")]);
  // Keep the executable stable across Git updates to the installed source directory.
  await mkdir(relayHome, { recursive: true, mode: 0o700 });
  await copyFile(join(source, "server", "claude-live.py"), bridge);
  claude.command = [python, bridge, claudePath];
  const next = `${JSON.stringify(settings, null, 2)}\n`;
  const temp = join(paseoHome, `.relayline-config-${randomUUID()}`);
  try {
    await writeFile(temp, next, { mode: 0o600, flag: "wx" });
    if ((await readFile(config, "utf8")) !== before) throw new Error("Paseo settings changed; try again.");
    await rename(temp, config);
    try {
      const { stdout } = await exec(paseo, ["reload", "--home", paseoHome, "--json"], { timeout: 8_000 });
      const result = JSON.parse(stdout) as { restartRequiredPaths?: string[]; overrideControlledPaths?: string[] };
      if ([...(result.restartRequiredPaths ?? []), ...(result.overrideControlledPaths ?? [])].some((path) => path.startsWith("agents.providers"))) {
        throw new Error("This host could not apply the Claude command without restarting.");
      }
    } catch (error) {
      if (await readFile(config, "utf8") === next) {
        await writeFile(temp, before, { mode: 0o600, flag: "wx" });
        await rename(temp, config);
      }
      throw error;
    }
  } finally {
    await unlink(temp).catch(() => {});
  }
  return { ready: true };
}
