import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { z } from "zod";
import { isCompleteSetupCode, setupCodeHelp, setupTokenState } from "../shared/contracts";
import { credential } from "./backup";
import type { Pool } from "./pool";
import { findCommand, readHostConfig } from "./setup";

type State = z.infer<typeof setupTokenState>;
interface Job {
  state: State;
  child: ChildProcessWithoutNullStreams;
  profile: string;
  output: string;
  deadline: ReturnType<typeof setTimeout>;
}

const terminalCodes = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g;

export function authorizeLink(output: string): string | null {
  const clean = output.replace(terminalCodes, "");
  for (const match of clean.matchAll(/https:\/\/[^\s\x00-\x20<>"']+(?=[\s\x00-\x20<>"'])/g)) {
    try {
      const url = new URL(match[0]);
      const firstParty = url.origin === "https://claude.com" && url.pathname === "/cai/oauth/authorize" ||
        ["https://claude.ai", "https://console.anthropic.com", "https://platform.claude.com"].includes(url.origin) &&
        url.pathname === "/oauth/authorize";
      if (firstParty && url.searchParams.get("state") && url.searchParams.get("code_challenge") &&
          url.searchParams.get("client_id") && url.searchParams.get("response_type") === "code") return url.href;
    } catch {
      // Ignore terminal text that cannot be parsed as a URL.
    }
  }
  return null;
}

export function issuedToken(output: string): string | null {
  const token = output.replace(terminalCodes, "").match(/(?:^|[^A-Za-z0-9_-])(sk-ant-oat[A-Za-z0-9_-]{20,})/)?.[1];
  return token && credential.safeParse(token).success ? token : null;
}

export function announcedToken(output: string): string | null {
  const text = output.replace(terminalCodes, "");
  const heading = /long-lived\s*authentication\s*token\s*created/i.exec(text);
  if (!heading) return null;
  const afterHeading = text.slice(heading.index + heading[0].length);
  // Wait for the instructions after the token before parsing, so a partial read cannot be saved.
  const footer = /store\s*this\s*token\s*securely|use\s*this\s*token\s*by\s*setting/i.exec(afterHeading);
  return footer ? issuedToken(afterHeading.slice(0, footer.index)) : null;
}

export function authorizationFailure(output: string): string | null {
  // Ink's cursor moves can leave words visually separated without any whitespace in the stream.
  const text = output.replace(terminalCodes, "").replace(/\s+/g, "").toLowerCase();
  if (text.includes("includingthe#inthemiddle") || text.includes("doesn'tlooklikethefullcode")) return setupCodeHelp;
  if (text.includes("oautherror:") || text.includes("thatcodewasn'taccepted")) {
    return "Claude rejected this code. Start again, approve the new sign-in, and use the code from that page.";
  }
  return null;
}

export class TokenSetup {
  private current: Job | undefined;
  private launching = false;
  private stopped = false;

  constructor(private readonly pool: Pick<Pool, "save">) {}

  async begin({ accountId, label }: { accountId?: string; label: string }): Promise<State> {
    if (this.stopped) throw new Error("Relayline is shutting down.");
    if (this.launching || this.current?.state.phase === "saving") throw new Error("Another token setup is being saved.");
    if (!["linux", "darwin"].includes(process.platform)) throw new Error("Guided token setup needs a macOS or Linux host. You can still paste a token.");
    if (this.current) this.cancel(this.current.state.id);
    this.launching = true;
    let profile: string | undefined;
    try {
      const settings = await readHostConfig();
      const source = settings.plugins?.relayline?.path;
      if (!source || !isAbsolute(source)) throw new Error("Paseo did not provide the Relayline source directory.");
      const [python, claude] = await Promise.all([findCommand("python3"), findCommand("claude")]);
      profile = await mkdtemp(join(tmpdir(), "relayline-token-"));
      if (this.stopped) throw new Error("Relayline is shutting down.");
      const child = spawn(python, ["-I", join(source, "server", "setup-token.py"), claude, profile], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const id = randomUUID();
      const deadline = setTimeout(() => {
        const job = this.current;
        if (job?.state.id !== id || job.state.phase === "saved" || job.state.phase === "saving" || job.state.phase === "failed") return;
        this.fail(job, "Sign-in expired. Start again to get a fresh link.");
        job.child.kill();
      }, 8 * 60_000);
      deadline.unref();
      const job: Job = { state: { id, phase: "starting", url: null, detail: null }, child, profile, output: "", deadline };
      this.current = job;
      child.stderr.resume();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (this.current !== job || !["starting", "authorize", "exchanging"].includes(job.state.phase)) return;
        job.output = (job.output + chunk).slice(-128_000);
        if (job.state.phase === "starting") {
          const url = authorizeLink(job.output);
          if (url) job.state = { id, phase: "authorize", url, detail: null };
        } else if (job.state.phase === "exchanging") {
          const token = announcedToken(job.output);
          if (token) {
            void this.saveIssued(job, { accountId, label }, token);
            job.child.kill();
            return;
          }
          const failure = authorizationFailure(job.output);
          if (failure) {
            this.fail(job, failure);
            job.child.kill();
          }
        }
      });
      child.on("error", () => {
        if (this.current === job) this.fail(job, "Could not start Claude Code. Check Python 3 and Claude Code on this host.");
      });
      child.stdin.on("error", () => {
        if (this.current === job && job.state.phase === "exchanging") this.fail(job, "Claude Code closed before reading the authorization code.");
      });
      child.on("close", (code) => {
        void this.finish(job, code, { accountId, label });
      });
      profile = undefined; // finish() owns the temporary profile from here.
      return job.state;
    } catch (error) {
      if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
      throw error;
    } finally {
      this.launching = false;
    }
  }

  status(id: string): State {
    if (this.current?.state.id !== id) throw new Error("This token setup is no longer active.");
    return this.current.state;
  }

  submit(id: string, code: string): State {
    const state = this.status(id);
    if (state.phase !== "authorize" || !this.current) throw new Error("Claude Code is not waiting for an authorization code.");
    if (!isCompleteSetupCode(code)) throw new Error(setupCodeHelp);
    const job = this.current;
    job.state = { id, phase: "exchanging", url: null, detail: null };
    console.info("[Relayline] Setup token: authorization submitted.");
    job.output = "";
    clearTimeout(job.deadline);
    job.deadline = setTimeout(() => {
      if (this.current !== job || job.state.phase !== "exchanging") return;
      this.fail(job, "Claude did not finish authorizing within 45 seconds. Start again or paste an existing setup token.");
      job.child.kill();
    }, 45_000);
    job.deadline.unref();
    job.child.stdin.write(code.trim() + "\r");
    return job.state;
  }

  cancel(id: string) {
    const job = this.current;
    if (!job || job.state.id !== id || job.state.phase === "saving") return;
    this.current = undefined;
    job.output = "";
    clearTimeout(job.deadline);
    job.child.kill();
  }

  dispose() {
    this.stopped = true;
    if (this.current) this.cancel(this.current.state.id);
  }

  private fail(job: Job, detail: string) {
    job.output = "";
    job.state = { id: job.state.id, phase: "failed", url: null, detail };
    clearTimeout(job.deadline);
    console.info("[Relayline] Setup token: " + detail);
  }

  private async saveIssued(job: Job, { accountId, label }: { accountId?: string; label: string }, token: string) {
    if (this.current !== job || this.stopped || job.state.phase !== "exchanging") return;
    clearTimeout(job.deadline);
    job.output = "";
    job.state = { id: job.state.id, phase: "saving", url: null, detail: null };
    console.info("[Relayline] Setup token: Claude issued a token.");
    try {
      await this.pool.save({ id: accountId, label, token }, { verifyInBackground: true });
      job.state = { id: job.state.id, phase: "saved", url: null, detail: null };
      console.info("[Relayline] Setup token: account saved.");
    } catch {
      this.fail(job, "Could not save the new token. Check whether this account is already in the pool.");
    }
  }

  private async finish(job: Job, code: number | null, account: { accountId?: string; label: string }) {
    clearTimeout(job.deadline);
    try {
      if (this.current !== job || this.stopped || ["failed", "saving", "saved"].includes(job.state.phase)) return;
      const token = code === 0 && job.state.phase === "exchanging" ? issuedToken(job.output) : null;
      if (!token) {
        this.fail(job, "Claude Code did not issue a token. Verify the sign-in and try again, or paste a token.");
        return;
      }
      await this.saveIssued(job, account, token);
    } finally {
      job.output = "";
      await rm(job.profile, { recursive: true, force: true }).catch(() => {});
    }
  }
}
