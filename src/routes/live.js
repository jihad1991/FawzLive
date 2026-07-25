// WebSocket endpoint for the live draw screen + live participant counter.
import { addClient, clientCount } from '../services/hub.js';

export default async function liveRoutes(app) {
  app.get('/ws', { websocket: true }, (socket /* , request */) => {
    addClient(socket);
    socket.send(JSON.stringify({ type: 'hello', clients: clientCount() }));

    socket.on('message', (raw) => {
      // Clients are display-only; ping/pong keepalive is the only inbound message.
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
      } catch { /* ignore */ }
    });
  });
}
