// Draw control endpoints (admin-guarded) — used by the live screen.
// A ?campaignId selects which draw (visitor car / photographer car) to run;
// without it, the active draw is used.
import { requireAdmin } from '../auth.js';
import { db } from '../db.js';
import { getActiveCampaign, resolveCampaign, eligiblePool, drawWinner, resetDraw } from '../services/draw.service.js';
import { broadcast } from '../services/hub.js';

export default async function drawRoutes(app) {
  app.register(async (guarded) => {
    guarded.addHook('preHandler', requireAdmin);

    // All draws available to run on the live screen.
    guarded.get('/api/draw/campaigns', async () => {
      const items = db.prepare(
        `SELECT id, name, prize, type, prize_count, active,
           (SELECT COUNT(*) FROM winners w WHERE w.campaign_id = c.id) AS winners
         FROM campaigns c ORDER BY type ASC, active DESC, id DESC`).all();
      return { items };
    });

    guarded.get('/api/draw/state', async (request) => {
      const c = resolveCampaign(request.query.campaignId);
      if (!c) return { error: 'no-campaign' };
      const winners = db.prepare(
        `SELECT w.id, w.name, w.phone, w.rank, w.received, p.reel1, p.reel2, p.reel3
         FROM winners w LEFT JOIN participants p ON p.id = w.participant_id
         WHERE w.campaign_id = ? ORDER BY w.rank ASC`).all(c.id)
        .map(({ reel1, reel2, reel3, ...w }) => ({ ...w, reels: [reel1, reel2, reel3].filter(Boolean) }));
      return {
        campaign: { id: c.id, name: c.name, prize: c.prize, segment: c.type, prizeCount: c.prize_count, storeName: c.store_name, storeHandle: c.store_handle },
        eligibleCount: eligiblePool(c.id).length,
        winners,
      };
    });

    guarded.get('/api/draw/pool-sample', async (request) => {
      const c = resolveCampaign(request.query.campaignId);
      const pool = c ? eligiblePool(c.id) : [];
      return { names: pool.map(p => p.name), count: pool.length };
    });

    guarded.post('/api/draw/roll', async (request, reply) => {
      const c = resolveCampaign(request.query.campaignId);
      if (!c) return reply.code(400).send({ error: 'no-campaign' });

      // Ship a shuffled name sample with the rolling event so every synced
      // screen (even non-admin viewers) spins through real participant names.
      const sample = eligiblePool(c.id).map(p => p.name)
        .sort(() => Math.random() - 0.5).slice(0, 40);
      broadcast({ type: 'draw:rolling', campaignId: c.id, names: sample });
      const result = drawWinner(c.id);

      if (!result) return reply.code(409).send({ error: 'pool-empty' });
      if (result.full) return reply.code(409).send({ error: 'winners-complete' });

      broadcast({ type: 'draw:winner', campaignId: c.id, winner: { name: result.name, phone: result.phone, rank: result.rank, reels: result.reels } });
      return { ok: true, winner: result };
    });

    guarded.post('/api/draw/reset', async (request) => {
      const c = resolveCampaign(request.query.campaignId);
      if (c) resetDraw(c.id);
      broadcast({ type: 'draw:reset', campaignId: c?.id });
      return { ok: true };
    });
  });
}
