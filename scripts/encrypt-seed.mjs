import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = path.join(ROOT, ".env");
const INPUT_PATH = path.join(ROOT, "seed", "app.sqlite");
const OUTPUT_PATH = path.join(ROOT, "seed", "app.sqlite.enc");
const MAGIC = Buffer.from("HOES1");
const IV_LENGTH = 12;

loadEnv(ENV_PATH);

if (!fs.existsSync(INPUT_PATH)) {
  console.error("缺少 seed/app.sqlite，请先备份本地数据库。");
  process.exit(1);
}

let secret = process.env.SEED_ENCRYPTION_KEY;
if (!secret) {
  secret = crypto.randomBytes(32).toString("base64url");
  updateEnv("SEED_ENCRYPTION_KEY", secret);
}

const key = crypto.createHash("sha256").update(secret).digest();
const iv = crypto.randomBytes(IV_LENGTH);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([
  cipher.update(fs.readFileSync(INPUT_PATH)),
  cipher.final()
]);
const payload = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
fs.writeFileSync(OUTPUT_PATH, payload, { mode: 0o600 });

console.log(`已生成加密种子：${OUTPUT_PATH}`);
console.log("密钥只保存在本机 .env，不会写入代码仓库。");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] != null) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function updateEnv(key, value) {
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
  const next = `${key}=${value}`;
  if (index >= 0) lines[index] = next;
  else lines.push(next);
  fs.writeFileSync(ENV_PATH, `${lines.filter((line, index, all) => line || index < all.length - 1).join("\n").replace(/\n+$/, "")}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  fs.chmodSync(ENV_PATH, 0o600);
}
