import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import path from 'node:path';
import { config } from './config.js';
import { migrate } from './db.js';
import { ensureSeed } from './seed.js';

import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';
import drawRoutes from './routes/draw.js';
import liveRoutes from './routes/live.js';

migrate();
ensureSeed();

const app = Fastify({
  logger: { level: 'info', transport: undefined },
  trustProxy: true,
  bodyLimit: 256 * 1024,
});

await app.register(fastifyCookie, { secret: config.sessionSecret });
await app.register(fastifyWebsocket);

// API + WS routes
await app.register(publicRoutes);
await app.register(adminRoutes);
await app.register(drawRoutes);
await app.register(liveRoutes);

// Static frontend (served last so /api and /ws win).
await app.register(fastifyStatic, {
  root: path.join(config.root, 'public'),
  prefix: '/',
});

// Clean routes for the entry pages.
const page = (file) => (req, reply) => reply.sendFile(file);
app.get('/', page('index.html'));
app.get('/kiosk', page('kiosk.html'));
app.get('/admin', page('admin.html'));
app.get('/live', page('live.html'));

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`\n  مخيم الحاشي · Lucky Draw`);
  console.log(`  -  http://localhost:${config.port}       (public subscribe)`);
  console.log(`  -  http://localhost:${config.port}/admin  (dashboard)`);
  console.log(`  -  http://localhost:${config.port}/live   (live draw screen)\n`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
