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
      fingerprint TEXT UNIQUE,
      filename TEXT NOT NULL,
      source_path TEXT NOT NULL,
      destination_path TEXT,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      copied_at TEXT,
      error_message TEXT
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}