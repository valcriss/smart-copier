import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sqlite3", () => {
  class FakeDatabase {
    constructor() {
      this.storage = { config: new Map(), files: [] };
    }

    run(sql, params, cb) {
      const callback = typeof params === "function" ? params : cb;
      const values = Array.isArray(params) ? params : [];
      if (sql.includes("INSERT INTO config")) {
        this.storage.config.set(values[0], values[1]);
      }
      if (sql.includes("INSERT INTO files")) {
        const record = {
          fingerprint: values[0],
          filename: values[1],
          source_path: values[2],
          destination_path: values[3],
          size: values[4],
          status: values[5],
          first_seen_at: values[6],
          copied_at: null,
          error_message: null
        };
        this.storage.files.push(record);
      }
      if (sql.startsWith("UPDATE files SET status = 'FAILED'")) {
        for (const file of this.storage.files) {
          if (file.status === "COPYING") {
            file.status = "FAILED";
            file.error_message = "Interrupted by restart";
          }
        }
      }
      if (sql.includes("UPDATE files") && sql.includes("WHERE fingerprint")) {
        const [status, copiedAt, destinationPath, errorMessage, fingerprint] = values;
        const file = this.storage.files.find((item) => item.fingerprint === fingerprint);
        if (file) {
          file.status = status;
          file.copied_at = copiedAt;
          file.destination_path = destinationPath;
          file.error_message = errorMessage;
        }
      }
      if (callback) {
        callback.call(this, null);
      }
    }

    get(sql, params, cb) {
      if (sql.includes("FROM config")) {
        const value = this.storage.config.get(params[0]);
        cb(null, value ? { value } : undefined);
        return;
      }
      if (sql.includes("FROM files")) {
        const item = this.storage.files.find((file) => file.fingerprint === params[0]);
        cb(null, item);
        return;
      }
      cb(null, undefined);
    }

    all(sql, params, cb) {
      if (sql.includes("FROM files")) {
        const limit = params[0] ?? this.storage.files.length;
        const ordered = [...this.storage.files].sort((a, b) =>
          b.first_seen_at.localeCompare(a.first_seen_at)
        );
        cb(null, ordered.slice(0, limit));
        return;
      }
      cb(null, []);
    }
  }

  return { default: { Database: FakeDatabase } };
});

import { createDatabase, initDatabase } from "../src/db.js";
import { ConfigRepository } from "../src/repositories/configRepository.js";
import { FileRepository } from "../src/repositories/fileRepository.js";

let db;
let configRepository;
let fileRepository;

beforeEach(async () => {
  db = createDatabase(":memory:");
  await initDatabase(db);
  configRepository = new ConfigRepository(db);
  fileRepository = new FileRepository(db);
});

describe("ConfigRepository", () => {
  it("stores and reads config", async () => {
    await configRepository.setConfig({ associations: [] });
    const config = await configRepository.getConfig();
    expect(config).toEqual({ associations: [] });
  });

  it("returns null when missing", async () => {
    const config = await configRepository.getConfig();
    expect(config).toBeNull();
  });
});

describe("FileRepository", () => {
  it("tracks file lifecycle", async () => {
    await fileRepository.insertPending({
      fingerprint: "fp-1",
      filename: "file.txt",
      sourcePath: "/mnt/src/file.txt",
      destinationPath: "/mnt/dst/file.txt",
      size: 10,
      status: "PENDING",
      firstSeenAt: "now"
    });

    const stored = await fileRepository.findByFingerprint("fp-1");
    expect(stored.status).toBe("PENDING");

    await fileRepository.markCopying("fp-1");
    const copying = await fileRepository.findByFingerprint("fp-1");
    expect(copying.status).toBe("COPYING");

    await fileRepository.markCopied("fp-1", "/mnt/dst/file.txt", "later");
    const copied = await fileRepository.findByFingerprint("fp-1");
    expect(copied.status).toBe("COPIED");
    expect(copied.destination_path).toBe("/mnt/dst/file.txt");

    await fileRepository.markFailed("fp-1", "boom");
    const failed = await fileRepository.findByFingerprint("fp-1");
    expect(failed.status).toBe("FAILED");
    expect(failed.error_message).toBe("boom");

    const history = await fileRepository.listHistory();
    expect(history.length).toBe(1);
  });

  it("fails in-progress on restart", async () => {
    await fileRepository.insertPending({
      fingerprint: "fp-2",
      filename: "file2.txt",
      sourcePath: "/mnt/src/file2.txt",
      destinationPath: "/mnt/dst/file2.txt",
      size: 5,
      status: "COPYING",
      firstSeenAt: "now"
    });

    await fileRepository.failInProgress();
    const failed = await fileRepository.findByFingerprint("fp-2");
    expect(failed.status).toBe("FAILED");
  });
});
