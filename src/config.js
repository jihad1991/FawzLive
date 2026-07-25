// Minimal .env loader (no dependency) + typed config.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Load .env (falls back silently if missing).
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

const e = process.env;

export const config = {
  root,
  port: parseInt(e.PORT || '3000', 10),
  host: e.HOST || '0.0.0.0',
  sessionSecret: e.SESSION_SECRET || 'dev-insecure-secret-change-me',
  dbFile: path.resolve(root, e.DB_FILE || './data/lucky-draw.db'),
  admin: {
    email: e.ADMIN_EMAIL || 'info@alhashi.om',
    password: e.ADMIN_PASSWORD || 'demo1234',
    name: e.ADMIN_NAME || 'مدير مخيم الحاشي',
  },
  wasender: {
    apiKey: e.WASENDER_API_KEY || '',
    baseUrl: e.WASENDER_BASE_URL || 'https://wasenderapi.com/api',
  },
  get isProd() { return e.NODE_ENV === 'production'; },
};
