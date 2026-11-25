import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { liveClaudeDirectory, updateClaudeToken } from "./claude-live";
import { competingPlugin, liveConfigured, paseoHome, readHostConfig } from "./setup";
import { credential, decryptAccounts, encryptAccounts } from "./backup";
import { readQuota } from "./quota";
import type { Preferences, Quota } from "../shared/contracts";

const storedAccounts = z.array(z.object({
  id: z.string(), label: z.string(), token: credential, parked: z.boolean().default(false),
}));
type Stored = z.infer<typeof storedAccounts>[number];
type Health = "unchecked" | "ready" | "rejected" | "unreachable";
type Route = { accountId: string; directory: string; fingerprint: string };
const fingerprint = (token: string) => createHash("sha256").update(token).digest("hex");

export class Pool {
  private readonly health = new Map<string, { status: Health; checkedAt: number; fingerprint: string }>();
  private readonly quotas = new Map<string, { fingerprint: string; data: Quota; retryAt: number }>();
  private readonly cooldown = new Map<string, number>();
  private readonly assignments = new Map<string, Route>();
  private readonly switches = new Set<string>();
  private writes = Promise.resolve();
  private quotaChecks = Promise.resolve();
  private quotaRetryAt = 0;
  private previous: string | undefined;
  private readonly data: string;
  private readonly file: string;

  constructor(private readonly root = paseoHome) {
    this.data = join(root, "relayline");
    this.file = join(this.data, "accounts.json");
  }

  private async read(): Promise<Stored[]> {
    let content: string;
    try {
      content = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("Relayline could not read its local account store.");
    }
    try {
      return storedAccounts.parse(JSON.parse(content));
    } catch {
      throw new Error("Relayline’s local account store is invalid.");
    }
  }

  private mutate<T>(update: (accounts: Stored[]) => T): Promise<T> {
    const task = this.writes.then(async () => {
      const accounts = await this.read();
      const result = update(accounts);
      await mkdir(this.data, { recursive: true, mode: 0o700 });
      const temporary = join(this.data, `accounts-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(accounts), { mode: 0o600, flag: "wx" });
        await rename(temporary, this.file);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return result;
    });
    this.writes = task.then(() => {}, () => {});
    return task;
  }

  async view(agentId?: string) {
    const now = Date.now();
    const accounts = (await this.read()).map(({ id, label, parked, token }) => {
      const until = this.cooldown.get(id);
      const quota = this.quotas.get(id);
      return { id, label, parked, health: until && until > now ? "cooling" as const : this.tokenHealth(id, token),
        availableAt: until && until > now ? until : null,
        quota: quota?.fingerprint === fingerprint(token) ? quota.data : null };

    });
    const config = await readHostConfig().catch(() => null);
    return { accounts, activeAccount: agentId ? this.assignments.get(agentId)?.accountId ?? null : null,
      liveReady: await liveConfigured(), blockedByZeroSub: !!config && competingPlugin(config) };
  }

  async save({ id, label, token }: { id?: string; label: string; token: string }, { verifyInBackground = false } = {}) {
    if (token && !credential.safeParse(token).success) throw new Error("Enter a Claude OAuth setup token.");
    const account = await this.mutate((accounts) => {
      const current = accounts.find((candidate) => candidate.id === id);
      if (id && !current) throw new Error("This account is no longer in the pool.");
      if (!token && !current) throw new Error("Enter a Claude OAuth setup token.");
      if (token && accounts.some((candidate) => candidate.token === token && candidate.id !== id)) throw new Error("This token is already in the pool.");
      const account: Stored = { id: current?.id ?? randomUUID(), label, token: token || current!.token, parked: current?.parked ?? false };
      if (current) accounts[accounts.indexOf(current)] = account;
      else accounts.push(account);
      return account;
    });
    if (token) {
      const verification = this.check(account).then(async (status) => {
        if (!id || status !== "ready") return;
        this.cooldown.delete(id);
        const agents = [...this.assignments].filter(([, route]) => route.accountId === id).map(([agentId]) => agentId);
        await Promise.allSettled(agents.map((agentId) => this.move(agentId, id)));
      });
      if (verifyInBackground) void verification.catch(() => {});
      else await verification;
    }
    return this.view();
  }

  async exportBackup(password: string) {
    const data = (await this.read()).map(({ label, token, parked }) => ({ label, token, parked }));
    if (!data.length) throw new Error("Add an account before creating a backup.");
    return { backup: await encryptAccounts(data, password), count: data.length };
  }

  async importBackup(backup: string, password: string) {
    const incoming = await decryptAccounts(backup, password);
    return this.mutate((accounts) => {
      const seen = new Set(accounts.map((account) => account.token));
      let added = 0;
      for (const account of incoming) {
        if (seen.has(account.token)) continue;
        seen.add(account.token);
        accounts.push({ ...account, id: randomUUID() });
        added++;
      }
      return { added, skipped: incoming.length - added };
    });
  }

  async importZeroSub() {
    const existing = await readFile(join(this.root, "zerosub", "state.json"), "utf8").catch(() => null);
    if (!existing) return 0;
    const source = z.object({ accounts: z.array(z.unknown()) }).parse(JSON.parse(existing));
    const candidates: Stored[] = [];
    for (const raw of source.accounts.slice(0, 500)) {
      const parsed = z.object({ family: z.literal("claude"), label: z.string(), home: z.string(), disabled: z.boolean().optional() }).safeParse(raw);
      if (!parsed.success || !isAbsolute(parsed.data.home)) continue;
      const { home: folder, label, disabled } = parsed.data;
      const options = await readFile(join(folder, "settings.account.json"), "utf8").catch(() => null);
      if (!options) continue;
      let settings: unknown;
      try { settings = JSON.parse(options); } catch { continue; }
      const env = z.object({ env: z.object({ ANTHROPIC_AUTH_TOKEN: credential, ANTHROPIC_BASE_URL: z.string().optional() }) }).safeParse(settings);
      if (!env.success) continue;
      const base = env.data.env.ANTHROPIC_BASE_URL?.trim().replace(/\/+$/, "").toLowerCase();
      if (base && base !== "https://api.anthropic.com") continue;
      candidates.push({ id: randomUUID(), label: label.trim().slice(0, 64) || "Claude account", token: env.data.env.ANTHROPIC_AUTH_TOKEN, parked: disabled === true });
    }
    return this.mutate((accounts) => {
      let count = 0;
      for (const account of candidates) {
        if (accounts.some(({ token }) => token === account.token)) continue;
        accounts.push(account);
        count++;
      }
      return count;
    });
  }

  async edit(id: string, action: "park" | "restore" | "remove" | "check") {
    if (action === "check") {
      const account = (await this.read()).find((candidate) => candidate.id === id);
      if (!account) throw new Error("This account is no longer in the pool.");
      await this.check(account);
    } else {
      await this.mutate((accounts) => {
        const index = accounts.findIndex((account) => account.id === id);
        if (index < 0) throw new Error("This account is no longer in the pool.");
        if (action === "remove") {
          accounts.splice(index, 1);
          this.health.delete(id);
          this.quotas.delete(id);
          this.cooldown.delete(id);
        } else accounts[index]!.parked = action === "park";
      });
    }
    return this.view();
  }

  async recheck() {
    const now = Date.now();
    const accounts = (await this.read()).filter((account) => !account.parked);
    for (let index = 0; index < accounts.length; index += 3) {
      await Promise.all(accounts.slice(index, index + 3).filter((account) => now - (this.health.get(account.id)?.checkedAt ?? 0) > 270_000).map((account) => this.check(account)));
    }
  }

  private tokenHealth(id: string, token: string): Health {
    const current = this.health.get(id);
    return current?.fingerprint === fingerprint(token) ? current.status : "unchecked";
  }

  private async check(account: Stored): Promise<Health> {
    let status: Health = "unreachable";
    const digest = fingerprint(account.token);
    const headers = { Authorization: `Bearer ${account.token}`, "anthropic-version": "2023-06-01", "anthropic-beta": "oauth-2025-04-20" };
    try {
      const response = await fetch("https://api.anthropic.com/v1/models?limit=1", {
        headers,
        signal: AbortSignal.timeout(5_000), redirect: "error",
      });
      status = response.ok ? "ready" : response.status === 401 ? "rejected" : "unreachable";
      await response.body?.cancel();
    } catch {
      // A connection failure leaves the credential unverified.
    }
    const stillCurrent = async () => (await this.read()).some(({ id, token }) => id === account.id && token === account.token);
    if (!await stillCurrent()) return status;
    this.health.set(account.id, { status, checkedAt: Date.now(), fingerprint: digest });
    if (status === "ready") {
      const reading = this.quotaChecks.then(async () => {
        const now = Date.now();
        const previous = this.quotas.get(account.id);
        if (now < this.quotaRetryAt || (previous?.fingerprint === digest && now < previous.retryAt)) return;
        if (!await stillCurrent()) return;
        const { quota, retryAt } = await readQuota(headers);
        if (retryAt) this.quotaRetryAt = retryAt;
        if (!await stillCurrent()) return;
        const data = quota.status === "unavailable" && previous?.fingerprint === digest && previous.data.status === "available"
          ? previous.data : quota;
        // Permission failures are sticky for a token. A replacement immediately gets its own check.
        const delay = quota.status === "restricted" ? 86_400_000 : 90_000;
        this.quotas.set(account.id, { fingerprint: digest, data, retryAt: retryAt ?? Date.now() + delay });
      });
      this.quotaChecks = reading.catch(() => {});
      await reading;
    }
    return status;
  }

  private async select(settings: Preferences, except?: string) {
    const now = Date.now();
    const accounts = (await this.read()).filter((account) => account.id !== except && !account.parked &&
      (this.cooldown.get(account.id) ?? 0) <= now && this.tokenHealth(account.id, account.token) === "ready");
    if (settings.accountPolicy === "spread") {
      const counts = new Map<string, number>();
      for (const assignment of this.assignments.values()) counts.set(assignment.accountId, (counts.get(assignment.accountId) ?? 0) + 1);
      accounts.sort((left, right) => (counts.get(left.id) ?? 0) - (counts.get(right.id) ?? 0));
    } else {
      const last = accounts.findIndex((account) => account.id === this.previous);
      if (last > 0) accounts.unshift(accounts.splice(last, 1)[0]!);
    }
    return accounts[0];
  }

  async open(agentId: string, settings: Preferences) {
    this.clear(agentId);
    if (settings.accountPolicy === "off" || !await liveConfigured()) return;
    const account = await this.select(settings);
    if (!account) return;
    const directory = liveClaudeDirectory();
    this.assignments.set(agentId, { accountId: account.id, directory, fingerprint: fingerprint(account.token) });
    this.previous = account.id;
    return { CLAUDE_CODE_OAUTH_TOKEN: account.token, ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_API_KEY: "", RELAYLINE_LIVE_DIR: directory };
  }

  clear(agentId: string) {
    this.assignments.delete(agentId);
  }

  async move(agentId: string, accountId: string) {
    const current = this.assignments.get(agentId);
    if (!current) throw new Error("Open a managed Claude session before switching accounts.");
    if (this.switches.has(agentId)) throw new Error("An account switch is already in progress.");
    this.switches.add(agentId);
    try {
      const account = (await this.read()).find((entry) => entry.id === accountId && !entry.parked);
      if (!account || this.tokenHealth(account.id, account.token) !== "ready" || (this.cooldown.get(account.id) ?? 0) > Date.now()) {
        throw new Error("That account is not ready.");
      }
      const digest = fingerprint(account.token);
      if (account.id === current.accountId && digest === current.fingerprint) return;
      if (this.assignments.get(agentId) !== current || !(await updateClaudeToken(current.directory, account.token))) {
        throw new Error("Claude did not confirm the live account switch.");
      }
      if (this.assignments.get(agentId) === current) {
        this.assignments.set(agentId, { ...current, accountId, fingerprint: digest });
        this.previous = accountId;
      }
    } finally {
      this.switches.delete(agentId);
    }
  }

  async failover(agentId: string, reason: "quota" | "authentication", settings: Preferences) {
    const current = this.assignments.get(agentId);
    if (!current || settings.accountPolicy === "off") return false;
    if (reason === "quota") this.cooldown.set(current.accountId, Date.now() + 30 * 60_000);
    else this.health.set(current.accountId, { status: "rejected", checkedAt: Date.now(), fingerprint: current.fingerprint });
    const next = await this.select(settings, current.accountId);
    if (!next) return false;
    await this.move(agentId, next.id);
    return true;
  }
}
