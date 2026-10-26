import {
  MessageChannel,
  Worker,
  receiveMessageOnPort
} from "node:worker_threads";

export class MysqlSyncDatabase {
  constructor(config) {
    this.signalBuffer = new SharedArrayBuffer(4);
    this.signal = new Int32Array(this.signalBuffer);
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.start();
    this.worker = new Worker(new URL("./mysql-worker.mjs", import.meta.url), {
      workerData: {
        config,
        port: channel.port2,
        signalBuffer: this.signalBuffer
      },
      transferList: [channel.port2]
    });
    this.nextId = 1;
    this.waitForReady();
  }

  prepare(sql) {
    return {
      get: (...params) => this.query("get", sql, params),
      all: (...params) => this.query("all", sql, params),
      run: (...params) => this.query("run", sql, params)
    };
  }

  exec(sql) {
    const normalized = String(sql)
      .replace(/\bBEGIN IMMEDIATE\b/gi, "START TRANSACTION");
    return this.query("exec", normalized, []);
  }

  close() {
    this.worker.terminate();
  }

  query(op, sql, params) {
    Atomics.store(this.signal, 0, 0);
    const id = this.nextId++;
    this.port.postMessage({ id, op, sql, params });
    while (true) {
      const packet = receiveMessageOnPort(this.port);
      if (packet) {
        const message = packet.message;
        if (message.id !== id) continue;
        if (message.error) throw new Error(message.error);
        if (op === "get") return message.result?.[0];
        return message.result;
      }
      const status = Atomics.wait(this.signal, 0, 0, 30000);
      if (status === "timed-out") throw new Error("MySQL query timed out");
    }
  }

  waitForReady() {
    while (true) {
      const packet = receiveMessageOnPort(this.port);
      if (packet) {
        if (packet.message.type === "startup-error") {
          throw new Error(packet.message.error);
        }
        if (packet.message.type === "ready") return;
      }
      const status = Atomics.wait(this.signal, 0, 0, 30000);
      if (status === "timed-out") throw new Error("MySQL connection timed out");
    }
  }
}
