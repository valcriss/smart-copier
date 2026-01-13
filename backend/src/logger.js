export function createLogger(scope = "app") {
  const log = (level, message, extra) => {
    const entry = {
      time: new Date().toISOString(),
      level,
      scope,
      message
    };
    if (extra) {
      entry.extra = extra;
    }
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  };
  return {
    info: (message, extra) => log("info", message, extra),
    error: (message, extra) => log("error", message, extra)
  };
}