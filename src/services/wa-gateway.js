// Built-in WhatsApp gateway (Baileys) — the in-house alternative to Wasender.
// Links a phone by QR exactly like the hosted services do, keeps the session
// on disk so it survives restarts, and sends text through a throttled queue.
//
// Only one session runs per installation (one client = one deployment), which
// keeps the model simple: no tenant routing, no shared state.
import path from 'node:path';
import fs from 'node:fs';
import QRCode from 'qrcode';
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { config } from '../config.js';

const SESSION_DIR = path.join(config.root, 'data', 'wa-session');

// Pacing between messages. WhatsApp flags bursts, so sends are spaced out with
// jitter; the gap only applies *between* messages, so a lone message goes now.
const MIN_GAP_MS = 4000;
const JITTER_MS = 3000;

const state = {
  status: 'disconnected',   // disconnected | connecting | qr | connected
  qrDataUrl: '',            // rendered QR while status === 'qr'
  me: '',                   // linked number once connected
  connectedAt: null,
  lastError: '',
};

let sock = null;
let starting = false;
let retries = 0;
let manualLogout = false;

const queue = [];
let draining = false;
let lastSentAt = 0;

const log = (...a) => console.log('[wa-gateway]', ...a);
const hasSession = () => fs.existsSync(path.join(SESSION_DIR, 'creds.json'));

export function waGatewayStatus() {
  return {
    status: state.status,
    qr: state.status === 'qr' ? state.qrDataUrl : '',
    me: state.me,
    connectedAt: state.connectedAt,
    lastError: state.lastError,
    queued: queue.length,
    hasSession: hasSession(),
  };
}

export const waGatewayReady = () => state.status === 'connected';

// Start (or restart) the socket. Safe to call repeatedly.
export async function waGatewayConnect() {
  if (starting || state.status === 'connected') return waGatewayStatus();
  starting = true;
  manualLogout = false;
  state.lastError = '';
  state.status = 'connecting';

  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    const { state: auth, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    sock = makeWASocket({
      version,
      auth,
      browser: Browsers.appropriate('FawzLive'),
      // Leave the phone's own presence alone — the account keeps behaving
      // normally for its owner while we send from it.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      logger: silentLogger(),
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => onConnectionUpdate(u).catch(e => log('update error', e.message)));
  } catch (err) {
    state.status = 'disconnected';
    state.lastError = err.message;
    log('connect failed', err.message);
  } finally {
    starting = false;
  }
  return waGatewayStatus();
}

async function onConnectionUpdate({ connection, lastDisconnect, qr }) {
  if (qr) {
    state.status = 'qr';
    state.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
    log('QR ready — scan from WhatsApp > Linked devices');
  }

  if (connection === 'open') {
    retries = 0;
    state.status = 'connected';
    state.qrDataUrl = '';
    state.me = (sock?.user?.id || '').split(':')[0].split('@')[0];
    state.connectedAt = new Date().toISOString();
    log('connected as', state.me);
    drain();
  }

  if (connection === 'close') {
    const code = lastDisconnect?.error?.output?.statusCode;
    state.status = 'disconnected';
    state.qrDataUrl = '';

    if (manualLogout) return;

    if (code === DisconnectReason.loggedOut) {
      // The phone unlinked us — the stored creds are dead, a new QR is needed.
      clearSession();
      state.me = '';
      state.lastError = 'logged-out';
      log('logged out from the phone — scan a new QR');
      return;
    }

    // 515 (restartRequired) fires right after a successful scan: reconnect now.
    const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(30000, 2000 * 2 ** retries++);
    log(`connection closed (${code ?? 'unknown'}) — reconnecting in ${delay}ms`);
    setTimeout(() => waGatewayConnect(), delay);
  }
}

// Unlink the phone and wipe the stored session.
export async function waGatewayLogout() {
  manualLogout = true;
  try { await sock?.logout(); } catch { /* already gone */ }
  try { sock?.end?.(); } catch { /* noop */ }
  sock = null;
  clearSession();
  Object.assign(state, { status: 'disconnected', qrDataUrl: '', me: '', connectedAt: null, lastError: '' });
  log('session cleared');
  return waGatewayStatus();
}

function clearSession() {
  try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch { /* noop */ }
}

// Queue a text message. Resolves once it is actually sent (or rejected).
export function waGatewaySend(to, text) {
  return new Promise((resolve) => {
    if (!waGatewayReady()) return resolve({ ok: false, error: 'not-connected' });
    queue.push({ to, text, resolve });
    drain();
  });
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      if (!waGatewayReady()) break;                  // pause; resumes on reconnect
      const wait = Math.max(0, MIN_GAP_MS + Math.random() * JITTER_MS - (Date.now() - lastSentAt));
      if (wait) await sleep(wait);
      if (!waGatewayReady()) break;

      const job = queue.shift();
      try {
        const jid = job.to + '@s.whatsapp.net';
        // Skip numbers that have no WhatsApp account instead of erroring out.
        const [check] = await sock.onWhatsApp(job.to).catch(() => []);
        if (check && check.exists === false) {
          job.resolve({ ok: false, error: 'not-on-whatsapp' });
          continue;
        }
        await sock.sendMessage(check?.jid || jid, { text: job.text });
        lastSentAt = Date.now();
        job.resolve({ ok: true });
      } catch (err) {
        log('send failed', err.message);
        job.resolve({ ok: false, error: err.message });
      }
    }
  } finally {
    draining = false;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Baileys is chatty on its own logger; we surface what matters ourselves.
function silentLogger() {
  const noop = () => {};
  const l = { level: 'silent', trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };
  l.child = () => l;
  return l;
}

// Resume an existing session on boot so sending works without admin action.
export function waGatewayBoot() {
  if (hasSession()) {
    log('restoring saved session…');
    waGatewayConnect().catch(e => log('boot failed', e.message));
  }
}
