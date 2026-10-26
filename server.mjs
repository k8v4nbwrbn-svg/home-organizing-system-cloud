import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "app.sqlite");

loadEnv(path.join(ROOT, ".env"));
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(PUBLIC_DIR, "qr"), { recursive: true });
fs.mkdirSync(path.join(PUBLIC_DIR, "uploads", "support"), { recursive: true });

const PORT = Number(process.env.PORT || 8787);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MEMBER_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const useMysql = Boolean(process.env.MYSQL_ADDRESS);
let db;

if (useMysql) {
  const [{ MysqlSyncDatabase }, { initializeMysqlSchema, seedMysqlFromSqlite }] = await Promise.all([
    import("./lib/mysql-sync-db.mjs"),
    import("./lib/mysql-schema.mjs")
  ]);
  const [host, portValue] = process.env.MYSQL_ADDRESS.split(":");
  db = new MysqlSyncDatabase({
    host,
    port: Number(portValue || 3306),
    user: process.env.MYSQL_USERNAME || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "home_organizing"
  });
  initializeMysqlSchema(db);
  const { prepareSeedSqlite, removeTemporarySeed } = await import("./lib/seed-crypto.mjs");
  const seed = prepareSeedSqlite(ROOT, DATA_DIR);
  try {
    seedMysqlFromSqlite(db, seed.path);
  } finally {
    removeTemporarySeed(seed);
  }
} else {
  db = new DatabaseSync(DB_PATH);
  db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS pricing (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    address TEXT DEFAULT '',
    wechat_openid TEXT DEFAULT '',
    phone_bound INTEGER NOT NULL DEFAULT 0,
    source_scene TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    area REAL NOT NULL,
    layout TEXT NOT NULL,
    rooms INTEGER NOT NULL,
    service_keys_json TEXT NOT NULL,
    needs_text TEXT DEFAULT '',
    preferred_date TEXT DEFAULT '',
    urgency TEXT NOT NULL,
    quote_exact INTEGER NOT NULL,
    quote_low INTEGER NOT NULL,
    quote_high INTEGER NOT NULL,
    quote_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    admin_note TEXT DEFAULT '',
    follow_up_at TEXT DEFAULT '',
    source_scene TEXT DEFAULT '',
    deleted_at TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (member_id) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS followups (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    note TEXT NOT NULL,
    next_follow_up_at TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS coupon_campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    claim_code TEXT NOT NULL UNIQUE,
    discount_type TEXT NOT NULL,
    discount_value INTEGER NOT NULL,
    minimum_spend INTEGER NOT NULL DEFAULT 0,
    total_quantity INTEGER NOT NULL DEFAULT 0,
    per_member_limit INTEGER NOT NULL DEFAULT 1,
    valid_from TEXT DEFAULT '',
    valid_until TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    member_id TEXT DEFAULT '',
    member_openid TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available',
    claimed_at TEXT NOT NULL,
    used_at TEXT DEFAULT '',
    used_lead_id TEXT DEFAULT '',
    FOREIGN KEY (campaign_id) REFERENCES coupon_campaigns(id)
  );

  CREATE TABLE IF NOT EXISTS support_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    wechat_id TEXT DEFAULT '',
    qr_path TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS member_token_revocations (
    openid TEXT PRIMARY KEY,
    revoked_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    payment_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'paid',
    note TEXT DEFAULT '',
    paid_at TEXT NOT NULL,
    refunded_at TEXT DEFAULT '',
    refund_note TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);
  CREATE INDEX IF NOT EXISTS idx_coupons_openid ON coupons(member_openid);
  CREATE INDEX IF NOT EXISTS idx_coupons_campaign ON coupons(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_payments_lead ON payments(lead_id);
  CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
`);

const memberColumns = db.prepare("PRAGMA table_info(members)").all();
if (!memberColumns.some((column) => column.name === "wechat_openid")) {
  db.exec("ALTER TABLE members ADD COLUMN wechat_openid TEXT DEFAULT ''");
}
if (!memberColumns.some((column) => column.name === "phone_bound")) {
  db.exec("ALTER TABLE members ADD COLUMN phone_bound INTEGER NOT NULL DEFAULT 0");
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_members_wechat_openid
  ON members(wechat_openid) WHERE wechat_openid IS NOT NULL AND wechat_openid <> '';
`);
const leadColumns = db.prepare("PRAGMA table_info(leads)").all();
if (!leadColumns.some((column) => column.name === "deleted_at")) {
  db.exec("ALTER TABLE leads ADD COLUMN deleted_at TEXT DEFAULT ''");
  db.exec("CREATE INDEX IF NOT EXISTS idx_leads_deleted_at ON leads(deleted_at)");
}
}

const DEFAULT_PRICING = {
  brandName: "家政收纳服务",
  currency: "CNY",
  basePricePerSqm: 16,
  minimumPrice: 399,
  rangeMargin: 0.1,
  serviceOptions: [
    { key: "whole-home", group: "全屋整理", label: "全屋收纳", price: 260 },
    { key: "declutter", group: "全屋整理", label: "断舍离陪伴", price: 150 },
    { key: "kitchen", group: "空间专项", label: "厨房整理", price: 180 },
    { key: "wardrobe", group: "空间专项", label: "衣橱整理", price: 160 },
    { key: "move-in", group: "搬迁服务", label: "搬家还原", price: 220 },
    { key: "plan", group: "方案服务", label: "收纳方案设计", price: 280 }
  ],
  urgencyOptions: [
    { key: "normal", label: "普通预约", multiplier: 1 },
    { key: "weekend", label: "周末/节假日", multiplier: 1.1 },
    { key: "urgent", label: "48 小时内", multiplier: 1.3 }
  ]
};

ensureDefaultPricing();
migratePricingGroups();

const sessions = new Map();
const sseClients = new Set();
const rateLimits = new Map();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    if (pathname === "/api/health" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, time: nowIso() });
    }

    if (pathname === "/api/public/pricing" && req.method === "GET") {
      return sendJson(res, 200, publicPricing(), corsHeaders());
    }

    if (pathname === "/api/public/support-agents" && req.method === "GET") {
      return sendJson(res, 200, { agents: listSupportAgents(true) }, corsHeaders());
    }

    if (pathname === "/api/public/wechat-login" && req.method === "POST") {
      if (!allowPublicRequest(req, 20)) {
        return sendJson(res, 429, { error: "登录请求太频繁，请稍后再试" }, corsHeaders());
      }
      const body = await readJson(req);
      const code = cleanText(body.code, 300);
      if (!code) throw new ClientError("缺少微信登录 code");
      if (!process.env.WECHAT_APPID || !process.env.WECHAT_SECRET) {
        return sendJson(res, 503, {
          configured: false,
          error: "微信登录尚未配置，请先在服务器中设置 WECHAT_APPID 和 WECHAT_SECRET"
        }, corsHeaders());
      }
      const openid = await exchangeWechatCode(code);
      const member = db.prepare(`
        SELECT id, name, phone, address, phone_bound
        FROM members
        WHERE wechat_openid = ?
      `).get(openid);
      return sendJson(res, 200, {
        token: signMemberToken(openid),
        member: member ? { ...member, phoneBound: Boolean(member.phone_bound) } : null
      }, corsHeaders());
    }

    if (pathname === "/api/public/wechat-phone" && req.method === "POST") {
      const openid = requireMember(req);
      const body = await readJson(req);
      const code = cleanText(body.code, 300);
      if (!code) throw new ClientError("缺少微信手机号授权凭证");
      const phone = await exchangeWechatPhoneCode(code);
      const member = bindWechatPhone(openid, phone);
      return sendJson(res, 200, {
        phone,
        phoneBound: true,
        member
      }, corsHeaders());
    }

    if (pathname === "/api/public/member/phone" && req.method === "POST") {
      const openid = requireMember(req);
      const body = await readJson(req);
      const phone = String(body.phone || "").trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) throw new ClientError("请填写正确的 11 位手机号");
      const member = bindWechatPhone(openid, phone);
      return sendJson(res, 200, {
        phone,
        phoneBound: true,
        member
      }, corsHeaders());
    }

    if (pathname === "/api/public/coupons" && req.method === "GET") {
      const openid = requireMember(req);
      return sendJson(res, 200, {
        coupons: memberCoupons(openid)
      }, corsHeaders());
    }

    if (pathname === "/api/public/quote" && req.method === "POST") {
      if (!allowPublicRequest(req)) return sendJson(res, 429, { error: "请求太频繁，请稍后再试" }, corsHeaders());
      const body = await readJson(req);
      let quote = calculateQuote(body);
      if (body.couponId) {
        const openid = requireMember(req);
        const coupon = usableCoupon(body.couponId, openid);
        quote = applyCoupon(quote, coupon);
      }
      return sendJson(res, 200, quote, corsHeaders());
    }

    if (pathname === "/api/public/leads" && req.method === "POST") {
      if (!allowPublicRequest(req, 8)) return sendJson(res, 429, { error: "提交太频繁，请稍后再试" }, corsHeaders());
      const body = await readJson(req);
      const result = createLead(body);
      broadcast("lead.created", { id: result.leadId });
      return sendJson(res, 201, result, corsHeaders());
    }

    const statusMatch = pathname.match(/^\/api\/public\/leads\/([^/]+)\/status$/);
    if (statusMatch && req.method === "GET") {
      const phone = String(url.searchParams.get("phone") || "");
      const row = db.prepare(`
        SELECT l.id, l.status, l.quote_exact, l.quote_low, l.quote_high, l.created_at,
               m.name, m.phone, m.address
        FROM leads l JOIN members m ON m.id = l.member_id
        WHERE l.id = ? AND m.phone = ? AND l.deleted_at = ''
      `).get(statusMatch[1], phone);
      if (!row) return sendJson(res, 404, { error: "未找到该报价记录" }, corsHeaders());
      return sendJson(res, 200, row, corsHeaders());
    }

    if (pathname === "/api/public/me/leads" && req.method === "GET") {
      const token = getBearerToken(req);
      if (!token) throw new ClientError("请先完成微信登录");
      const openid = verifyMemberToken(token);
      const rows = db.prepare(`
        SELECT l.id, l.area, l.layout, l.rooms, l.preferred_date, l.urgency,
               l.quote_exact, l.quote_low, l.quote_high, l.quote_json,
               l.status, l.created_at, l.updated_at
        FROM leads l JOIN members m ON m.id = l.member_id
        WHERE m.wechat_openid = ? AND l.deleted_at = ''
        ORDER BY l.created_at DESC
        LIMIT 100
      `).all(openid);
      return sendJson(res, 200, {
        leads: rows.map(customerLead)
      }, corsHeaders());
    }

    if (pathname === "/api/admin/login" && req.method === "POST") {
      const body = await readJson(req);
      if (!safeEqual(String(body.password || ""), ADMIN_PASSWORD)) {
        return sendJson(res, 401, { error: "密码错误" });
      }
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, Date.now() + SESSION_TTL_MS);
      res.setHeader("Set-Cookie", `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/admin/logout" && req.method === "POST") {
      const token = getCookie(req, "admin_session");
      if (token) sessions.delete(token);
      res.setHeader("Set-Cookie", "admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
      return sendJson(res, 200, { ok: true });
    }

    if (pathname.startsWith("/api/admin/") && !requireAdmin(req, res)) return;

    if (pathname === "/api/admin/me" && req.method === "GET") {
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/admin/overview" && req.method === "GET") {
      return sendJson(res, 200, getOverview());
    }

    if (pathname === "/api/admin/members" && req.method === "GET") {
      return sendJson(res, 200, {
        members: searchMembers(url.searchParams)
      });
    }

    if (pathname === "/api/admin/leads" && req.method === "GET") {
      return sendJson(res, 200, listLeads(url.searchParams));
    }

    if (pathname === "/api/admin/payments" && req.method === "GET") {
      return sendJson(res, 200, {
        customers: listPaidCustomers(url.searchParams)
      });
    }

    const leadPaymentMatch = pathname.match(/^\/api\/admin\/leads\/([^/]+)\/payments$/);
    if (leadPaymentMatch && req.method === "POST") {
      const body = await readJson(req);
      const payment = createPayment(leadPaymentMatch[1], body);
      broadcast("payment.created", { id: payment.id, leadId: payment.leadId });
      return sendJson(res, 201, { payment });
    }

    const refundPaymentMatch = pathname.match(/^\/api\/admin\/payments\/([^/]+)\/refund$/);
    if (refundPaymentMatch && req.method === "POST") {
      const body = await readJson(req);
      const payment = refundPayment(refundPaymentMatch[1], body);
      if (!payment) return sendJson(res, 404, { error: "收款记录不存在" });
      broadcast("payment.refunded", { id: payment.id, leadId: payment.leadId });
      return sendJson(res, 200, { payment });
    }

    if (pathname === "/api/admin/support-agents" && req.method === "GET") {
      return sendJson(res, 200, listSupportAgents(false));
    }

    if (pathname === "/api/admin/support-agents" && req.method === "POST") {
      const body = await readJson(req, 5 * 1024 * 1024);
      const agent = createSupportAgent(body);
      broadcast("support.updated", { id: agent.id });
      return sendJson(res, 201, { agent });
    }

    const supportMatch = pathname.match(/^\/api\/admin\/support-agents\/([^/]+)$/);
    if (supportMatch && req.method === "PATCH") {
      const body = await readJson(req, 5 * 1024 * 1024);
      const agent = updateSupportAgent(supportMatch[1], body);
      if (!agent) return sendJson(res, 404, { error: "客服不存在" });
      broadcast("support.updated", { id: agent.id });
      return sendJson(res, 200, { agent });
    }

    if (pathname === "/api/admin/coupons" && req.method === "GET") {
      return sendJson(res, 200, listCouponCampaigns());
    }

    if (pathname === "/api/admin/coupons" && req.method === "POST") {
      const body = await readJson(req);
      const campaign = createCouponCampaign(body);
      broadcast("coupon.created", { id: campaign.id });
      return sendJson(res, 201, { campaign });
    }

    const couponMatch = pathname.match(/^\/api\/admin\/coupons\/([^/]+)$/);
    if (couponMatch && req.method === "PATCH") {
      const body = await readJson(req);
      const campaign = setCouponCampaignActive(couponMatch[1], Boolean(body.active));
      if (!campaign) return sendJson(res, 404, { error: "优惠券不存在" });
      broadcast("coupon.updated", { id: campaign.id });
      return sendJson(res, 200, { campaign });
    }

    const couponIssueMatch = pathname.match(/^\/api\/admin\/coupons\/([^/]+)\/issue$/);
    if (couponIssueMatch && req.method === "POST") {
      const body = await readJson(req);
      const coupon = issueCouponToMember(couponIssueMatch[1], body);
      broadcast("coupon.issued", { id: coupon.id });
      return sendJson(res, 201, { coupon });
    }

    const couponIssueAllMatch = pathname.match(/^\/api\/admin\/coupons\/([^/]+)\/issue-all$/);
    if (couponIssueAllMatch && req.method === "POST") {
      const result = issueCouponToAllMembers(couponIssueAllMatch[1]);
      broadcast("coupon.issued", { campaignId: couponIssueAllMatch[1], all: true });
      return sendJson(res, 200, result);
    }

    const leadMatch = pathname.match(/^\/api\/admin\/leads\/([^/]+)$/);
    if (leadMatch && req.method === "GET") {
      const detail = getLead(leadMatch[1]);
      return detail ? sendJson(res, 200, detail) : sendJson(res, 404, { error: "线索不存在" });
    }

    if (leadMatch && req.method === "PATCH") {
      const body = await readJson(req);
      const detail = updateLead(leadMatch[1], body);
      if (!detail) return sendJson(res, 404, { error: "线索不存在" });
      broadcast("lead.updated", { id: detail.lead.id, status: detail.lead.status });
      return sendJson(res, 200, detail);
    }

    if (leadMatch && req.method === "DELETE") {
      const detail = softDeleteLead(leadMatch[1]);
      if (!detail) return sendJson(res, 404, { error: "线索不存在或已在回收箱" });
      broadcast("lead.deleted", { id: detail.lead.id });
      return sendJson(res, 200, detail);
    }

    const restoreMatch = pathname.match(/^\/api\/admin\/leads\/([^/]+)\/restore$/);
    if (restoreMatch && req.method === "POST") {
      const detail = restoreLead(restoreMatch[1]);
      if (!detail) return sendJson(res, 404, { error: "回收箱中未找到该线索" });
      broadcast("lead.restored", { id: detail.lead.id });
      return sendJson(res, 200, detail);
    }

    const unbindMatch = pathname.match(/^\/api\/admin\/members\/([^/]+)\/unbind$/);
    if (unbindMatch && req.method === "POST") {
      const body = await readJson(req);
      const member = unbindMember(unbindMatch[1], String(body.scope || ""));
      if (!member) return sendJson(res, 404, { error: "客户不存在" });
      broadcast("member.unbound", { id: member.id, scope: body.scope });
      return sendJson(res, 200, { member });
    }

    if (pathname === "/api/admin/pricing" && req.method === "GET") {
      return sendJson(res, 200, getPricing());
    }

    if (pathname === "/api/admin/pricing" && req.method === "PUT") {
      const body = await readJson(req);
      const pricing = validatePricing(body.pricing);
      const updatedAt = nowIso();
      db.prepare("UPDATE pricing SET config_json = ?, updated_at = ? WHERE id = 1")
        .run(JSON.stringify(pricing), updatedAt);
      broadcast("pricing.updated", { updatedAt });
      return sendJson(res, 200, { pricing: getPricing(), updatedAt });
    }

    if (pathname === "/api/admin/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      res.write(": connected\n\n");
      sseClients.add(res);
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20000);
      req.on("close", () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
      });
      return;
    }

    if (pathname === "/qr/miniprogram.png" && fs.existsSync(path.join(PUBLIC_DIR, "qr", "miniprogram.png"))) {
      return serveFile(path.join(PUBLIC_DIR, "qr", "miniprogram.png"), res);
    }

    if (pathname === "/" || pathname === "/admin") {
      res.writeHead(302, { Location: "/admin/" });
      return res.end();
    }

    if (pathname === "/admin/") {
      return serveFile(path.join(PUBLIC_DIR, "admin", "index.html"), res);
    }

    const staticPath = pathname.startsWith("/admin/")
      ? path.join(PUBLIC_DIR, pathname)
      : path.join(PUBLIC_DIR, pathname);
    if (isInside(PUBLIC_DIR, staticPath) && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      return serveFile(staticPath, res);
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, error instanceof ClientError ? 400 : 500, {
      error: error instanceof ClientError ? error.message : "服务器错误"
    });
    else res.end();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`管理后台: http://127.0.0.1:${PORT}/admin/`);
  console.log(`API 健康检查: http://127.0.0.1:${PORT}/api/health`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log("未设置 ADMIN_PASSWORD，当前演示密码为 admin123");
  }
});

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] != null) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDefaultPricing() {
  const exists = db.prepare("SELECT id FROM pricing WHERE id = 1").get();
  if (!exists) {
    db.prepare("INSERT INTO pricing (id, config_json, updated_at) VALUES (1, ?, ?)")
      .run(JSON.stringify(DEFAULT_PRICING), nowIso());
  }
}

function migratePricingGroups() {
  const pricing = getPricing();
  const groups = {
    "whole-home": "全屋整理",
    "declutter": "全屋整理",
    "kitchen": "空间专项",
    "wardrobe": "空间专项",
    "move-in": "搬迁服务",
    "plan": "方案服务"
  };
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(pricing, "roomFee")) {
    delete pricing.roomFee;
    changed = true;
  }
  pricing.serviceOptions = (pricing.serviceOptions || []).map((item) => {
    if (item.group) return item;
    changed = true;
    return { ...item, group: groups[item.key] || "其他服务" };
  });
  if (changed) {
    db.prepare("UPDATE pricing SET config_json = ?, updated_at = ? WHERE id = 1")
      .run(JSON.stringify(pricing), nowIso());
  }
}

function getPricing() {
  const row = db.prepare("SELECT config_json, updated_at FROM pricing WHERE id = 1").get();
  return { ...JSON.parse(row.config_json), updatedAt: row.updated_at };
}

function publicPricing() {
  const pricing = getPricing();
  return {
    brandName: pricing.brandName,
    currency: pricing.currency,
    basePricePerSqm: pricing.basePricePerSqm,
    minimumPrice: pricing.minimumPrice,
    rangeMargin: pricing.rangeMargin,
    serviceOptions: pricing.serviceOptions,
    urgencyOptions: pricing.urgencyOptions,
    calculationNote: "最终报价以现场评估和客服确认为准"
  };
}

function calculateQuote(input) {
  const pricing = getPricing();
  const area = clampNumber(input.area, 10, 500, "房屋面积");
  const rooms = clampNumber(input.rooms, 1, 12, "房间数量");
  const serviceKeys = Array.isArray(input.serviceKeys)
    ? input.serviceKeys.map(String).filter((key, index, list) => list.indexOf(key) === index)
    : [];
  const urgencyKey = String(input.urgency || "normal");

  const selectedServices = serviceKeys.map((key) =>
    pricing.serviceOptions.find((item) => item.key === key)
  ).filter(Boolean);
  const urgency = pricing.urgencyOptions.find((item) => item.key === urgencyKey)
    || pricing.urgencyOptions[0];

  const areaFee = roundMoney(area * pricing.basePricePerSqm);
  const baseBeforeMinimum = areaFee;
  const baseFee = Math.max(areaFee, pricing.minimumPrice);
  const servicesFee = selectedServices.reduce((sum, item) => sum + item.price, 0);
  const beforeUrgency = baseFee + servicesFee;
  const exact = Math.max(0, roundMoney(beforeUrgency * urgency.multiplier));
  const low = Math.floor(exact * (1 - pricing.rangeMargin) / 10) * 10;
  const high = Math.ceil(exact * (1 + pricing.rangeMargin) / 10) * 10;

  return {
    exact,
    low,
    high,
    area,
    rooms,
    urgency,
    services: selectedServices,
    breakdown: [
      {
        label: `基础服务费（${area}㎡）`,
        amount: areaFee
      },
      ...(baseBeforeMinimum < pricing.minimumPrice ? [{
        label: "最低服务价补足",
        amount: pricing.minimumPrice - baseBeforeMinimum
      }] : []),
      ...selectedServices.map((item) => ({ label: item.label, amount: item.price })),
      ...(urgency.multiplier !== 1 ? [{
        label: `${urgency.label}加价（${Math.round((urgency.multiplier - 1) * 100)}%）`,
        amount: exact - beforeUrgency
      }] : [])
    ],
    disclaimer: "最终报价以现场评估和客服确认为准"
  };
}

function validatePricing(input) {
  const items = Array.isArray(input?.serviceOptions) ? input.serviceOptions : [];
  const urgencyItems = Array.isArray(input?.urgencyOptions) ? input.urgencyOptions : [];
  if (!items.length || !urgencyItems.length) throw new ClientError("报价规则不能为空");

  return {
    brandName: String(input.brandName || "家政收纳服务").slice(0, 40),
    currency: "CNY",
    basePricePerSqm: clampNumber(input.basePricePerSqm, 0, 10000, "每平方米价格"),
    minimumPrice: clampNumber(input.minimumPrice, 0, 1000000, "最低价"),
    rangeMargin: clampNumber(input.rangeMargin, 0, 0.5, "价格浮动比例"),
    serviceOptions: items.map((item, index) => ({
      key: String(item.key || `service-${index + 1}`).replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 40),
      group: String(item.group || "其他服务").trim().slice(0, 30),
      label: String(item.label || `服务 ${index + 1}`).slice(0, 30),
      price: clampNumber(item.price, 0, 100000, "服务价格")
    })),
    urgencyOptions: urgencyItems.map((item, index) => ({
      key: String(item.key || `urgency-${index + 1}`).replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 40),
      label: String(item.label || `时段 ${index + 1}`).slice(0, 30),
      multiplier: clampNumber(item.multiplier, 1, 5, "时段系数")
    }))
  };
}

function requireMember(req) {
  const token = getBearerToken(req);
  if (!token) throw new ClientError("请先完成微信登录");
  return verifyMemberToken(token);
}

function listCouponCampaigns() {
  const rows = db.prepare(`
    SELECT c.*,
           COUNT(cp.id) AS issued_count,
           SUM(CASE WHEN cp.status = 'used' THEN 1 ELSE 0 END) AS used_count,
           SUM(CASE WHEN cp.status = 'available' THEN 1 ELSE 0 END) AS available_count
    FROM coupon_campaigns c
    LEFT JOIN coupons cp ON cp.campaign_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all();
  return rows.map(couponCampaignView);
}

function createCouponCampaign(body) {
  const name = cleanText(body.name, 40);
  if (!name) throw new ClientError("请填写优惠券名称");
  const discountType = body.discountType === "percent" ? "percent" : "fixed";
  const maxValue = discountType === "percent" ? 100 : 1000000;
  const discountValue = Math.round(clampNumber(body.discountValue, 1, maxValue, "优惠金额"));
  const minimumSpend = Math.round(clampNumber(body.minimumSpend || 0, 0, 1000000, "最低消费"));
  const totalQuantity = Math.round(clampNumber(body.totalQuantity || 0, 0, 1000000, "发放数量"));
  const perMemberLimit = Math.round(clampNumber(body.perMemberLimit || 1, 1, 20, "每人限领"));
  const validFrom = cleanText(body.validFrom, 10);
  const validUntil = cleanText(body.validUntil, 10);
  validateDateRange(validFrom, validUntil);
  const claimCode = randomClaimCode();
  if (!/^[A-Z0-9-]{4,20}$/.test(claimCode)) {
    throw new ClientError("领取码只能使用 4-20 位字母、数字或短横线");
  }
  const exists = db.prepare("SELECT id FROM coupon_campaigns WHERE claim_code = ?").get(claimCode);
  if (exists) throw new ClientError("领取码已存在，请换一个");
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO coupon_campaigns (
      id, name, claim_code, discount_type, discount_value, minimum_spend,
      total_quantity, per_member_limit, valid_from, valid_until, active,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, name, claimCode, discountType, discountValue, minimumSpend,
    totalQuantity, perMemberLimit, validFrom, validUntil, timestamp, timestamp
  );
  return getCouponCampaign(id);
}

function setCouponCampaignActive(id, active) {
  const exists = db.prepare("SELECT id FROM coupon_campaigns WHERE id = ?").get(id);
  if (!exists) return null;
  db.prepare("UPDATE coupon_campaigns SET active = ?, updated_at = ? WHERE id = ?")
    .run(active ? 1 : 0, nowIso(), id);
  return getCouponCampaign(id);
}

function issueCouponToMember(campaignId, input) {
  const campaign = db.prepare("SELECT * FROM coupon_campaigns WHERE id = ?").get(campaignId);
  if (!campaign) throw new ClientError("优惠券不存在");
  assertCampaignUsable(campaign);
  const memberId = cleanText(input.memberId, 80);
  const phone = cleanText(input.phone, 20);
  const member = memberId
    ? db.prepare(`
        SELECT id, wechat_openid FROM members
        WHERE id = ? AND wechat_openid <> ''
      `).get(memberId)
    : db.prepare(`
        SELECT id, wechat_openid FROM members
        WHERE phone = ? AND wechat_openid <> ''
      `).get(phone);
  if (!member) throw new ClientError("客户还没有微信登录记录，无法定向发放");
  return createCouponForMember(campaign, member.wechat_openid, member.id);
}

function searchMembers(searchParams) {
  const query = cleanText(searchParams.get("q"), 50);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 20), 1), 50);
  const rows = db.prepare(`
    SELECT id, name, phone, wechat_openid, phone_bound, updated_at
    FROM members
    WHERE (? = '' OR name LIKE ? OR phone LIKE ?)
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(query, `%${query}%`, `%${query}%`, limit);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    wechatBound: Boolean(row.wechat_openid),
    phoneBound: Boolean(row.phone_bound),
    updatedAt: row.updated_at
  }));
}

function issueCouponToAllMembers(campaignId) {
  const campaign = db.prepare("SELECT * FROM coupon_campaigns WHERE id = ?").get(campaignId);
  if (!campaign) throw new ClientError("优惠券不存在");
  assertCampaignUsable(campaign);
  const members = db.prepare(`
    SELECT id, wechat_openid FROM members
    WHERE wechat_openid <> ''
    ORDER BY created_at ASC
  `).all();
  let issuedCount = 0;
  let skippedCount = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const member of members) {
      const issuedTotal = db.prepare(
        "SELECT COUNT(*) AS count FROM coupons WHERE campaign_id = ?"
      ).get(campaign.id).count;
      if (campaign.total_quantity > 0 && issuedTotal >= campaign.total_quantity) {
        skippedCount += 1;
        continue;
      }
      const memberCount = db.prepare(`
        SELECT COUNT(*) AS count FROM coupons
        WHERE campaign_id = ? AND member_openid = ?
      `).get(campaign.id, member.wechat_openid).count;
      if (memberCount >= campaign.per_member_limit) {
        skippedCount += 1;
        continue;
      }
      db.prepare(`
        INSERT INTO coupons (id, campaign_id, member_id, member_openid, status, claimed_at)
        VALUES (?, ?, ?, ?, 'available', ?)
      `).run(crypto.randomUUID(), campaign.id, member.id, member.wechat_openid, nowIso());
      issuedCount += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback failures after a failed transaction.
    }
    throw error;
  }
  return {
    totalMembers: members.length,
    issuedCount,
    skippedCount
  };
}

function createCouponForMember(campaign, openid, memberId) {
  const issued = db.prepare("SELECT COUNT(*) AS count FROM coupons WHERE campaign_id = ?")
    .get(campaign.id).count;
  if (campaign.total_quantity > 0 && issued >= campaign.total_quantity) {
    throw new ClientError("优惠券已领完");
  }
  const memberCount = db.prepare(`
    SELECT COUNT(*) AS count FROM coupons
    WHERE campaign_id = ? AND member_openid = ?
  `).get(campaign.id, openid).count;
  if (memberCount >= campaign.per_member_limit) {
    throw new ClientError("已达到每人领取上限");
  }
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO coupons (id, campaign_id, member_id, member_openid, status, claimed_at)
    VALUES (?, ?, ?, ?, 'available', ?)
  `).run(id, campaign.id, memberId, openid, nowIso());
  return getCouponById(id);
}

function memberCoupons(openid) {
  return db.prepare(`
    SELECT cp.*, c.name, c.claim_code, c.discount_type, c.discount_value,
           c.minimum_spend, c.valid_from, c.valid_until, c.active
    FROM coupons cp
    JOIN coupon_campaigns c ON c.id = cp.campaign_id
    WHERE cp.member_openid = ?
    ORDER BY CASE cp.status WHEN 'available' THEN 0 ELSE 1 END, cp.claimed_at DESC
    LIMIT 100
  `).all(openid).map(couponView);
}

function usableCoupon(id, openid) {
  const row = db.prepare(`
    SELECT cp.*, c.name, c.claim_code, c.discount_type, c.discount_value,
           c.minimum_spend, c.valid_from, c.valid_until, c.active
    FROM coupons cp
    JOIN coupon_campaigns c ON c.id = cp.campaign_id
    WHERE cp.id = ? AND cp.member_openid = ?
  `).get(id, openid);
  if (!row) throw new ClientError("优惠券不存在或不属于当前微信");
  if (row.status !== "available") throw new ClientError("优惠券已使用");
  assertCampaignUsable(row);
  return couponView(row);
}

function applyCoupon(quote, coupon) {
  if (quote.exact < coupon.minimumSpend) {
    throw new ClientError(`订单金额满 ¥${coupon.minimumSpend} 才可使用该优惠券`);
  }
  const discount = Math.min(
    quote.exact,
    coupon.discountType === "percent"
      ? Math.round(quote.exact * coupon.discountValue / 100)
      : coupon.discountValue
  );
  const exact = Math.max(0, quote.exact - discount);
  const pricing = getPricing();
  return {
    ...quote,
    beforeCoupon: quote.exact,
    exact,
    low: Math.floor(exact * (1 - pricing.rangeMargin) / 10) * 10,
    high: Math.ceil(exact * (1 + pricing.rangeMargin) / 10) * 10,
    discount,
    coupon: {
      id: coupon.id,
      name: coupon.name,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue
    },
    breakdown: [
      ...quote.breakdown,
      { label: `优惠券：${coupon.name}`, amount: -discount }
    ]
  };
}

function getCouponCampaign(id) {
  const row = db.prepare(`
    SELECT c.*,
           COUNT(cp.id) AS issued_count,
           SUM(CASE WHEN cp.status = 'used' THEN 1 ELSE 0 END) AS used_count,
           SUM(CASE WHEN cp.status = 'available' THEN 1 ELSE 0 END) AS available_count
    FROM coupon_campaigns c
    LEFT JOIN coupons cp ON cp.campaign_id = c.id
    WHERE c.id = ?
    GROUP BY c.id
  `).get(id);
  return row ? couponCampaignView(row) : null;
}

function getCouponById(id) {
  const row = db.prepare(`
    SELECT cp.*, c.name, c.claim_code, c.discount_type, c.discount_value,
           c.minimum_spend, c.valid_from, c.valid_until, c.active
    FROM coupons cp
    JOIN coupon_campaigns c ON c.id = cp.campaign_id
    WHERE cp.id = ?
  `).get(id);
  return row ? couponView(row) : null;
}

function couponCampaignView(row) {
  return {
    id: row.id,
    name: row.name,
    claimCode: row.claim_code,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    minimumSpend: row.minimum_spend,
    totalQuantity: row.total_quantity,
    perMemberLimit: row.per_member_limit,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    active: Boolean(row.active),
    issuedCount: Number(row.issued_count || 0),
    usedCount: Number(row.used_count || 0),
    availableCount: Number(row.available_count || 0),
    createdAt: row.created_at
  };
}

function couponView(row) {
  let status = row.status;
  if (status === "available") {
    if (!row.active) status = "disabled";
    else if (!isCampaignWithinDates(row)) status = "expired";
  }
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    claimCode: row.claim_code,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    minimumSpend: row.minimum_spend,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    status,
    claimedAt: row.claimed_at,
    usedAt: row.used_at || ""
  };
}

function couponValueText(coupon) {
  return coupon.discountType === "percent"
    ? `${coupon.name}（减免 ${coupon.discountValue}%）`
    : `${coupon.name}（立减 ¥${coupon.discountValue}）`;
}

function assertCampaignUsable(campaign) {
  if (!campaign.active) throw new ClientError("优惠券活动已停用");
  if (!isCampaignWithinDates(campaign)) throw new ClientError("优惠券不在有效期内");
}

function isCampaignWithinDates(campaign) {
  const now = Date.now();
  if (campaign.valid_from) {
    const start = new Date(`${campaign.valid_from}T00:00:00`).getTime();
    if (Number.isFinite(start) && now < start) return false;
  }
  if (campaign.valid_until) {
    const end = new Date(`${campaign.valid_until}T23:59:59`).getTime();
    if (Number.isFinite(end) && now > end) return false;
  }
  return true;
}

function validateDateRange(validFrom, validUntil) {
  for (const value of [validFrom, validUntil]) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ClientError("有效期日期格式错误");
  }
  if (validFrom && validUntil && validUntil < validFrom) {
    throw new ClientError("结束日期不能早于开始日期");
  }
}

function randomClaimCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function listSupportAgents(activeOnly) {
  const rows = db.prepare(`
    SELECT * FROM support_agents
    ${activeOnly ? "WHERE active = 1" : ""}
    ORDER BY sort_order ASC, created_at ASC
  `).all();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    wechatId: row.wechat_id || "",
    qrPath: row.qr_path,
    active: Boolean(row.active),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function createSupportAgent(body) {
  const name = cleanText(body.name, 30);
  if (!name) throw new ClientError("请填写客服名称");
  const qrPath = saveSupportQr(body.qrDataUrl, "");
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const sortOrder = Math.round(clampNumber(body.sortOrder || 0, 0, 999, "排序"));
  db.prepare(`
    INSERT INTO support_agents (
      id, name, wechat_id, qr_path, active, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    cleanText(body.wechatId, 60),
    qrPath,
    body.active === false ? 0 : 1,
    sortOrder,
    timestamp,
    timestamp
  );
  return listSupportAgents(false).find((agent) => agent.id === id);
}

function updateSupportAgent(id, body) {
  const existing = db.prepare("SELECT * FROM support_agents WHERE id = ?").get(id);
  if (!existing) return null;
  const name = body.name != null ? cleanText(body.name, 30) : existing.name;
  if (!name) throw new ClientError("请填写客服名称");
  const qrPath = body.qrDataUrl
    ? saveSupportQr(body.qrDataUrl, existing.qr_path)
    : existing.qr_path;
  const active = body.active == null ? existing.active : (body.active ? 1 : 0);
  const sortOrder = body.sortOrder == null
    ? existing.sort_order
    : Math.round(clampNumber(body.sortOrder, 0, 999, "排序"));
  db.prepare(`
    UPDATE support_agents
    SET name = ?, wechat_id = ?, qr_path = ?, active = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name,
    body.wechatId != null ? cleanText(body.wechatId, 60) : existing.wechat_id,
    qrPath,
    active,
    sortOrder,
    nowIso(),
    id
  );
  return listSupportAgents(false).find((agent) => agent.id === id);
}

function saveSupportQr(dataUrl, oldPath) {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpeg|jpg|webp);base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) throw new ClientError("请上传 PNG、JPG 或 WebP 格式的客服二维码");
  const mime = match[1] === "jpg" ? "jpeg" : match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 3 * 1024 * 1024) throw new ClientError("二维码图片不能超过 3MB");
  const valid = (
    mime === "png" && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) || (
    mime === "jpeg" && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  ) || (
    mime === "webp"
    && buffer.subarray(0, 4).toString() === "RIFF"
    && buffer.subarray(8, 12).toString() === "WEBP"
  );
  if (!valid) throw new ClientError("二维码图片内容无效");
  // Store the image in the database so it survives container restarts and redeploys.
  return `data:image/${mime};base64,${buffer.toString("base64")}`;
}

async function exchangeWechatPhoneCode(code) {
  if (!process.env.WECHAT_APPID || !process.env.WECHAT_SECRET) {
    throw new ClientError("微信手机号功能尚未配置");
  }
  const accessToken = await getWechatAccessToken();
  const endpoint = new URL("https://api.weixin.qq.com/wxa/business/getuserphonenumber");
  endpoint.searchParams.set("access_token", accessToken);
  let result;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(10000)
    });
    result = await response.json();
  } catch {
    throw new ClientError("微信手机号服务暂时不可用，请稍后重试");
  }
  if (result.errcode || !result.phone_info) {
    throw new ClientError(result.errmsg || "微信手机号获取失败");
  }
  const phone = String(result.phone_info.purePhoneNumber || result.phone_info.phoneNumber || "").replace(/^\+?86/, "");
  if (!/^1[3-9]\d{9}$/.test(phone)) throw new ClientError("未获取到有效的微信手机号");
  return phone;
}

let wechatTokenCache = { token: "", expiresAt: 0 };

async function getWechatAccessToken() {
  if (wechatTokenCache.token && wechatTokenCache.expiresAt > Date.now() + 60_000) {
    return wechatTokenCache.token;
  }
  const endpoint = new URL("https://api.weixin.qq.com/cgi-bin/token");
  endpoint.searchParams.set("grant_type", "client_credential");
  endpoint.searchParams.set("appid", process.env.WECHAT_APPID);
  endpoint.searchParams.set("secret", process.env.WECHAT_SECRET);
  let result;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
    result = await response.json();
  } catch {
    throw new ClientError("微信服务暂时不可用，请稍后重试");
  }
  if (!result.access_token) throw new ClientError(result.errmsg || "微信 access_token 获取失败");
  wechatTokenCache = {
    token: result.access_token,
    expiresAt: Date.now() + Math.max(60, Number(result.expires_in || 7200) - 300) * 1000
  };
  return wechatTokenCache.token;
}

function bindWechatPhone(openid, phone) {
  const byOpenid = db.prepare(`
    SELECT id, name, phone, address, phone_bound FROM members WHERE wechat_openid = ?
  `).get(openid);
  const byPhone = db.prepare(`
    SELECT id, wechat_openid FROM members WHERE phone = ?
  `).get(phone);
  if (byOpenid && byPhone && byOpenid.id !== byPhone.id) {
    throw new ClientError("该微信或手机号已绑定其他会员");
  }
  if (byPhone?.wechat_openid && byPhone.wechat_openid !== openid) {
    throw new ClientError("该手机号已绑定其他微信账号");
  }
  const timestamp = nowIso();
  if (byOpenid) {
    db.prepare(`
      UPDATE members SET phone = ?, phone_bound = 1, updated_at = ? WHERE id = ?
    `).run(phone, timestamp, byOpenid.id);
    return {
      id: byOpenid.id,
      name: byOpenid.name,
      phone,
      address: byOpenid.address || "",
      phoneBound: true
    };
  }
  if (byPhone) {
    db.prepare(`
      UPDATE members
      SET wechat_openid = ?, phone_bound = 1, updated_at = ?
      WHERE id = ?
    `).run(openid, timestamp, byPhone.id);
    const member = db.prepare("SELECT id, name, phone, address FROM members WHERE id = ?").get(byPhone.id);
    return { ...member, phoneBound: true };
  }
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO members (
      id, name, phone, address, wechat_openid, phone_bound, source_scene, created_at, updated_at
    ) VALUES (?, ?, ?, '', ?, 1, '', ?, ?)
  `).run(id, "微信用户", phone, openid, timestamp, timestamp);
  return { id, name: "微信用户", phone, address: "", phoneBound: true };
}

function createLead(body) {
  const memberInput = body.member || {};
  const profile = body.profile || {};
  const name = cleanText(memberInput.name, 30);
  const phone = String(memberInput.phone || "").trim();
  const address = cleanText(memberInput.address, 120);
  if (!name) throw new ClientError("请填写姓名");
  if (!/^1[3-9]\d{9}$/.test(phone)) throw new ClientError("请填写正确的手机号");

  const leadId = crypto.randomUUID();
  const timestamp = nowIso();
  const sourceScene = cleanText(body.sourceScene, 120);

  const hasWechatConfig = Boolean(process.env.WECHAT_APPID && process.env.WECHAT_SECRET);
  const memberToken = cleanText(body.memberToken, 4096);
  if (hasWechatConfig && !memberToken) {
    throw new ClientError("请先完成微信登录");
  }
  const openid = memberToken ? verifyMemberToken(memberToken) : "";
  const couponId = cleanText(body.couponId, 80);
  if (couponId && !openid) throw new ClientError("请先完成微信登录后使用优惠券");
  const coupon = couponId ? usableCoupon(couponId, openid) : null;
  let quote = calculateQuote(profile);
  if (coupon) quote = applyCoupon(quote, coupon);
  const existingByOpenid = openid
    ? db.prepare("SELECT id, phone, phone_bound FROM members WHERE wechat_openid = ?").get(openid)
    : null;
  const existingByPhone = db.prepare("SELECT id, wechat_openid FROM members WHERE phone = ?").get(phone);

  if (existingByOpenid && existingByPhone && existingByOpenid.id !== existingByPhone.id) {
    throw new ClientError("该手机号已绑定其他微信账号");
  }
  if (openid && existingByPhone?.wechat_openid && existingByPhone.wechat_openid !== openid) {
    throw new ClientError("该手机号已绑定其他微信账号");
  }
  if (existingByOpenid?.phone_bound && existingByOpenid.phone !== phone) {
    throw new ClientError("该微信已绑定其他手机号，请使用微信授权手机号");
  }

  const existingMember = existingByOpenid || existingByPhone;
  let member;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (existingMember) {
      db.prepare(`
        UPDATE members
        SET name = ?,
            phone = ?,
            address = CASE WHEN ? <> '' THEN ? ELSE address END,
            source_scene = CASE WHEN ? <> '' THEN ? ELSE source_scene END,
            wechat_openid = CASE WHEN ? <> '' THEN ? ELSE wechat_openid END,
            updated_at = ?
        WHERE id = ?
      `).run(
        name,
        phone,
        address,
        address,
        sourceScene,
        sourceScene,
        openid,
        openid,
        timestamp,
        existingMember.id
      );
      member = { id: existingMember.id };
    } else {
      const memberId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO members (
          id, name, phone, address, wechat_openid, source_scene, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        memberId,
        name,
        phone,
        address,
        openid,
        sourceScene,
        timestamp,
        timestamp
      );
      member = { id: memberId };
    }

    db.prepare(`
      INSERT INTO leads (
        id, member_id, area, layout, rooms, service_keys_json, needs_text,
        preferred_date, urgency, quote_exact, quote_low, quote_high, quote_json,
        status, admin_note, follow_up_at, source_scene, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '', '', ?, ?, ?)
    `).run(
      leadId,
      member.id,
      quote.area,
      cleanText(profile.layout, 40) || "未填写",
      quote.rooms,
      JSON.stringify(quote.services.map((item) => item.key)),
      cleanText(profile.needs, 1000),
      cleanText(profile.preferredDate, 30),
      quote.urgency.key,
      quote.exact,
      quote.low,
      quote.high,
      JSON.stringify(quote),
      sourceScene,
      timestamp,
      timestamp
    );

    if (coupon) {
      const updated = db.prepare(`
        UPDATE coupons
        SET status = 'used', used_at = ?, used_lead_id = ?, member_id = ?
        WHERE id = ? AND status = 'available' AND member_openid = ?
      `).run(timestamp, leadId, member.id, coupon.id, openid);
      if (updated.changes !== 1) throw new ClientError("优惠券已被使用或已失效");
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback failures after a failed transaction.
    }
    throw error;
  }

  return {
    leadId,
    memberId: member.id,
    quote,
    status: "new"
  };
}

function listLeads(searchParams) {
  const status = String(searchParams.get("status") || "");
  const query = String(searchParams.get("q") || "").trim();
  const deleted = searchParams.get("deleted") === "1";
  const where = [deleted ? "l.deleted_at <> ''" : "l.deleted_at = ''"];
  const params = [];
  if (status && status !== "all") {
    where.push("l.status = ?");
    params.push(status);
  }
  if (query) {
    where.push("(m.name LIKE ? OR m.phone LIKE ? OR m.address LIKE ?)");
    const like = `%${query}%`;
    params.push(like, like, like);
  }
  const rows = db.prepare(`
    SELECT l.id, l.area, l.layout, l.rooms, l.service_keys_json, l.quote_json, l.needs_text,
           l.preferred_date, l.urgency, l.deleted_at,
           l.quote_exact, l.quote_low, l.quote_high, l.status, l.admin_note,
           l.follow_up_at, l.created_at, l.updated_at,
           m.id AS member_id, m.name, m.phone, m.address, m.wechat_openid
    FROM leads l JOIN members m ON m.id = l.member_id
    WHERE ${where.join(" AND ")}
    ORDER BY l.created_at DESC
    LIMIT 300
  `).all(...params);
  const summaries = new Map();
  return rows.map((row) => {
    const lead = mapLeadRow(row);
    const cacheKey = row.wechat_openid || "";
    if (!summaries.has(cacheKey)) {
      const coupons = row.wechat_openid
        ? memberCoupons(row.wechat_openid).filter((item) => item.status === "available")
        : [];
      summaries.set(cacheKey, {
        couponCount: coupons.length,
        couponText: coupons.map(couponValueText).join("、")
      });
    }
    return { ...lead, ...summaries.get(cacheKey) };
  });
}

function getLead(id) {
  const row = db.prepare(`
    SELECT l.*, m.id AS member_id, m.name, m.phone, m.address,
           m.wechat_openid, m.phone_bound, m.source_scene AS member_source
    FROM leads l JOIN members m ON m.id = l.member_id
    WHERE l.id = ?
  `).get(id);
  if (!row) return null;
  const followups = db.prepare(`
    SELECT id, note, next_follow_up_at, created_at
    FROM followups WHERE lead_id = ? ORDER BY created_at DESC
  `).all(id);
  const payments = db.prepare(`
    SELECT id, payment_type, amount, status, note, paid_at,
           refunded_at, refund_note, created_at
    FROM payments WHERE lead_id = ? ORDER BY created_at DESC
  `).all(id);
  return {
    lead: mapLeadRow(row),
    quote: {
      ...JSON.parse(row.quote_json),
      needsText: row.needs_text || "",
      preferredDate: row.preferred_date || ""
    },
    followups,
    payments,
    coupons: row.wechat_openid ? memberCoupons(row.wechat_openid) : []
  };
}

function updateLead(id, body) {
  const existing = db.prepare("SELECT id FROM leads WHERE id = ?").get(id);
  if (!existing) return null;
  const allowedStatuses = new Set(["new", "contacted", "quoted", "visiting", "won", "lost"]);
  const status = allowedStatuses.has(body.status) ? body.status : "new";
  const adminNote = cleanText(body.adminNote, 2000);
  const followUpAt = cleanText(body.followUpAt, 40);
  const followupNote = cleanText(body.followupNote, 1000);
  const timestamp = nowIso();

  db.prepare(`
    UPDATE leads
    SET status = ?, admin_note = ?, follow_up_at = ?, updated_at = ?
    WHERE id = ?
  `).run(status, adminNote, followUpAt, timestamp, id);

  if (followupNote) {
    db.prepare(`
      INSERT INTO followups (id, lead_id, note, next_follow_up_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), id, followupNote, followUpAt, timestamp);
  }
  return getLead(id);
}

function createPayment(leadId, body) {
  const lead = db.prepare("SELECT id FROM leads WHERE id = ? AND deleted_at = ''").get(leadId);
  if (!lead) throw new ClientError("客户线索不存在或已在回收箱");
  const paymentType = body.paymentType === "full" ? "full" : "deposit";
  const amount = Math.round(clampNumber(body.amount, 1, 1000000, "收款金额"));
  const note = cleanText(body.note, 500);
  const timestamp = nowIso();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO payments (
      id, lead_id, payment_type, amount, status, note,
      paid_at, refunded_at, refund_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'paid', ?, ?, '', '', ?, ?)
  `).run(id, leadId, paymentType, amount, note, timestamp, timestamp, timestamp);
  return paymentView(
    db.prepare("SELECT * FROM payments WHERE id = ?").get(id)
  );
}

function refundPayment(id, body) {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ? AND status = 'paid'").get(id);
  if (!payment) return null;
  const timestamp = nowIso();
  db.prepare(`
    UPDATE payments
    SET status = 'refunded', refunded_at = ?, refund_note = ?, updated_at = ?
    WHERE id = ?
  `).run(timestamp, cleanText(body.note || "后台退费", 500), timestamp, id);
  return paymentView(
    db.prepare("SELECT * FROM payments WHERE id = ?").get(id)
  );
}

function listPaidCustomers(searchParams) {
  const type = ["deposit", "full"].includes(searchParams.get("type"))
    ? searchParams.get("type")
    : "all";
  const query = cleanText(searchParams.get("q"), 50);
  const rows = db.prepare(`
    SELECT p.*, l.quote_exact, l.status AS lead_status, l.area, l.layout,
           m.name, m.phone
    FROM payments p
    JOIN leads l ON l.id = p.lead_id
    JOIN members m ON m.id = l.member_id
    WHERE p.status = 'paid' AND l.deleted_at = ''
      AND (? = 'all' OR p.payment_type = ?)
      AND (? = '' OR m.name LIKE ? OR m.phone LIKE ?)
    ORDER BY p.paid_at DESC
    LIMIT 500
  `).all(type, type, query, `%${query}%`, `%${query}%`);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.lead_id)) {
      grouped.set(row.lead_id, {
        leadId: row.lead_id,
        name: row.name,
        phone: row.phone,
        area: row.area,
        layout: row.layout,
        leadStatus: row.lead_status,
        quoteExact: row.quote_exact,
        totalPaid: 0,
        payments: []
      });
    }
    const customer = grouped.get(row.lead_id);
    customer.totalPaid += row.amount;
    customer.payments.push(paymentView(row));
  }
  return [...grouped.values()];
}

function paymentView(row) {
  return {
    id: row.id,
    leadId: row.lead_id,
    paymentType: row.payment_type,
    amount: row.amount,
    status: row.status,
    note: row.note || "",
    paidAt: row.paid_at,
    refundedAt: row.refunded_at || "",
    refundNote: row.refund_note || ""
  };
}

function softDeleteLead(id) {
  const existing = db.prepare("SELECT id FROM leads WHERE id = ? AND deleted_at = ''").get(id);
  if (!existing) return null;
  const timestamp = nowIso();
  db.prepare("UPDATE leads SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .run(timestamp, timestamp, id);
  return getLead(id);
}

function restoreLead(id) {
  const existing = db.prepare("SELECT id FROM leads WHERE id = ? AND deleted_at <> ''").get(id);
  if (!existing) return null;
  const timestamp = nowIso();
  db.prepare("UPDATE leads SET deleted_at = '', updated_at = ? WHERE id = ?")
    .run(timestamp, id);
  return getLead(id);
}

function unbindMember(id, scope) {
  const member = db.prepare(`
    SELECT id, name, phone, address, wechat_openid, phone_bound
    FROM members WHERE id = ?
  `).get(id);
  if (!member) return null;
  if (!["wechat", "phone"].includes(scope)) {
    throw new ClientError("请选择解绑微信或解绑手机号");
  }
  const timestamp = nowIso();
  if (scope === "wechat") {
    if (member.wechat_openid) {
      const revoked = db.prepare(
        "SELECT openid FROM member_token_revocations WHERE openid = ?"
      ).get(member.wechat_openid);
      if (revoked) {
        db.prepare(
          "UPDATE member_token_revocations SET revoked_at = ? WHERE openid = ?"
        ).run(timestamp, member.wechat_openid);
      } else {
        db.prepare(
          "INSERT INTO member_token_revocations (openid, revoked_at) VALUES (?, ?)"
        ).run(member.wechat_openid, timestamp);
      }
    }
    db.prepare(`
      UPDATE members
      SET wechat_openid = '', phone_bound = 0, updated_at = ?
      WHERE id = ?
    `).run(timestamp, id);
  } else {
    db.prepare(`
      UPDATE members
      SET phone_bound = 0, updated_at = ?
      WHERE id = ?
    `).run(timestamp, id);
  }
  return {
    id,
    name: member.name,
    phone: member.phone,
    phoneBound: false,
    wechatBound: scope === "phone" ? Boolean(member.wechat_openid) : false
  };
}

function getOverview() {
  const rows = db.prepare("SELECT status, COUNT(*) AS count FROM leads WHERE deleted_at = '' GROUP BY status").all();
  const counts = Object.fromEntries(rows.map((row) => [row.status, row.count]));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = db.prepare("SELECT COUNT(*) AS count FROM leads WHERE created_at >= ? AND deleted_at = ''").get(start.toISOString()).count;
  const pending = (counts.new || 0) + (counts.contacted || 0) + (counts.quoted || 0) + (counts.visiting || 0);
  return {
    total,
    today,
    pending,
    won: counts.won || 0,
    counts
  };
}

function mapLeadRow(row) {
  let quote = {};
  try {
    quote = JSON.parse(row.quote_json || "{}");
  } catch {
    quote = {};
  }
  return {
    id: row.id,
    memberId: row.member_id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    area: row.area,
    layout: row.layout,
    rooms: row.rooms,
    serviceKeys: JSON.parse(row.service_keys_json || "[]"),
    serviceLabels: Array.isArray(quote.services)
      ? quote.services.map((item) => item.label).join("、")
      : "",
    needsText: row.needs_text || "",
    preferredDate: row.preferred_date || "",
    urgency: row.urgency,
    quoteExact: row.quote_exact,
    quoteLow: row.quote_low,
    quoteHigh: row.quote_high,
    discount: quote.discount || 0,
    couponName: quote.coupon?.name || "",
    wechatBound: Boolean(row.wechat_openid),
    phoneBound: Boolean(row.phone_bound),
    status: row.status,
    adminNote: row.admin_note || "",
    followUpAt: row.follow_up_at || "",
    deletedAt: row.deleted_at || "",
    sourceScene: row.source_scene || row.member_source || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function customerLead(row) {
  let quote = {};
  try {
    quote = JSON.parse(row.quote_json || "{}");
  } catch {
    quote = {};
  }
  return {
    id: row.id,
    area: row.area,
    layout: row.layout,
    rooms: row.rooms,
    preferredDate: row.preferred_date || "",
    urgency: row.urgency,
    quoteExact: row.quote_exact,
    quoteLow: row.quote_low,
    quoteHigh: row.quote_high,
    discount: quote.discount || 0,
    couponName: quote.coupon?.name || "",
    serviceLabels: Array.isArray(quote.services)
      ? quote.services.map((item) => item.label).join("、")
      : "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function broadcast(type, payload) {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) client.write(message);
}

function requireAdmin(req, res) {
  const token = getCookie(req, "admin_session");
  const expiresAt = token ? sessions.get(token) : null;
  if (token && expiresAt && expiresAt > Date.now()) return true;
  if (token) sessions.delete(token);
  sendJson(res, 401, { error: "请先登录" });
  return false;
}

function getCookie(req, key) {
  const cookies = String(req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.trim().split("=");
    if (name === key) return rest.join("=");
  }
  return "";
}

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

async function exchangeWechatCode(code) {
  const endpoint = new URL("https://api.weixin.qq.com/sns/jscode2session");
  endpoint.searchParams.set("appid", process.env.WECHAT_APPID);
  endpoint.searchParams.set("secret", process.env.WECHAT_SECRET);
  endpoint.searchParams.set("js_code", code);
  endpoint.searchParams.set("grant_type", "authorization_code");
  let data;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
    data = await response.json();
  } catch {
    throw new ClientError("微信登录服务暂时不可用，请稍后重试");
  }
  if (data.errcode || !data.openid) {
    throw new ClientError(data.errmsg || "微信登录失败，请重新登录");
  }
  return data.openid;
}

function signMemberToken(openid) {
  const payload = Buffer.from(JSON.stringify({
    openid,
    iat: Date.now(),
    exp: Date.now() + MEMBER_TOKEN_TTL_MS
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyMemberToken(token) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new ClientError("登录状态无效，请重新微信登录");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) throw new ClientError("登录状态无效，请重新微信登录");
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new ClientError("登录状态无效，请重新微信登录");
  }
  if (!data.openid || !Number.isFinite(data.iat) || !Number.isFinite(data.exp) || data.exp < Date.now()) {
    throw new ClientError("微信登录已过期，请重新登录");
  }
  const revoked = db.prepare(`
    SELECT revoked_at FROM member_token_revocations WHERE openid = ?
  `).get(data.openid);
  if (revoked && data.iat < new Date(revoked.revoked_at).getTime()) {
    throw new ClientError("微信登录已解绑，请重新登录");
  }
  return data.openid;
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function allowPublicRequest(req, maxPerMinute = 30) {
  const ip = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= maxPerMinute) return false;
  entry.count += 1;
  return true;
}

async function readJson(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new ClientError("请求数据过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ClientError("JSON 格式错误");
  }
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...corsHeaders(),
    ...extraHeaders
  });
  res.end(body);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,OPTIONS"
  };
}

function serveFile(filePath, res) {
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  }[path.extname(filePath)] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": content.length,
    "Cache-Control": contentType.startsWith("text/") ? "no-cache" : "public, max-age=3600"
  });
  res.end(content);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function clampNumber(value, min, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ClientError(`${label}格式错误`);
  if (number < min || number > max) throw new ClientError(`${label}应在 ${min}-${max} 范围内`);
  return number;
}

function roundMoney(value) {
  return Math.round(value);
}

class ClientError extends Error {}

process.on("uncaughtException", (error) => {
  console.error("uncaughtException", error);
});

process.on("unhandledRejection", (error) => {
  console.error("unhandledRejection", error);
});

process.on("SIGTERM", () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
