import { describe, expect, it, vi } from "vitest";

vi.mock("sqlite3", () => {
  class FakeDatabase {
    constructor() {
      this.storage = { config: new Map(), files: [] };
      this.executed = [];
    }

    run(sql, params, cb) {
      const callback = typeof params === "function" ? params : cb;
      this.executed.push(sql);
      if (callback) {
        callback.call(this, null);
      }
    }

    get(sql, params, cb) {
      cb(null, undefined);
    }

    all(sql, params, cb) {
      cb(null, this.executed.map((statement) => ({ name: statement })));
    }
  }

  return { default: { Database: FakeDatabase } };
});

describe("database", () => {
  it("creates schema", async () => {
    const { createDatabase, initDatabase } = await import("../src/db.js");
    const db = createDatabase(":memory:");
    await initDatabase(db);
    expect(db.database.executed.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS files"))).toBe(true);
    expect(db.database.executed.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS config"))).toBe(true);
  });

  it("rejects on run/get/all errors", async () => {
    const { createDatabase } = await import("../src/db.js");
    const db = createDatabase(":memory:");

    db.database.run = (sql, params, cb) => {
      const callback = typeof params === "function" ? params : cb;
      callback(new Error("run failed"));
    };
    db.database.get = (sql, params, cb) => {
      cb(new Error("get failed"));
    };
    db.database.all = (sql, params, cb) => {
      cb(new Error("all failed"));
    };

    await expect(db.run("select 1")).rejects.toThrow("run failed");
    await expect(db.get("select 1")).rejects.toThrow("get failed");
    await expect(db.all("select 1")).rejects.toThrow("all failed");
  });
});
