// Seed the default admin + a demo campaign with sample participants,
// mirroring the numbers from the original design so the UI looks alive.
import { db } from './db.js';
import { hashPassword } from './auth.js';
import { config } from './config.js';

export function ensureSeed() {
  const adminCount = db.prepare('SELECT COUNT(*) n FROM admins').get().n;
  if (adminCount === 0) {
    db.prepare('INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)')
      .run(config.admin.email.toLowerCase(), hashPassword(config.admin.password), config.admin.name);
    console.log(`[seed] admin created: ${config.admin.email}`);
  }

  const campCount = db.prepare('SELECT COUNT(*) n FROM campaigns').get().n;
  if (campCount === 0) {
    // Two parallel car draws — one for visitors, one for photographers.
    const visitor = db.prepare(
      `INSERT INTO campaigns (name, prize, type, prize_count, draw_date, exclude_prev, active)
       VALUES (?, ?, 'visitor', 1, ?, 1, 1)`
    ).run('سحب سيارة الزوّار', 'سيارة الزوّار', '2026-08-20').lastInsertRowid;

    const photog = db.prepare(
      `INSERT INTO campaigns (name, prize, type, prize_count, draw_date, exclude_prev, active)
       VALUES (?, ?, 'photographer', 1, ?, 1, 1)`
    ).run('سحب سيارة المصوّرين', 'سيارة المصوّرين', '2026-08-20').lastInsertRowid;

    const visitors = [
      ['عبدالله البلوشي', '+96891001123'], ['مريم الكندية', '+96897002288'],
      ['سالم الحارثي', '+96892003311'], ['نورة الرواحية', '+96899004442'],
      ['خالد المعمري', '+96895005576'], ['أمل البوسعيدية', '+96896006605'],
      ['سعيد الهنائي', '+96894007739'], ['هند الشكيلية', '+96893008861'],
      ['يوسف الغافري', '+96897009914'], ['عائشة الوهيبية', '+96891010090'],
      ['حمد الكلباني', '+96898011127'], ['بدرية الريامية', '+96896012253'],
    ];
    const insV = db.prepare(`INSERT INTO participants (campaign_id, name, phone, source, agreed) VALUES (?, ?, ?, 'public', 1)`);

    const photogs = [
      ['فيصل الزدجالي', '+96890200011'], ['ريم العجمية', '+96890200022'],
      ['طارق الشيدي', '+96890200033'], ['لمياء البادية', '+96890200044'],
      ['ماجد الرئيسي', '+96890200055'], ['شذى الحوسنية', '+96890200066'],
    ];
    const insP = db.prepare(`INSERT INTO participants (campaign_id, name, phone, source, agreed, reel1, reel2, reel3) VALUES (?, ?, ?, 'public', 1, ?, ?, ?)`);
    const reels = (i) => [
      `https://instagram.com/reel/hashi-${i}a`,
      `https://instagram.com/reel/hashi-${i}b`,
      `https://instagram.com/reel/hashi-${i}c`,
    ];

    db.transaction(() => {
      visitors.forEach(([n, p]) => insV.run(visitor, n, p));
      photogs.forEach(([n, p], i) => { const r = reels(i + 1); insP.run(photog, n, p, r[0], r[1], r[2]); });
    })();
    console.log(`[seed] 2 car draws created · ${visitors.length} visitors · ${photogs.length} photographers`);
  }
}
