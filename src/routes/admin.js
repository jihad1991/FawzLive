// Admin API: auth, dashboard stats, participants, campaign setup, winners, settings.
import { db, getSetting, setSetting } from '../db.js';
import { hashPassword, verifyPassword, issueSession, clearSession, currentAdmin, requireAdmin } from '../auth.js';
import { getActiveCampaign, getCampaign, resolveCampaign } from '../services/draw.service.js';
import {
  sendWhatsApp, templates, waCreds,
  getTemplate, fillTemplate, autoSendRegistered,
  TEMPLATE_VARS, DEFAULT_TEMPLATES,
} from '../services/whatsapp.js';

export default async function adminRoutes(app) {
  // ── Auth ──────────────────────────────────────────────
  app.post('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body || {};
    const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(String(email || '').trim().toLowerCase());
    if (!admin || !verifyPassword(password || '', admin.password_hash)) {
      return reply.code(401).send({ error: 'invalid-credentials' });
    }
    issueSession(reply, admin.id);
    return { ok: true, admin: { id: admin.id, email: admin.email, name: admin.name } };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    clearSession(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => {
    const admin = currentAdmin(request);
    return admin ? { admin } : { admin: null };
  });

  // ── Wasender webhook receiver ──────────────────────────
  // Paste this URL in the Wasender dashboard (Webhooks). Requests are
  // verified against the webhook secret saved in Settings; the latest
  // event + session status are stored so the Settings page can show them.
  app.post('/api/wasender/webhook', async (request, reply) => {
    const secret = getSetting('wasender_webhook_secret', '');
    const sig = request.headers['x-webhook-signature'] || '';
    if (secret && sig !== secret) return reply.code(401).send({ error: 'bad-signature' });

    const b = request.body || {};
    const event = String(b.event || b.type || 'unknown').slice(0, 60);
    setSetting('wasender_last_event', JSON.stringify({ event, at: new Date().toISOString() }));
    if (event === 'session.status' || event === 'sessions.status') {
      const status = String(b.data?.status || b.status || '').slice(0, 30);
      if (status) setSetting('wasender_session_status', status);
    }
    return { ok: true };
  });

  // ── Everything below requires an admin session ────────
  app.register(async (guarded) => {
    guarded.addHook('preHandler', requireAdmin);

    // Dashboard stats (scoped to the selected draw, else active)
    guarded.get('/api/admin/stats', async (request) => {
      const c = resolveCampaign(request.query.campaignId);
      const cid = c?.id;
      const total = cid ? db.prepare('SELECT COUNT(*) n FROM participants WHERE campaign_id = ?').get(cid).n : 0;
      const today = cid ? db.prepare(
        "SELECT COUNT(*) n FROM participants WHERE campaign_id = ? AND date(created_at) = date('now')").get(cid).n : 0;
      const winnersCount = cid ? db.prepare('SELECT COUNT(*) n FROM winners WHERE campaign_id = ?').get(cid).n : 0;
      const draws = db.prepare('SELECT COUNT(DISTINCT campaign_id) n FROM winners').get().n;

      // Registrations over the last 7 days for the bar chart.
      const rows = db.prepare(
        `SELECT date(created_at) d, COUNT(*) n FROM participants
         WHERE campaign_id = ? AND created_at >= date('now','-6 days')
         GROUP BY date(created_at)`).all(cid || 0);
      const byDay = Object.fromEntries(rows.map(r => [r.d, r.n]));
      const chart = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        chart.push({ date: d, count: byDay[d] || 0 });
      }

      const recent = cid ? db.prepare(
        'SELECT id, name, phone, source, created_at FROM participants WHERE campaign_id = ? ORDER BY id DESC LIMIT 6').all(cid) : [];

      // Accepted reels: total reel links submitted across this draw's photographers.
      const reels = cid
        ? db.prepare('SELECT COUNT(reel1) + COUNT(reel2) + COUNT(reel3) AS n FROM participants WHERE campaign_id = ?').get(cid).n
        : 0;

      return { total, today, winnersCount, draws, reels, chart, recent, campaign: c && { id: c.id, name: c.name, prize: c.prize, type: c.type, prizeCount: c.prize_count } };
    });

    // Participants list (search + pagination), scoped to the selected draw
    guarded.get('/api/admin/participants', async (request) => {
      const c = resolveCampaign(request.query.campaignId);
      if (!c) return { items: [], total: 0, segment: null };
      const q = String(request.query.q || '').trim();
      const limit = Math.min(200, parseInt(request.query.limit || '100', 10));
      const offset = Math.max(0, parseInt(request.query.offset || '0', 10));
      const where = q ? 'AND (name LIKE @q OR phone LIKE @q)' : '';
      const params = { cid: c.id, q: `%${q}%`, limit, offset };
      const items = db.prepare(
        `SELECT * FROM participants WHERE campaign_id = @cid ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`).all(params);
      const total = db.prepare(`SELECT COUNT(*) n FROM participants WHERE campaign_id = @cid ${where}`).get(params).n;
      return { items, total, segment: c.type, campaignName: c.name };
    });

    guarded.post('/api/admin/participants', async (request, reply) => {
      const c = resolveCampaign(request.query.campaignId);
      if (!c) return reply.code(400).send({ error: 'no-campaign' });
      const name = String(request.body?.name || '').trim().slice(0, 80);
      const phone = String(request.body?.phone || '').trim().slice(0, 25);
      if (!name || !phone) return reply.code(400).send({ error: 'name-and-phone-required' });
      // Same per-phone limits as public registration: visitors 1, photographers 3.
      const maxEntries = c.type === 'photographer' ? 3 : 1;
      const existing = db.prepare('SELECT COUNT(*) n FROM participants WHERE campaign_id = ? AND phone = ?').get(c.id, phone).n;
      if (existing >= maxEntries) return reply.code(409).send({ error: 'duplicate-phone', max: maxEntries });
      const info = db.prepare(
        `INSERT INTO participants (campaign_id, name, phone, source, agreed) VALUES (?, ?, ?, 'admin', 1)`
      ).run(c.id, name, phone);
      return { ok: true, id: info.lastInsertRowid };
    });

    // Single participant profile (details + reels + win history)
    guarded.get('/api/admin/participants/:id', async (request, reply) => {
      const p = db.prepare('SELECT * FROM participants WHERE id = ?').get(parseInt(request.params.id, 10));
      if (!p) return reply.code(404).send({ error: 'not-found' });
      const c = getCampaign(p.campaign_id);
      const wins = db.prepare('SELECT prize, rank, received, created_at FROM winners WHERE participant_id = ? ORDER BY created_at DESC').all(p.id);
      return {
        participant: p,
        segment: c?.type,
        campaignName: c?.name,
        reels: [p.reel1, p.reel2, p.reel3].filter(Boolean),
        wins,
      };
    });

    guarded.patch('/api/admin/participants/:id', async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const p = db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
      if (!p) return reply.code(404).send({ error: 'not-found' });
      const excluded = request.body?.excluded;
      if (typeof excluded === 'boolean') {
        db.prepare('UPDATE participants SET excluded = ? WHERE id = ?').run(excluded ? 1 : 0, id);
      }
      return { ok: true };
    });

    guarded.delete('/api/admin/participants/:id', async (request) => {
      db.prepare('DELETE FROM participants WHERE id = ?').run(parseInt(request.params.id, 10));
      return { ok: true };
    });

    // CSV export
    guarded.get('/api/admin/participants.csv', async (request, reply) => {
      const c = resolveCampaign(request.query.campaignId);
      const rows = c ? db.prepare('SELECT name, phone, source, reel1, reel2, reel3, created_at FROM participants WHERE campaign_id = ? ORDER BY id DESC').all(c.id) : [];
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = ['name,phone,source,reel1,reel2,reel3,created_at', ...rows.map(r => [r.name, r.phone, r.source, r.reel1, r.reel2, r.reel3, r.created_at].map(esc).join(','))].join('\n');
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="participants.csv"');
      return '﻿' + csv; // BOM so Excel reads Arabic correctly
    });

    // Campaign / draw setup
    guarded.get('/api/admin/campaign', async () => getActiveCampaign() || {});
    guarded.put('/api/admin/campaign', async (request) => {
      const c = getActiveCampaign();
      const b = request.body || {};
      const fields = {
        name: b.name, prize: b.prize,
        prize_count: b.prize_count != null ? Math.max(1, parseInt(b.prize_count, 10) || 1) : undefined,
        draw_date: b.draw_date, exclude_prev: b.exclude_prev != null ? (b.exclude_prev ? 1 : 0) : undefined,
        store_name: b.store_name, store_handle: b.store_handle,
      };
      if (c) {
        const sets = [], vals = [];
        for (const [k, v] of Object.entries(fields)) if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
        if (sets.length) { vals.push(c.id); db.prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`).run(...vals); }
        return getCampaign(c.id);
      } else {
        const info = db.prepare(
          `INSERT INTO campaigns (name, prize, prize_count, draw_date, exclude_prev) VALUES (?, ?, ?, ?, ?)`
        ).run(fields.name || 'حملة جديدة', fields.prize || 'جائزة', fields.prize_count || 1, fields.draw_date || null, fields.exclude_prev ?? 1);
        return getCampaign(info.lastInsertRowid);
      }
    });

    // ── Multiple draws / campaigns ──────────────────────
    const VALID_TYPES = ['visitor', 'photographer'];

    guarded.get('/api/admin/campaigns', async () => {
      const items = db.prepare(
        `SELECT c.*,
           (SELECT COUNT(*) FROM participants p WHERE p.campaign_id = c.id) AS participants,
           (SELECT COUNT(*) FROM winners w WHERE w.campaign_id = c.id)      AS winners
         FROM campaigns c ORDER BY c.active DESC, c.id DESC`).all();
      return { items };
    });

    guarded.post('/api/admin/campaigns', async (request) => {
      const b = request.body || {};
      const type = VALID_TYPES.includes(b.type) ? b.type : 'visitor';
      const total = db.prepare('SELECT COUNT(*) n FROM campaigns').get().n;
      const info = db.prepare(
        `INSERT INTO campaigns (name, prize, type, prize_count, draw_date, exclude_prev, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        String(b.name || 'سحب جديد').slice(0, 120),
        String(b.prize || 'جائزة').slice(0, 120),
        type,
        Math.max(1, parseInt(b.prize_count, 10) || 1),
        b.draw_date || null,
        b.exclude_prev === false ? 0 : 1,
        total === 0 ? 1 : 0,          // first-ever campaign is active by default
      );
      return getCampaign(info.lastInsertRowid);
    });

    guarded.put('/api/admin/campaigns/:id', async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const c = getCampaign(id);
      if (!c) return reply.code(404).send({ error: 'not-found' });
      const b = request.body || {};
      const fields = {
        name: b.name, prize: b.prize,
        type: b.type != null ? (VALID_TYPES.includes(b.type) ? b.type : 'visitor') : undefined,
        prize_count: b.prize_count != null ? Math.max(1, parseInt(b.prize_count, 10) || 1) : undefined,
        draw_date: b.draw_date, exclude_prev: b.exclude_prev != null ? (b.exclude_prev ? 1 : 0) : undefined,
      };
      const sets = [], vals = [];
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
      if (sets.length) { vals.push(id); db.prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`).run(...vals); }
      return getCampaign(id);
    });

    guarded.post('/api/admin/campaigns/:id/activate', async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const target = getCampaign(id);
      if (!target) return reply.code(404).send({ error: 'not-found' });
      // Only one active draw per segment — activating a visitor draw doesn't
      // touch the photographer draw, so both cars run in parallel.
      db.transaction(() => {
        db.prepare('UPDATE campaigns SET active = 0 WHERE type = ?').run(target.type);
        db.prepare('UPDATE campaigns SET active = 1 WHERE id = ?').run(id);
      })();
      return { ok: true };
    });

    guarded.delete('/api/admin/campaigns/:id', async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const total = db.prepare('SELECT COUNT(*) n FROM campaigns').get().n;
      if (total <= 1) return reply.code(400).send({ error: 'cannot-delete-last' });
      const target = getCampaign(id);
      if (!target) return reply.code(404).send({ error: 'not-found' });
      db.transaction(() => {
        db.prepare('DELETE FROM campaigns WHERE id = ?').run(id); // cascades participants + winners
        if (target.active) {
          const next = db.prepare('SELECT id FROM campaigns ORDER BY id DESC LIMIT 1').get();
          if (next) db.prepare('UPDATE campaigns SET active = 1 WHERE id = ?').run(next.id);
        }
      })();
      return { ok: true };
    });

    // Winners
    guarded.get('/api/admin/winners', async (request) => {
      const c = resolveCampaign(request.query.campaignId);
      const items = c ? db.prepare('SELECT * FROM winners WHERE campaign_id = ? ORDER BY rank ASC').all(c.id) : [];
      return { items, segment: c?.type, campaignName: c?.name };
    });

    guarded.patch('/api/admin/winners/:id', async (request) => {
      const id = parseInt(request.params.id, 10);
      if (typeof request.body?.received === 'boolean') {
        db.prepare('UPDATE winners SET received = ? WHERE id = ?').run(request.body.received ? 1 : 0, id);
      }
      return { ok: true };
    });

    // Notify a winner over WhatsApp
    guarded.post('/api/admin/winners/:id/notify', async (request, reply) => {
      const w = db.prepare('SELECT * FROM winners WHERE id = ?').get(parseInt(request.params.id, 10));
      if (!w) return reply.code(404).send({ error: 'not-found' });
      const c = getCampaign(w.campaign_id);
      const r = await sendWhatsApp(w.phone, templates.winner(w.name, c?.name || '', w.prize));
      if (r.ok) db.prepare('UPDATE winners SET notified = 1 WHERE id = ?').run(w.id);
      return { ok: r.ok, mock: !!r.mock };
    });

    // ── Admin users (multi-user management) ─────────────
    const validEmail = (e) => /^\S+@\S+\.\S+$/.test(e);

    guarded.get('/api/admin/users', async (request) => {
      const items = db.prepare('SELECT id, email, name, created_at FROM admins ORDER BY id ASC').all();
      return { items, self: request.admin.id };
    });

    guarded.post('/api/admin/users', async (request, reply) => {
      const b = request.body || {};
      const name = String(b.name || '').trim().slice(0, 80);
      const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
      const password = String(b.password || '');
      if (!name) return reply.code(400).send({ error: 'name-required' });
      if (!validEmail(email)) return reply.code(400).send({ error: 'email-invalid' });
      if (password.length < 6) return reply.code(400).send({ error: 'password-short' });
      try {
        const info = db.prepare('INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)')
          .run(email, hashPassword(password), name);
        return { ok: true, id: info.lastInsertRowid };
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) return reply.code(409).send({ error: 'email-taken' });
        throw err;
      }
    });

    guarded.put('/api/admin/users/:id', async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const u = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
      if (!u) return reply.code(404).send({ error: 'not-found' });
      const b = request.body || {};
      const name = String(b.name ?? u.name).trim().slice(0, 80);
      const email = String(b.email ?? u.email).trim().toLowerCase().slice(0, 120);
      if (!name) return reply.code(400).send({ error: 'name-required' });
      if (!validEmail(email)) return reply.code(400).send({ error: 'email-invalid' });
      if (b.password && String(b.password).length < 6) return reply.code(400).send({ error: 'password-short' });
      try {
        db.prepare('UPDATE admins SET name = ?, email = ? WHERE id = ?').run(name, email, id);
        if (b.password) db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(String(b.password)), id);
        return { ok: true };
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) return reply.code(409).send({ error: 'email-taken' });
        throw err;
      }
    });

    guarded.delete('/api/admin/users/:id', async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      if (id === request.admin.id) return reply.code(400).send({ error: 'cannot-delete-self' });
      const total = db.prepare('SELECT COUNT(*) n FROM admins').get().n;
      if (total <= 1) return reply.code(400).send({ error: 'cannot-delete-last' });
      db.prepare('DELETE FROM admins WHERE id = ?').run(id);
      return { ok: true };
    });

    // ── Own profile (name/email; password change needs the current one) ──
    guarded.put('/api/admin/profile', async (request, reply) => {
      const me = db.prepare('SELECT * FROM admins WHERE id = ?').get(request.admin.id);
      const b = request.body || {};
      const name = String(b.name ?? me.name).trim().slice(0, 80);
      const email = String(b.email ?? me.email).trim().toLowerCase().slice(0, 120);
      if (!name) return reply.code(400).send({ error: 'name-required' });
      if (!validEmail(email)) return reply.code(400).send({ error: 'email-invalid' });
      if (b.newPassword) {
        if (!verifyPassword(String(b.currentPassword || ''), me.password_hash)) {
          return reply.code(401).send({ error: 'wrong-password' });
        }
        if (String(b.newPassword).length < 6) return reply.code(400).send({ error: 'password-short' });
      }
      try {
        db.prepare('UPDATE admins SET name = ?, email = ? WHERE id = ?').run(name, email, me.id);
        if (b.newPassword) {
          db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(String(b.newPassword)), me.id);
        }
        return { ok: true, admin: { id: me.id, name, email } };
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) return reply.code(409).send({ error: 'email-taken' });
        throw err;
      }
    });

    // Settings (store branding + wasender status)
    // The key itself is never returned — only a masked hint.
    guarded.get('/api/admin/settings', async (request) => {
      const c = getActiveCampaign();
      const w = waCreds();
      const proto = request.headers['x-forwarded-proto'] || request.protocol || 'http';
      let lastEvent = null;
      try { lastEvent = JSON.parse(getSetting('wasender_last_event', '') || 'null'); } catch {}
      return {
        store: { name: c?.store_name, handle: c?.store_handle, initial: c?.store_initial },
        whatsapp: {
          configured: w.configured,
          source: w.source,                                   // 'db' | 'env' | null
          masked: w.apiKey ? maskKey(w.apiKey) : '',
          baseUrl: w.baseUrl,
          phone: getSetting('wasender_phone', ''),
          webhook: {
            url: `${proto}://${request.headers.host}/api/wasender/webhook`,
            secretSet: !!getSetting('wasender_webhook_secret', ''),
            secretMasked: getSetting('wasender_webhook_secret', '') ? maskKey(getSetting('wasender_webhook_secret', '')) : '',
            sessionStatus: getSetting('wasender_session_status', ''),
            lastEvent,
          },
        },
        messages: {
          registered: getTemplate('registered'),
          winner: getTemplate('winner'),
          autoRegistered: autoSendRegistered(),
          vars: TEMPLATE_VARS,
          defaults: DEFAULT_TEMPLATES,
        },
      };
    });

    // Save the WhatsApp message templates.
    guarded.put('/api/admin/settings/messages', async (request, reply) => {
      const b = request.body || {};
      const clean = (v) => String(v).replace(/\r\n/g, '\n').slice(0, 1000);

      for (const kind of ['registered', 'winner']) {
        if (typeof b[kind] === 'string') {
          const txt = clean(b[kind]).trim();
          if (!txt) return reply.code(400).send({ error: 'message-empty', kind });
          setSetting('msg_' + kind, txt);
        }
      }
      if (typeof b.autoRegistered === 'boolean') {
        setSetting('msg_registered_on', b.autoRegistered ? '1' : '0');
      }
      // `reset: 'registered'|'winner'|'all'` restores the built-in defaults.
      if (b.reset === 'all' || b.reset === 'registered') setSetting('msg_registered', '');
      if (b.reset === 'all' || b.reset === 'winner') setSetting('msg_winner', '');

      return {
        ok: true,
        registered: getTemplate('registered'),
        winner: getTemplate('winner'),
        autoRegistered: autoSendRegistered(),
      };
    });

    // Live preview with sample data, rendered by the same engine used at send time.
    guarded.post('/api/admin/settings/messages/preview', async (request) => {
      const c = getActiveCampaign();
      const vars = {
        name: request.body?.sampleName || 'محمد',
        campaign: c?.name || 'السحب',
        prize: c?.prize || 'الجائزة',
        store: c?.store_name || '',
      };
      return {
        registered: fillTemplate(String(request.body?.registered ?? getTemplate('registered')), vars),
        winner: fillTemplate(String(request.body?.winner ?? getTemplate('winner')), vars),
        vars,
      };
    });

    // Save (or clear) the Wasender credentials from the UI.
    guarded.put('/api/admin/settings/whatsapp', async (request, reply) => {
      const b = request.body || {};
      const apiKey = typeof b.apiKey === 'string' ? b.apiKey.trim() : undefined;
      const baseUrl = typeof b.baseUrl === 'string' ? b.baseUrl.trim().replace(/\/+$/, '') : undefined;

      if (baseUrl !== undefined) {
        if (baseUrl && !/^https:\/\/[\w.-]+/i.test(baseUrl)) {
          return reply.code(400).send({ error: 'base-url-invalid' });
        }
        setSetting('wasender_base_url', baseUrl);
      }
      if (apiKey !== undefined) {
        // An empty string clears the stored key (falls back to .env / mock mode).
        if (apiKey && apiKey.length < 8) return reply.code(400).send({ error: 'api-key-too-short' });
        setSetting('wasender_api_key', apiKey);
      }
      if (typeof b.phone === 'string') {
        const phone = b.phone.trim().slice(0, 25);
        if (phone && phone.replace(/\D/g, '').length < 8) return reply.code(400).send({ error: 'phone-invalid' });
        setSetting('wasender_phone', phone);
      }
      if (typeof b.webhookSecret === 'string') {
        // The secret shown in the Wasender dashboard; incoming webhooks must match it.
        setSetting('wasender_webhook_secret', b.webhookSecret.trim());
      }

      const w = waCreds();
      return { ok: true, configured: w.configured, source: w.source, masked: w.apiKey ? maskKey(w.apiKey) : '', baseUrl: w.baseUrl };
    });

    // Send a test message to verify the connection end to end.
    guarded.post('/api/admin/settings/whatsapp/test', async (request, reply) => {
      const phone = String(request.body?.phone || '').trim();
      if (phone.replace(/\D/g, '').length < 8) return reply.code(400).send({ error: 'phone-invalid' });
      const w = waCreds();
      const r = await sendWhatsApp(phone, 'رسالة تجريبية من نظام السحب - مخيم الحاشي. الربط يعمل بنجاح.');
      return { ok: !!r.ok, mock: !!r.mock, configured: w.configured, status: r.status, detail: r.data || r.error || null };
    });
  });
}

// Show only the last 4 characters of a secret.
function maskKey(k) {
  const s = String(k);
  return s.length <= 4 ? '••••' : '••••••••' + s.slice(-4);
}
