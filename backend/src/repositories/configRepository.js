const CONFIG_KEY = "config";

export class ConfigRepository {
  constructor(db) {
    this.db = db;
  }

  async getConfig() {
    const row = await this.db.get("SELECT value FROM config WHERE key = ?", [CONFIG_KEY]);
    if (!row) {
      return null;
    }
    return JSON.parse(row.value);
  }

  async setConfig(config) {
    const value = JSON.stringify(config);
    await this.db.run(
      "INSERT INTO config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [CONFIG_KEY, value]
    );
  }
}