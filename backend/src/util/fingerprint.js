import crypto from "crypto";
import fs from "fs";

export async function fingerprintFile(filePath) {
  const stat = await fs.promises.stat(filePath);
  const hash = crypto.createHash("sha256");
  hash.update(`${filePath}:${stat.size}`);
  const digest = hash.digest("hex");
  const fingerprint = `${stat.size}-${digest}`;
  return { fingerprint, size: stat.size };
}
