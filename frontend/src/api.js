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
