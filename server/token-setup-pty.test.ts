import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { TokenSetup } from "./token-setup";

const binaries = vi.hoisted(() => ({ python: "", claude: "" }));
vi.mock("./setup", () => ({
  findCommand: async (name: string) => name === "python3" ? binaries.python : binaries.claude,
  readHostConfig: async () => ({ plugins: { relayline: { path: process.cwd() } } }),
}));

try {
  binaries.python = execFileSync("which", ["python3"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  // The real PTY fixture runs on the same platforms as guided setup.
}

test.skipIf(!binaries.python || !["darwin", "linux"].includes(process.platform))(
  "delivers authorization through the real PTY and saves before Claude exits",
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "relayline-pty-fixture-"));
    binaries.claude = join(folder, "fake-claude");
    const token = "sk-ant-oat01-fixture-" + "p".repeat(40);
    const save = vi.fn(async () => ({ accounts: [], activeAccount: null, liveReady: false, blockedByZeroSub: false }));
    const service = new TokenSetup({ save });
    try {
      await writeFile(binaries.claude, `#!${binaries.python}
import sys
import time
print("https://claude.com/cai/oauth/authorize?state=fixture&client_id=fixture&response_type=code&code_challenge=fixture", flush=True)
if sys.stdin.readline().strip() != "fixture#state":
    sys.exit(2)
print("Long-lived authentication token created", flush=True)
print("Your OAuth token (valid for 1 year):", flush=True)
print("${token}", flush=True)
print("Store this token securely.", flush=True)
time.sleep(30)
`);
      await chmod(binaries.claude, 0o700);
      const { id } = await service.begin({ label: "PTY test" });
      await vi.waitFor(() => expect(service.status(id).phase).toBe("authorize"));
      service.submit(id, "fixture#state");
      await vi.waitFor(() => expect(service.status(id).phase).toBe("saved"));
      expect(save).toHaveBeenCalledExactlyOnceWith(
        { id: undefined, label: "PTY test", token }, { verifyInBackground: true },
      );
    } finally {
      service.dispose();
      await rm(folder, { recursive: true, force: true });
    }
  },
);
