import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fingerprintFile } from "../src/util/fingerprint.js";
import { isFileStable } from "../src/util/fileStability.js";
import { isPathWithinRoots } from "../src/util/pathGuard.js";

function createTempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-copier-"));
  const filePath = path.join(dir, "sample.txt");
  fs.writeFileSync(filePath, content);
  return { dir, filePath };
}

describe("util", () => {
  it("creates fingerprint", async () => {
    const { filePath } = createTempFile("hello");
    const result = await fingerprintFile(filePath);
    expect(result.size).toBe(5);
    expect(result.fingerprint).toMatch(/^5-/);
  });

  it("detects stable files", async () => {
    const { filePath } = createTempFile("stable");
    const stable = await isFileStable(filePath, 0, () => Promise.resolve());
    expect(stable).toBe(true);
  });

  it("uses default wait", async () => {
    const { filePath } = createTempFile("stable");
    const stable = await isFileStable(filePath, 0);
    expect(stable).toBe(true);
  });

  it("detects unstable files", async () => {
    const { filePath } = createTempFile("a");
    const unstable = await isFileStable(filePath, 0.001, async () => {
      fs.appendFileSync(filePath, "b");
    });
    expect(unstable).toBe(false);
  });

  it("checks roots", () => {
    expect(isPathWithinRoots("/mnt/src/file.txt", ["/mnt/src"]))
      .toBe(true);
    expect(isPathWithinRoots("/mnt/src", ["/mnt/src"]))
      .toBe(true);
    expect(isPathWithinRoots("/mnt/other/file.txt", ["/mnt/src"]))
      .toBe(false);
  });
});
