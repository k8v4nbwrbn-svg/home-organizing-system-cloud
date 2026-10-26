import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const TABLE_ORDER = [
  "pricing",
  "members",
  "leads",
  "followups",
  "coupon_campaigns",
  "coupons",
  "support_agents",
  "member_token_revocations",
  "payments"
];

export function initializeMysqlSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      \`key\` VARCHAR(80) PRIMARY KEY,
      value TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS pricing (
      id INT PRIMARY KEY,
      config_json LONGTEXT NOT NULL,
      updated_at VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS members (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(20) NOT NULL UNIQUE,
      address TEXT,
      wechat_openid VARCHAR(191) DEFAULT '',
      phone_bound TINYINT NOT NULL DEFAULT 0,
      source_scene TEXT,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      KEY idx_members_wechat_openid (wechat_openid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS leads (
      id VARCHAR(64) PRIMARY KEY,
      member_id VARCHAR(64) NOT NULL,
      area DOUBLE NOT NULL,
      layout VARCHAR(100) NOT NULL,
      rooms INT NOT NULL,
      service_keys_json LONGTEXT NOT NULL,
      needs_text LONGTEXT,
      preferred_date VARCHAR(40) DEFAULT '',
      urgency VARCHAR(30) NOT NULL,
      quote_exact INT NOT NULL,
      quote_low INT NOT NULL,
      quote_high INT NOT NULL,
      quote_json LONGTEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'new',
      admin_note LONGTEXT,
      follow_up_at VARCHAR(40) DEFAULT '',
      source_scene TEXT,
      deleted_at VARCHAR(40) DEFAULT '',
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      KEY idx_leads_created_at (created_at),
      KEY idx_leads_status (status),
      KEY idx_leads_deleted_at (deleted_at),
      CONSTRAINT fk_leads_member FOREIGN KEY (member_id) REFERENCES members(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS followups (
      id VARCHAR(64) PRIMARY KEY,
      lead_id VARCHAR(64) NOT NULL,
      note LONGTEXT NOT NULL,
      next_follow_up_at VARCHAR(40) DEFAULT '',
      created_at VARCHAR(40) NOT NULL,
      KEY idx_followups_lead (lead_id),
      CONSTRAINT fk_followups_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS coupon_campaigns (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      claim_code VARCHAR(30) NOT NULL UNIQUE,
      discount_type VARCHAR(20) NOT NULL,
      discount_value INT NOT NULL,
      minimum_spend INT NOT NULL DEFAULT 0,
      total_quantity INT NOT NULL DEFAULT 0,
      per_member_limit INT NOT NULL DEFAULT 1,
      valid_from VARCHAR(10) DEFAULT '',
      valid_until VARCHAR(10) DEFAULT '',
      active TINYINT NOT NULL DEFAULT 1,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS coupons (
      id VARCHAR(64) PRIMARY KEY,
      campaign_id VARCHAR(64) NOT NULL,
      member_id VARCHAR(64) DEFAULT '',
      member_openid VARCHAR(191) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'available',
      claimed_at VARCHAR(40) NOT NULL,
      used_at VARCHAR(40) DEFAULT '',
      used_lead_id VARCHAR(64) DEFAULT '',
      KEY idx_coupons_openid (member_openid),
      KEY idx_coupons_campaign (campaign_id),
      CONSTRAINT fk_coupons_campaign FOREIGN KEY (campaign_id) REFERENCES coupon_campaigns(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS support_agents (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      wechat_id VARCHAR(100) DEFAULT '',
      qr_path LONGTEXT NOT NULL,
      active TINYINT NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS member_token_revocations (
      openid VARCHAR(191) PRIMARY KEY,
      revoked_at VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS payments (
      id VARCHAR(64) PRIMARY KEY,
      lead_id VARCHAR(64) NOT NULL,
      payment_type VARCHAR(20) NOT NULL,
      amount INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'paid',
      note TEXT,
      paid_at VARCHAR(40) NOT NULL,
      refunded_at VARCHAR(40) DEFAULT '',
      refund_note TEXT,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      KEY idx_payments_lead (lead_id),
      KEY idx_payments_status (status),
      CONSTRAINT fk_payments_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

export function seedMysqlFromSqlite(db, sqlitePath) {
  const seeded = db.prepare("SELECT value FROM app_meta WHERE `key` = ?").get("initial_seed");
  if (seeded || !fs.existsSync(sqlitePath)) return;

  const sqlite = new DatabaseSync(sqlitePath);
  try {
    db.exec("START TRANSACTION");
    for (const table of TABLE_ORDER) {
      if (!sqliteTableExists(sqlite, table)) continue;
      const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
      if (!columns.length) continue;
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      if (!rows.length) continue;
      const columnSql = columns.map((name) => `\`${name}\``).join(", ");
      const placeholders = columns.map(() => "?").join(", ");
      const statement = db.prepare(
        `INSERT IGNORE INTO \`${table}\` (${columnSql}) VALUES (${placeholders})`
      );
      for (const row of rows) {
        statement.run(...columns.map((name) => row[name] ?? null));
      }
    }
    db.prepare("INSERT INTO app_meta (`key`, value) VALUES (?, ?)")
      .run("initial_seed", new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original seed error.
    }
    throw error;
  } finally {
    sqlite.close();
  }
}

function sqliteTableExists(sqlite, table) {
  return Boolean(
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  );
}
