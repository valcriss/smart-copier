export class EnvironmentConfiguration {
  constructor(env = process.env) {
    this.env = env;
  }

  getPort() {
    return this.#readNumber("PORT", 3000, { min: 1 });
  }

  getDbPath() {
    return this.env.DB_PATH || "/data/smart-copier.db";
  }

  getStabilityWindowSeconds() {
    return this.#readNumber("FILE_STABILITY_WINDOW_SECONDS", 10, { min: 1 });
  }

  getAllowedSourceRoots() {
    return this.#readList("ALLOWED_SOURCE_ROOTS", ["/sources"]);
  }

  getAllowedDestinationRoots() {
    return this.#readList("ALLOWED_DEST_ROOTS", ["/destinations"]);
  }

  getIgnoredExtensionsOverride() {
    return this.#readOptionalList("IGNORED_EXTENSIONS");
  }

  getScanIntervalSecondsOverride() {
    return this.#readOptionalNumber("SCAN_INTERVAL_SECONDS", { min: 1 });
  }

  getDryRunOverride() {
    return this.#readOptionalBoolean("DRY_RUN");
  }

  resolveConfig(storedConfig) {
    const defaults = {
      associations: [],
      ignoredExtensions: [".part", ".crdownload", ".tmp", ".!qB"],
      scanIntervalSeconds: 60,
      dryRun: false
    };

    const resolved = {
      associations: storedConfig?.associations ?? defaults.associations,
      ignoredExtensions:
        this.getIgnoredExtensionsOverride() ??
        storedConfig?.ignoredExtensions ??
        defaults.ignoredExtensions,
      scanIntervalSeconds:
        this.getScanIntervalSecondsOverride() ??
        storedConfig?.scanIntervalSeconds ??
        defaults.scanIntervalSeconds,
      dryRun:
        this.getDryRunOverride() ??
        storedConfig?.dryRun ??
        defaults.dryRun
    };

    return resolved;
  }

  #readOptionalList(key) {
    if (!(key in this.env)) {
      return undefined;
    }
    return this.#readList(key, []);
  }

  #readList(key, fallback) {
    const raw = this.env[key];
    if (!raw) {
      return fallback;
    }
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  #readOptionalNumber(key, { min }) {
    if (!(key in this.env)) {
      return undefined;
    }
    return this.#readNumber(key, undefined, { min });
  }

  #readNumber(key, fallback, { min }) {
    const raw = this.env[key];
    if (!raw) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || (min !== undefined && value < min)) {
      throw new Error(`Invalid numeric value for ${key}`);
    }
    return value;
  }

  #readOptionalBoolean(key) {
    if (!(key in this.env)) {
      return undefined;
    }
    return this.#readBoolean(key, false);
  }

  #readBoolean(key, fallback) {
    const raw = this.env[key];
    if (!raw) {
      return fallback;
    }
    const normalized = raw.toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
    throw new Error(`Invalid boolean value for ${key}`);
  }
}
