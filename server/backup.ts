import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { z } from "zod";
import { maxBackupSize } from "../shared/contracts";

export const credential = z.string().regex(/^sk-ant-oat[A-Za-z0-9_-]+$/).max(8192);
export const backupAccounts = z.array(z.object({
  label: z.string().trim().min(1).max(64),
  token: credential,
  parked: z.boolean(),
}));
const encoded = z.string().regex(/^[A-Za-z0-9_-]+$/);
const envelope = z.object({
  format: z.literal("relayline-account-backup"),
  version: z.literal(1),
  salt: encoded.length(22),
  nonce: encoded.length(16),
  tag: encoded.length(22),
  data: encoded.max(maxBackupSize),
}).strict();
const header = Buffer.from("relayline-account-backup/v1");

function keyFor(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 65_536, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function encryptAccounts(accounts: z.infer<typeof backupAccounts>, password: string): Promise<string> {
  const plain = Buffer.from(JSON.stringify(accounts));
  if (plain.length > (maxBackupSize - 512) * 0.75) throw new Error("This account pool is too large to export in a single backup.");
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await keyFor(password, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(header);
    const result = Buffer.concat([cipher.update(plain), cipher.final()]);
    return JSON.stringify({
      format: "relayline-account-backup", version: 1, salt: salt.toString("base64url"),
      nonce: nonce.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: result.toString("base64url"),
    });
  } finally {
    plain.fill(0);
    key.fill(0);
  }
}

export async function decryptAccounts(text: string, password: string): Promise<z.infer<typeof backupAccounts>> {
  let parsed: z.infer<typeof envelope>;
  try {
    if (text.length > maxBackupSize) throw new Error();
    parsed = envelope.parse(JSON.parse(text));
  } catch {
    throw new Error("Choose a Relayline encrypted account backup.");
  }
  const key = await keyFor(password, Buffer.from(parsed.salt, "base64url"));
  let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.nonce, "base64url"));
    decipher.setAAD(header);
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
    plaintext = decipher.update(Buffer.from(parsed.data, "base64url"));
    const tail = decipher.final(); // GCM authenticates the entire backup here.
    return backupAccounts.parse(JSON.parse(plaintext.toString("utf8") + tail.toString("utf8")));
  } catch {
    throw new Error("Could not unlock this backup. Check its password and try the original file.");
  } finally {
    plaintext?.fill(0);
    key.fill(0);
  }
}
