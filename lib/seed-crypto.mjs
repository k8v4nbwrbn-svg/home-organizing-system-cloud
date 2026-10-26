import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAGIC = Buffer.from("HOES1");
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function prepareSeedSqlite(root, dataDir) {
  const encryptedPath = path.join(root, "seed", "app.sqlite.enc");
  const plaintextPath = path.join(root, "seed", "app.sqlite");
  if (!fs.existsSync(encryptedPath)) {
    return { path: plaintextPath, temporary: false };
  }

  const secret = process.env.SEED_ENCRYPTION_KEY;
  if (!secret) throw new Error("SEED_ENCRYPTION_KEY is required to decrypt the cloud seed");

  const payload = fs.readFileSync(encryptedPath);
  if (payload.length <= MAGIC.length + IV_LENGTH + TAG_LENGTH || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Cloud seed file is invalid");
  }

  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_LENGTH;
  const dataStart = tagStart + TAG_LENGTH;
  const key = crypto.createHash("sha256").update(secret).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, payload.subarray(ivStart, tagStart));
  decipher.setAuthTag(payload.subarray(tagStart, dataStart));
  const plaintext = Buffer.concat([
    decipher.update(payload.subarray(dataStart)),
    decipher.final()
  ]);

  const outputPath = path.join(dataDir, "cloud-seed.sqlite");
  fs.writeFileSync(outputPath, plaintext, { mode: 0o600 });
  return { path: outputPath, temporary: true };
}

export function removeTemporarySeed(seed) {
  if (seed?.temporary) fs.rmSync(seed.path, { force: true });
}
