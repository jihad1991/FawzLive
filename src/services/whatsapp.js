// WhatsApp notifier via Wasender API (https://wasenderapi.com).
// In dev (no API key) it runs in mock mode: messages are logged, never sent.
import { config } from '../config.js';

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

  if (!config.wasender.apiKey) {
    console.log(`[whatsapp:mock] to ${to}\n${text}\n`);
    return { ok: true, mock: true };
  }

  try {
    const res = await fetch(`${config.wasender.baseUrl}/send-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.wasender.apiKey}`,
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

// Message templates (bilingual — Arabic default).
export const templates = {
  registered(name, campaign) {
    return `مرحباً ${name}\nتم تسجيلك بنجاح في سحب "${campaign}" لدى مخيم الحاشي.\nبالتوفيق.`;
  },
  winner(name, campaign, prize) {
    return `مبروك ${name}\nلقد فزت في سحب "${campaign}".\nالجائزة: ${prize}.\nيرجى التواصل معنا لاستلامها.`;
  },
};
