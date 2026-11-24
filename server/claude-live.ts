import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { createConnection } from "node:net";

export function liveClaudeDirectory(): string {
  return `/tmp/relayline-${randomUUID().replaceAll("-", "")}`;
}

/** Sends a token only to the local bridge created for this launch. */
export async function updateClaudeToken(directory: string, token: string): Promise<number | null> {
  const path = `${directory}/control.sock`;
  try {
    const dir = await lstat(directory);
    const endpoint = await lstat(path);
    const uid = process.getuid?.();
    if (!dir.isDirectory() || dir.uid !== uid || (dir.mode & 0o077) !== 0 || !endpoint.isSocket() || endpoint.uid !== uid) return null;
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    const socket = createConnection(path);
    const deadline = setTimeout(() => finish(null), 5_000);
    let buffer = "";
    const finish = (pid: number | null) => {
      clearTimeout(deadline);
      socket.destroy();
      resolve(pid);
    };
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(JSON.stringify({ token }) + "\n"));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 1_024) return finish(null);
      if (!buffer.includes("\n")) return;
      try {
        const { ok, pid } = JSON.parse(buffer);
        finish(ok === true && Number.isSafeInteger(pid) && pid > 0 ? pid : null);
      } catch {
        finish(null);
      }
    });
    socket.once("error", () => finish(null));
    socket.once("end", () => finish(null));
  });
}
