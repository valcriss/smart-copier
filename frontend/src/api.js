export async function fetchConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error("Failed to load config");
  }
  return response.json();
}

export async function updateConfig(payload) {
  const response = await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error ?? "Failed to update config");
  }
  return response.json();
}

export async function fetchHistory() {
  const response = await fetch("/api/history");
  if (!response.ok) {
    throw new Error("Failed to load history");
  }
  return response.json();
}

export async function startService() {
  const response = await fetch("/api/start", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to start service");
  }
  return response.json();
}

export async function stopService() {
  const response = await fetch("/api/stop", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to stop service");
  }
  return response.json();
}

export async function rescanService() {
  const response = await fetch("/api/rescan", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to rescan");
  }
  return response.json();
}