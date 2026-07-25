// Tiny in-memory pub/sub hub for live WebSocket broadcasts.
// (For multi-instance prod, back this with Redis pub/sub.)
const clients = new Set();
let presenceTimer = null;

export function addClient(socket) {
  clients.add(socket);
  schedulePresence();
  socket.on('close', () => { clients.delete(socket); schedulePresence(); });
}

// Debounced so thousands of joins/leaves collapse into one broadcast per window.
function schedulePresence() {
  if (presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    broadcast({ type: 'presence', clients: clients.size });
  }, 400);
}

export function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const socket of clients) {
    try {
      if (socket.readyState === 1) socket.send(payload);
    } catch {
      clients.delete(socket);
    }
  }
}

export function clientCount() {
  return clients.size;
}
