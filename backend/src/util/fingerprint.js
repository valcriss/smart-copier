import crypto from "crypto";
import fs from "fs";

export async function fingerprintFile(filePath) {
  const stat = await fs.promises.stat(filePath);
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  const digest = hash.digest("hex");
  const fingerprint = `${stat.size}-${digest}`;
  return { fingerprint, size: stat.size };
}