import { workerData } from "node:worker_threads";
import mysql from "mysql2/promise";

const { config, port, signalBuffer } = workerData;
const signal = new Int32Array(signalBuffer);

let connection;
try {
  const admin = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    charset: "utf8mb4"
  });
  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.database.replace(/`/g, "")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.end();

  connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: "utf8mb4",
    dateStrings: true,
    multipleStatements: true
  });
  await connection.query("SET time_zone = '+00:00'");
  port.postMessage({ type: "ready" });
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
} catch (error) {
  port.postMessage({ type: "startup-error", error: error.message });
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
}

port.on("message", async (message) => {
  try {
    if (!connection) throw new Error("MySQL connection is not ready");
    if (message.op === "exec") {
      await connection.query(message.sql);
      port.postMessage({ id: message.id, result: { changes: 0 } });
    } else {
      const [result] = await connection.query(message.sql, message.params || []);
      if (Array.isArray(result)) {
        port.postMessage({ id: message.id, result });
      } else {
        port.postMessage({
          id: message.id,
          result: {
            changes: result.affectedRows || 0,
            lastInsertRowid: result.insertId || 0
          }
        });
      }
    }
  } catch (error) {
    port.postMessage({
      id: message.id,
      error: error.sqlMessage || error.message || String(error)
    });
  } finally {
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
  }
});

port.start();
