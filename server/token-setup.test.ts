import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import { announcedToken, authorizationFailure, authorizeLink, issuedToken, TokenSetup } from "./token-setup";

vi.mock("./setup", () => ({
  findCommand: async (name: string) => `/usr/bin/${name}`,
  readHostConfig: async () => ({ plugins: { relayline: { path: "/relayline-test" } } }),
}));

const processStub = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: processStub.spawn }));

const authorize = "https://claude.com/cai/oauth/authorize?state=fixture&client_id=fixture&response_type=code&code_challenge=fixture";
const dummyToken = "sk-ant-oat01-test-" + "a".repeat(35);
const sessions: TokenSetup[] = [];

function childProcess() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(),
  });
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  processStub.spawn.mockReset();
});

test("accepts only Claude authorization endpoints with PKCE parameters", () => {
  expect(authorizeLink(`\x1b[33m${authorize}\x1b[0m\n`)).toBe(authorize);
  expect(authorizeLink(authorize.replace("claude.com", "wrong.invalid") + "\n")).toBeNull();
  expect(authorizeLink(authorize.split("&code_challenge")[0]! + "\n")).toBeNull();
  expect(issuedToken(`Token: \x1b[32m${dummyToken}-\x1b[0m\n`)).toBe(dummyToken + "-");
});

test("sends only the user code to the terminal and saves the issued token without returning it", async () => {
  const child = childProcess();
  processStub.spawn.mockReturnValueOnce(child);
  const save = vi.fn(async () => ({ accounts: [], activeAccount: null, liveReady: false, blockedByZeroSub: false }));
  const setup = new TokenSetup({ save });
  sessions.push(setup);
  const { id } = await setup.begin({ label: "Demo cohort" });
  child.stdout.write(authorize + "\n");
  expect(setup.status(id)).toMatchObject({ phase: "authorize", url: authorize });
  const read = vi.fn();
  child.stdin.on("data", read);
  expect(() => setup.submit(id, "incomplete")).toThrow(/including the #/);
  expect(setup.status(id).phase).toBe("authorize");
  expect(read).not.toHaveBeenCalled();
  expect(setup.submit(id, "code#state").phase).toBe("exchanging");
  expect(read).toHaveBeenCalledWith(Buffer.from("code#state\r"));
  child.stdout.write(dummyToken + "\n");
  child.emit("close", 0);
  await vi.waitFor(() => expect(setup.status(id).phase).toBe("saved"));
  expect(save).toHaveBeenCalledWith({ id: undefined, label: "Demo cohort", token: dummyToken }, { verifyInBackground: true });
  expect(JSON.stringify(setup.status(id))).not.toContain(dummyToken);
});

test("cancellation never saves a late token", async () => {
  const child = childProcess();
  processStub.spawn.mockReturnValueOnce(child);
  const save = vi.fn(async () => ({ accounts: [], activeAccount: null, liveReady: false, blockedByZeroSub: false }));
  const setup = new TokenSetup({ save });
  sessions.push(setup);
  const { id } = await setup.begin({ label: "Canceled" });
  child.stdout.write(authorize + "\n");
  setup.submit(id, "fixture#state");
  setup.cancel(id);
  child.stdout.write(dummyToken + "\n");
  child.emit("close", 0);
  expect(child.kill).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  expect(() => setup.status(id)).toThrow(/no longer active/);
});

test("exits the waiting state when Claude rejects a code without closing", async () => {
  const child = childProcess();
  processStub.spawn.mockReturnValueOnce(child);
  const save = vi.fn(async () => ({ accounts: [], activeAccount: null, liveReady: false, blockedByZeroSub: false }));
  const setup = new TokenSetup({ save });
  sessions.push(setup);
  const { id } = await setup.begin({ label: "Rejected" });
  child.stdout.write(authorize + "\n");
  setup.submit(id, "fixture#state");
  child.stdout.write("OAuth error: That code\x1b[31mwasn'taccepted.\x1b[0m");
  expect(setup.status(id)).toMatchObject({ phase: "failed", url: null, detail: expect.stringContaining("Claude rejected") });
  expect(child.kill).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  child.emit("close", 1);
  expect(authorizationFailure("Copy all of it, including the # in the middle.")).toMatch(/including the #/);
});

test("bounds an unresponsive authorization exchange to 45 seconds", async () => {
  vi.useFakeTimers();
  try {
    const child = childProcess();
    processStub.spawn.mockReturnValueOnce(child);
    const save = vi.fn(async () => ({ accounts: [], activeAccount: null, liveReady: false, blockedByZeroSub: false }));
    const setup = new TokenSetup({ save });
    sessions.push(setup);
    const { id } = await setup.begin({ label: "Slow" });
    child.stdout.write(authorize + "\n");
    setup.submit(id, "fixture#state");
    await vi.advanceTimersByTimeAsync(45_000);
    expect(setup.status(id)).toMatchObject({ phase: "failed", detail: expect.stringContaining("45 seconds") });
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit("close", 1);
  } finally {
    vi.useRealTimers();
  }
});

test("saves a complete success screen even while the official CLI process stays open", async () => {
  const child = childProcess();
  processStub.spawn.mockReturnValueOnce(child);
  const save = vi.fn(async () => ({ accounts: [], activeAccount: null, liveReady: false, blockedByZeroSub: false }));
  const setup = new TokenSetup({ save });
  sessions.push(setup);
  const { id } = await setup.begin({ label: "Success" });
  child.stdout.write(authorize + "\n");
  setup.submit(id, "fixture#state");
  const heading = "Long-lived authentication token created\nYour OAuth token (valid for 1 year):\n";
  child.stdout.write(heading + dummyToken.slice(0, -5));
  expect(setup.status(id).phase).toBe("exchanging");
  expect(announcedToken(heading + dummyToken)).toBeNull();
  child.stdout.write(dummyToken.slice(-5) + "\nStore this token securely.");
  await vi.waitFor(() => expect(setup.status(id).phase).toBe("saved"));
  expect(save).toHaveBeenCalledExactlyOnceWith({ id: undefined, label: "Success", token: dummyToken }, { verifyInBackground: true });
  expect(child.kill).toHaveBeenCalledOnce();
  child.emit("close", 1);
  expect(save).toHaveBeenCalledOnce();
});
