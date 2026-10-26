import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = path.join(ROOT, ".env");
const PROJECT_CONFIG_PATH = path.join(ROOT, "miniprogram", "project.config.json");
const appid = String(process.env.NEW_WECHAT_APPID || "").trim();
const secret = String(process.env.NEW_WECHAT_SECRET || "").trim();

if (!/^wx[a-zA-Z0-9]{16}$/.test(appid)) {
  console.error("AppID 格式不正确。微信小程序 AppID 通常以 wx 开头，共 18 位。");
  process.exit(1);
}
if (secret.length < 16) {
  console.error("AppSecret 格式不正确。");
  process.exit(1);
}

const endpoint = new URL("https://api.weixin.qq.com/cgi-bin/token");
endpoint.searchParams.set("grant_type", "client_credential");
endpoint.searchParams.set("appid", appid);
endpoint.searchParams.set("secret", secret);

let result;
try {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
  result = await response.json();
} catch {
  console.error("无法连接微信接口，请检查网络后重试。");
  process.exit(1);
}

if (!result.access_token) {
  console.error("微信凭据验证失败：", result.errmsg || "未知错误");
  console.error("请确认 AppID 与 AppSecret 属于同一个小程序，并且 AppSecret 没有被重置。");
  process.exit(1);
}

updateEnv({
  WECHAT_APPID: appid,
  WECHAT_SECRET: secret
});
updateProjectAppId(appid);

console.log(`微信凭据验证成功：${mask(appid)}`);
console.log("已写入 .env 和 miniprogram/project.config.json，AppSecret 不会显示或输出。");

function updateEnv(values) {
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
    const next = `${key}=${value}`;
    if (index >= 0) lines[index] = next;
    else lines.push(next);
  }
  const normalized = `${lines.filter((line, index, all) => line !== "" || index < all.length - 1).join("\n").replace(/\n+$/, "")}\n`;
  fs.writeFileSync(ENV_PATH, normalized, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(ENV_PATH, 0o600);
}

function updateProjectAppId(value) {
  const config = JSON.parse(fs.readFileSync(PROJECT_CONFIG_PATH, "utf8"));
  config.appid = value;
  fs.writeFileSync(PROJECT_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function mask(value) {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
