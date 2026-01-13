export function createSseBroadcaster() {
  const clients = new Set();

  const addClient = (res) => {
    clients.add(res);
    res.on("close", () => {
      clients.delete(res);
    });
  };

  const broadcast = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      client.write(payload);
    }
  };

  return { addClient, broadcast };
}