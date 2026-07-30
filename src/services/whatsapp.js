// WhatsApp notifier via Wasender API (https://wasenderapi.com).
// The API key is configured from the admin Settings page (stored in the
// settings table) and falls back to WASENDER_API_KEY in .env.
// With no key at all it runs in mock mode: messages are logged, never sent.
import { config } from '../config.js';
import { db, getSetting } from '../db.js';
import { waGatewayReady, waGatewaySend } from './wa-gateway.js';

// Which sender is in charge: the built-in QR gateway or the Wasender API.
export function waProvider() {
  return getSetting('wa_provider', 'wasender') === 'local' ? 'local' : 'wasender';
}

// Live credentials — DB first (editable from the UI), then .env.
export function waCreds() {
  const apiKey = (getSetting('wasender_api_key', '') || config.wasender.apiKey || '').trim();
  const baseUrl = (getSetting('wasender_base_url', '') || config.wasender.baseUrl || '').trim().replace(/\/+$/, '');
  const source = getSetting('wasender_api_key', '') ? 'db' : (config.wasender.apiKey ? 'env' : null);
  const provider = waProvider();
  return {
    apiKey, baseUrl, source, provider,
    // "Configured" means the active provider can actually deliver a message.
    configured: provider === 'local' ? waGatewayReady() : !!apiKey,
  };
}

function normalizePhone(phone) {
  // Wasender expects an international number, digits only (e.g. 9689XXXXXXX).
  let p = String(phone || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  // Bare Omani local number (9 digits starting with 9) -> prepend country code.
  if (/^9\d{7}$/.test(p)) p = '968' + p;
  return p;
}

export async function sendWhatsApp(phone, text) {
  const to = normalizePhone(phone);
  if (!to || to.includes('•')) {
    return { ok: false, mock: true, reason: 'masked-or-empty-number' };
  }

  // Built-in gateway: queued + throttled through the linked phone.
  if (waProvider() === 'local') {
    if (!waGatewayReady()) {
      console.log(`[whatsapp:mock] (gateway offline) to ${to}\n${text}\n`);
      return { ok: true, mock: true, reason: 'gateway-offline' };
    }
    const r = await waGatewaySend(to, text);
    return r.ok ? { ok: true, via: 'local' } : { ok: false, error: r.error };
  }

  const { apiKey, baseUrl } = waCreds();
  if (!apiKey) {
    console.log(`[whatsapp:mock] to ${to}\n${text}\n`);
    return { ok: true, mock: true };
  }

  try {
    const res = await fetch(`${baseUrl}/send-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ to, text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[whatsapp] send failed', res.status, data);
      return { ok: false, status: res.status, data };
    }
    return { ok: true, data };
  } catch (err) {
    console.error('[whatsapp] error', err.message);
    return { ok: false, error: err.message };
  }
}

// ── Message templates ────────────────────────────────────
// Editable from the admin Settings page (stored in `settings`), with these
// defaults as the fallback / "restore defaults" source.
export const DEFAULT_TEMPLATES = {
  registered: 'مرحباً {name}\nتم تسجيلك بنجاح في سحب "{campaign}" لدى {store}.\nبالتوفيق.',
  winner: 'مبروك {name}\nلقد فزت في سحب "{campaign}".\nالجائزة: {prize}.\nيرجى التواصل معنا لاستلامها.',
};

// Placeholders offered in the UI.
export const TEMPLATE_VARS = ['name', 'campaign', 'prize', 'store'];

export function getTemplate(kind) {
  return getSetting('msg_' + kind, '') || DEFAULT_TEMPLATES[kind] || '';
}

// Replace {placeholders}; unknown ones are left untouched so typos stay visible.
export function fillTemplate(tpl, vars = {}) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k] ?? '') : m);
}

function storeName() {
  const row = db.prepare('SELECT store_name FROM campaigns WHERE active = 1 ORDER BY id DESC LIMIT 1').get()
           || db.prepare('SELECT store_name FROM campaigns ORDER BY id DESC LIMIT 1').get();
  return row?.store_name || '';
}

// Whether the registration confirmation is sent automatically.
export function autoSendRegistered() {
  return getSetting('msg_registered_on', '1') !== '0';
}

export const templates = {
  registered(name, campaign) {
    return fillTemplate(getTemplate('registered'), { name, campaign, prize: '', store: storeName() });
  },
  winner(name, campaign, prize) {
    return fillTemplate(getTemplate('winner'), { name, campaign, prize, store: storeName() });
  },
};
