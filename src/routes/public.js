// Public + kiosk endpoints: campaign info and participant registration.
// Two segments run in parallel: 'visitor' (name + phone) and 'photographer'
// (name + phone + up to 3 Instagram reel links). Each has its own draw/prize.
import { db } from '../db.js';
import { getActiveCampaign } from '../services/draw.service.js';
import { broadcast } from '../services/hub.js';
import { sendWhatsApp, templates, autoSendRegistered } from '../services/whatsapp.js';

function cleanPhone(phone) {
  return String(phone || '').replace(/[^\d+•\s]/g, '').trim();
}
function validPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}
// Validate + canonicalize an Instagram reel link.
// Returns a normalized URL (https://instagram.com/reel/<id>) or null if it is
// not a valid Instagram reel/post/tv link. Reel ids are case-sensitive, so
// only the host is lowercased; query, hash and trailing slashes are stripped
// so the same reel always compares equal.
function normalizeReel(raw) {
  let s = String(raw || '').trim().slice(0, 300);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'instagram.com' && host !== 'instagr.am') return null;
  const m = u.pathname.match(/^\/(reel|reels|p|tv)\/([^/]+)/i);
  if (!m) return null;
  return `https://instagram.com/${m[1].toLowerCase()}/${m[2]}`;
}

function campaignPublicView(c) {
  if (!c) return null;
  const count = db.prepare('SELECT COUNT(*) n FROM participants WHERE campaign_id = ?').get(c.id).n;
  let daysLeft = 0;
  if (c.draw_date) daysLeft = Math.max(0, Math.ceil((new Date(c.draw_date) - Date.now()) / 86400000));
  return {
    id: c.id, segment: c.type,
    storeName: c.store_name, storeInitial: c.store_initial, storeHandle: c.store_handle,
    campaignName: c.name, prizeName: c.prize, prizeCount: c.prize_count,
    totalParticipants: count, daysLeft, drawDate: c.draw_date || null,
  };
}

export default async function publicRoutes(app) {
  // Public campaign info. ?segment=visitor|photographer selects the track;
  // without it, returns both tracks so the page can show the two-car event.
  app.get('/api/campaign', async (request) => {
    const seg = request.query.segment;
    if (seg === 'visitor' || seg === 'photographer') {
      return campaignPublicView(getActiveCampaign(seg)) || { error: 'no-campaign' };
    }
    return {
      visitor: campaignPublicView(getActiveCampaign('visitor')),
      photographer: campaignPublicView(getActiveCampaign('photographer')),
    };
  });

  // Register a participant into the active draw of the chosen segment.
  app.post('/api/register', async (request, reply) => {
    const b = request.body || {};
    const segment = b.segment === 'photographer' ? 'photographer' : 'visitor';
    const name = String(b.name || '').trim().slice(0, 80);
    const phone = cleanPhone(b.phone).slice(0, 25);
    const agreed = !!b.agree;
    const source = b.source === 'kiosk' ? 'kiosk' : 'public';

    if (!name) return reply.code(400).send({ error: 'name-required' });
    if (!validPhone(phone)) return reply.code(400).send({ error: 'phone-invalid' });
    if (!agreed) return reply.code(400).send({ error: 'must-agree' });

    // Validate + de-duplicate reels (photographers only).
    const reels = [];
    if (segment === 'photographer') {
      const raw = Array.isArray(b.reels) ? b.reels.map(x => String(x || '').trim()).filter(Boolean).slice(0, 3) : [];
      const seen = new Set();
      for (const link of raw) {
        const norm = normalizeReel(link);
        if (!norm) return reply.code(400).send({ error: 'reel-not-instagram' });
        if (seen.has(norm)) return reply.code(400).send({ error: 'reel-duplicate' }); // same reel twice in one entry
        seen.add(norm);
        reels.push(norm);
      }
      if (reels.length === 0) return reply.code(400).send({ error: 'reels-required' });
    }

    const c = getActiveCampaign(segment);
    if (!c) return reply.code(400).send({ error: 'no-campaign' });

    // Reject reels already submitted by anyone else in this draw.
    if (reels.length) {
      const clash = db.prepare(
        'SELECT 1 FROM participants WHERE campaign_id = ? AND (reel1 = ? OR reel2 = ? OR reel3 = ?) LIMIT 1');
      for (const u of reels) {
        if (clash.get(c.id, u, u, u)) return reply.code(409).send({ error: 'reel-used', reel: u });
      }
    }

    try {
      const info = db.prepare(
        `INSERT INTO participants (campaign_id, name, phone, source, agreed, reel1, reel2, reel3)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
      ).run(c.id, name, phone, source, reels[0] || null, reels[1] || null, reels[2] || null);

      const count = db.prepare('SELECT COUNT(*) n FROM participants WHERE campaign_id = ?').get(c.id).n;
      broadcast({ type: 'participant:new', segment, campaignId: c.id, count, name });

      if (autoSendRegistered()) {
        sendWhatsApp(phone, templates.registered(name, c.name))
          .then(r => { if (r.ok && !r.mock) db.prepare('UPDATE participants SET notified = 1 WHERE id = ?').run(info.lastInsertRowid); })
          .catch(() => {});
      }

      return { ok: true, id: info.lastInsertRowid, total: count, segment };
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return reply.code(409).send({ error: 'already-registered' });
      request.log.error(err);
      return reply.code(500).send({ error: 'server-error' });
    }
  });
}
