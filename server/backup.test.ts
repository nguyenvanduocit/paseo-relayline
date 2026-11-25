import { expect, test } from "vitest";
import { decryptAccounts, encryptAccounts } from "./backup";

const password = "fixture-long-password";
const accounts = [{ label: "Demo", token: "sk-ant-oat-fixture", parked: true }];

test("encrypts all account fields and creates unique ciphertext for each export", async () => {
  const first = await encryptAccounts(accounts, password);
  const second = await encryptAccounts(accounts, password);
  expect(first).not.toContain(accounts[0]!.token);
  expect(first).not.toContain(accounts[0]!.label);
  expect(first).not.toBe(second);
  expect(await decryptAccounts(first, password)).toEqual(accounts);
});

test("rejects wrong passwords, tampering and plaintext account lists", async () => {
  const original = await encryptAccounts(accounts, password);
  await expect(decryptAccounts(original, "wrong-test-password")).rejects.toThrow(/Could not unlock/);
  const modified = JSON.parse(original) as { data: string };
  modified.data = (modified.data.startsWith("A") ? "B" : "A") + modified.data.slice(1);
  await expect(decryptAccounts(JSON.stringify(modified), password)).rejects.toThrow(/Could not unlock/);
  await expect(decryptAccounts(JSON.stringify(accounts), password)).rejects.toThrow(/encrypted account backup/);
});
