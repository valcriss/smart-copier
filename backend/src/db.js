import sqlite3 from "sqlite3";

export function createDatabase(dbPath) {
  const database = new sqlite3.Database(dbPath);

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      database.run(sql, params, function onRun(error) {
        if (error) {
          reject(error);
          return;
        }
        resolve(this);
      });
    });

  const get = (sql, params = []) =>
    new Promise((resolve, reject) => {
      database.get(sql, params, (error, row) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(row);
      });
    });

  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      database.all(sql, params, (error, rows) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(rows);
      });
    });

  return { database, run, get, all };
}

export async function initDatabase(db) {
  await db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL,
      filename TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_root TEXT NOT NULL,
      destination_path TEXT,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      copied_at TEXT,
      error_message TEXT,
      UNIQUE(fingerprint, source_root)
    )
  `);

  const columns = await db.all("PRAGMA table_info(files)");
  const hasSourceRoot = columns.some((column) => column.name === "source_root");
  if (columns.length > 0 && !hasSourceRoot) {
    await db.run("ALTER TABLE files RENAME TO files_old");
    await db.run(`
      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL,
        filename TEXT NOT NULL,
        source_path TEXT NOT NULL,
        source_root TEXT NOT NULL,
        destination_path TEXT,
        size INTEGER NOT NULL,
        status TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        copied_at TEXT,
        error_message TEXT,
        UNIQUE(fingerprint, source_root)
      )
    `);
    await db.run(`
      INSERT INTO files (
        fingerprint,
        filename,
        source_path,
        source_root,
        destination_path,
        size,
        status,
        first_seen_at,
        copied_at,
        error_message
      )
      SELECT
        fingerprint,
        filename,
        source_path,
        source_path,
        destination_path,
        size,
        status,
        first_seen_at,
        copied_at,
        error_message
      FROM files_old
    `);
    await db.run("DROP TABLE files_old");
  }

  await db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}
