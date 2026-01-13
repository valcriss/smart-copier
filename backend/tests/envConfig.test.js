import { describe, expect, it } from "vitest";
import { EnvironmentConfiguration } from "../src/config/EnvironmentConfiguration.js";

describe("EnvironmentConfiguration", () => {
  it("returns defaults", () => {
    const env = {};
    const config = new EnvironmentConfiguration(env);

    expect(config.getPort()).toBe(3000);
    expect(config.getDbPath()).toBe("/data/smart-copier.db");
    expect(config.getStabilityWindowSeconds()).toBe(10);
    expect(config.getAllowedSourceRoots()).toEqual(["/sources"]);
    expect(config.getAllowedDestinationRoots()).toEqual(["/destinations"]);
    expect(config.getIgnoredExtensionsOverride()).toBeUndefined();
    expect(config.getScanIntervalSecondsOverride()).toBeUndefined();
    expect(config.getDryRunOverride()).toBeUndefined();
  });

  it("reads overrides", () => {
    const env = {
      PORT: "8080",
      DB_PATH: "/tmp/db.sqlite",
      FILE_STABILITY_WINDOW_SECONDS: "5",
      ALLOWED_SOURCE_ROOTS: "/mnt/a,/mnt/b",
      ALLOWED_DEST_ROOTS: "/mnt/out",
      IGNORED_EXTENSIONS: ".one,.two",
      SCAN_INTERVAL_SECONDS: "25",
      DRY_RUN: "true"
    };
    const config = new EnvironmentConfiguration(env);

    expect(config.getPort()).toBe(8080);
    expect(config.getDbPath()).toBe("/tmp/db.sqlite");
    expect(config.getStabilityWindowSeconds()).toBe(5);
    expect(config.getAllowedSourceRoots()).toEqual(["/mnt/a", "/mnt/b"]);
    expect(config.getAllowedDestinationRoots()).toEqual(["/mnt/out"]);
    expect(config.getIgnoredExtensionsOverride()).toEqual([".one", ".two"]);
    expect(config.getScanIntervalSecondsOverride()).toBe(25);
    expect(config.getDryRunOverride()).toBe(true);
  });

  it("parses false boolean", () => {
    const env = { DRY_RUN: "false" };
    const config = new EnvironmentConfiguration(env);
    expect(config.getDryRunOverride()).toBe(false);
  });

  it("handles empty overrides", () => {
    const env = {
      IGNORED_EXTENSIONS: "",
      DRY_RUN: "",
      SCAN_INTERVAL_SECONDS: ""
    };
    const config = new EnvironmentConfiguration(env);
    expect(config.getIgnoredExtensionsOverride()).toEqual([]);
    expect(config.getDryRunOverride()).toBe(false);
    expect(config.getScanIntervalSecondsOverride()).toBeUndefined();
  });

  it("trims list values", () => {
    const env = { ALLOWED_SOURCE_ROOTS: " /sources/a, , /sources/b " };
    const config = new EnvironmentConfiguration(env);
    expect(config.getAllowedSourceRoots()).toEqual(["/sources/a", "/sources/b"]);
  });

  it("resolves config with priority", () => {
    const env = { SCAN_INTERVAL_SECONDS: "30" };
    const config = new EnvironmentConfiguration(env);
    const resolved = config.resolveConfig({
      associations: [{ id: "a", input: "/sources/a", output: "/destinations/b" }],
      ignoredExtensions: [".tmp"],
      scanIntervalSeconds: 10,
      dryRun: true
    });

    expect(resolved.scanIntervalSeconds).toBe(30);
    expect(resolved.ignoredExtensions).toEqual([".tmp"]);
    expect(resolved.dryRun).toBe(true);
  });

  it("uses defaults when config missing", () => {
    const config = new EnvironmentConfiguration({});
    const resolved = config.resolveConfig(null);
    expect(resolved.dryRun).toBe(false);
    expect(resolved.scanIntervalSeconds).toBe(60);
  });

  it("keeps zero values from stored config", () => {
    const config = new EnvironmentConfiguration({});
    const resolved = config.resolveConfig({
      associations: [],
      ignoredExtensions: [],
      scanIntervalSeconds: 0,
      dryRun: false
    });
    expect(resolved.scanIntervalSeconds).toBe(0);
  });

  it("throws on invalid values", () => {
    const env = { FILE_STABILITY_WINDOW_SECONDS: "-1" };
    const config = new EnvironmentConfiguration(env);
    expect(() => config.getStabilityWindowSeconds()).toThrow("Invalid numeric value");

    const envBool = { DRY_RUN: "maybe" };
    const configBool = new EnvironmentConfiguration(envBool);
    expect(() => configBool.getDryRunOverride()).toThrow("Invalid boolean value");
  });
});
