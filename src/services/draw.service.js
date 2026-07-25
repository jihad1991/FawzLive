// Draw domain logic: eligible pool + atomic winner selection.
import crypto from 'node:crypto';
import { db } from '../db.js';

// Active campaign. With a segment ('visitor' | 'photographer') it returns the
// active draw for that segment — the two segments run in parallel.
export function getActiveCampaign(segment) {
  if (segment) {
    return db.prepare('SELECT * FROM campaigns WHERE active = 1 AND type = ? ORDER BY id DESC LIMIT 1').get(segment)
        || db.prepare('SELECT * FROM campaigns WHERE type = ? ORDER BY id DESC LIMIT 1').get(segment);
  }
  return db.prepare("SELECT * FROM campaigns WHERE active = 1 AND type = 'visitor' ORDER BY id DESC LIMIT 1").get()
      || db.prepare('SELECT * FROM campaigns WHERE active = 1 ORDER BY id DESC LIMIT 1').get()
      || db.prepare('SELECT * FROM campaigns ORDER BY id DESC LIMIT 1').get();
}

// Resolve a campaign by explicit id, else fall back to the active one.
export function resolveCampaign(campaignId) {
  if (campaignId) return getCampaign(parseInt(campaignId, 10));
  return getActiveCampaign();
}

export function getCampaign(id) {
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
}

// Participants still in the running for a given campaign.
export function eligiblePool(campaignId) {
  const c = getCampaign(campaignId);
  if (!c) return [];
  const wonThisCampaign = new Set(
    db.prepare('SELECT participant_id FROM winners WHERE campaign_id = ? AND participant_id IS NOT NULL')
      .all(campaignId).map(r => r.participant_id)
  );
  const rows = db.prepare(
    `SELECT * FROM participants WHERE campaign_id = ? AND excluded = 0 ${c.exclude_prev ? 'AND won_before = 0' : ''}`
  ).all(campaignId);
  return rows.filter(p => !wonThisCampaign.has(p.id));
}

function secureRandomInt(max) {
  // Unbiased random integer in [0, max) using crypto.
  if (max <= 0) return 0;
  const limit = Math.floor(0xffffffff / max) * max;
  let x;
  do { x = crypto.randomBytes(4).readUInt32BE(0); } while (x >= limit);
  return x % max;
}

// Pick one winner atomically: re-reads the pool inside a transaction so two
// concurrent draws can never select the same participant.
export const drawWinner = db.transaction((campaignId) => {
  const c = getCampaign(campaignId);
  if (!c) throw new Error('campaign-not-found');

  const pool = eligiblePool(campaignId);
  if (!pool.length) return null;

  const already = db.prepare('SELECT COUNT(*) n FROM winners WHERE campaign_id = ?').get(campaignId).n;
  if (already >= c.prize_count) return { full: true };

  const chosen = pool[secureRandomInt(pool.length)];
  const rank = already + 1;

  const info = db.prepare(
    `INSERT INTO winners (campaign_id, participant_id, name, phone, prize, rank)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(campaignId, chosen.id, chosen.name, chosen.phone, c.prize, rank);

  db.prepare('UPDATE participants SET won_before = 1 WHERE id = ?').run(chosen.id);

  return {
    id: info.lastInsertRowid,
    participant_id: chosen.id,
    name: chosen.name,
    phone: chosen.phone,
    prize: c.prize,
    rank,
    reels: [chosen.reel1, chosen.reel2, chosen.reel3].filter(Boolean),
  };
});

export function resetDraw(campaignId) {
  const tx = db.transaction(() => {
    const ids = db.prepare('SELECT participant_id FROM winners WHERE campaign_id = ? AND participant_id IS NOT NULL')
      .all(campaignId).map(r => r.participant_id);
    db.prepare('DELETE FROM winners WHERE campaign_id = ?').run(campaignId);
    // Only clear the won_before flag we set during this campaign's draw
    // (participants flagged before are re-flagged only if they win again).
    for (const id of ids) {
      const stillWon = db.prepare('SELECT 1 FROM winners WHERE participant_id = ? LIMIT 1').get(id);
      if (!stillWon) db.prepare('UPDATE participants SET won_before = 0 WHERE id = ?').run(id);
    }
  });
  tx();
}
