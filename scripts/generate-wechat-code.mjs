import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnv(path.join(ROOT, ".env"));

const appid = process.env.WECHAT_APPID;
const secret = process.env.WECHAT_SECRET;
const envVersion = process.env.WECHAT_ENV_VERSION || "release";

if (!appid || !secret) {
  console.error("缺少 WECHAT_APPID 或 WECHAT_SECRET。");
  console.error("请先复制 .env.example 为 .env，并填入微信小程序 AppID 和 AppSecret。");
  process.exit(1);
}

const tokenUrl = new URL("https://api.weixin.qq.com/cgi-bin/token");
tokenUrl.searchParams.set("grant_type", "client_credential");
tokenUrl.searchParams.set("appid", appid);
tokenUrl.searchParams.set("secret", secret);

const tokenResponse = await fetch(tokenUrl);
const tokenData = await tokenResponse.json();
if (!tokenData.access_token) {
  console.error("获取微信 access_token 失败：", tokenData);
  process.exit(1);
}

const codeUrl = new URL("https://api.weixin.qq.com/wxa/getwxacodeunlimit");
codeUrl.searchParams.set("access_token", tokenData.access_token);

const response = await fetch(codeUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    scene: "src=qr",
    page: "pages/index/index",
    width: 600,
    check_path: true,
    env_version: envVersion,
    auto_color: false,
    line_color: { r: 15, g: 109, b: 90 },
    is_hyaline: false
  })
});

const contentType = response.headers.get("content-type") || "";
if (!response.ok || !contentType.includes("image")) {
  const text = await response.text();
  console.error("生成小程序码失败：", text);
  process.exit(1);
}

const buffer = Buffer.from(await response.arrayBuffer());
const output = path.join(ROOT, "public", "qr", "miniprogram.png");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, buffer);
console.log(`小程序码已生成：${output}`);
console.log("管理后台的“小程序码”页面会自动显示这张图片。");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] != null) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
