import fs from "fs";

export async function isFileStable(filePath, windowSeconds, waitFn = defaultWait) {
  const first = await fs.promises.stat(filePath);
  await waitFn(windowSeconds * 1000);
  const second = await fs.promises.stat(filePath);
  return first.size === second.size && first.mtimeMs === second.mtimeMs;
}

function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}