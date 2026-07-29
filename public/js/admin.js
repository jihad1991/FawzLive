import { api, toast, initLang, toggleLang, esc } from './common.js';
initLang();

const $ = (id) => document.getElementById(id);
const isEn = () => document.body.getAttribute('data-lang') === 'en';
const t = (ar, en) => (isEn() ? en : ar);

let currentView = 'dashboard';
let me = null; // the signed-in admin {id, email, name}

// The draw (campaign) the admin is currently managing. Scopes dashboard /
// participants / winners. null = server's active draw.
let selectedCampaignId = (() => { const v = localStorage.getItem('ld_draw'); return v ? parseInt(v, 10) : null; })();
const qs = () => (selectedCampaignId ? '?campaignId=' + selectedCampaignId : '');

// Inline stroke icons (currentColor) — keeps the UI typographic, no emoji.
const svg = (paths, size = 18, fill = 'none') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex:0 0 auto;">${paths}</svg>`;
const ICON = {
  users:   svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
  camera:  svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/>'),
  film:    svg('<rect x="2" y="2" width="20" height="20" rx="2.5"/><path d="M2 7h20M7 2l3 5M13 2l3 5"/><path d="m10 12 5 3-5 3z"/>'),
  calendar:svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  trophy:  svg('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'),
  target:  svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'),
  ticket:  svg('<path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6Z"/><path d="M13 5v14"/>'),
  edit:    svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  play:    svg('<path d="M6 4l14 8-14 8z"/>', 18, 'currentColor'),
  download:svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'),
  close:   svg('<path d="M18 6 6 18M6 6l12 12"/>', 16),
  external:svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>', 14),
  chat:    svg('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/>', 16),
  check:   svg('<path d="M20 6 9 17l-5-5"/>', 15),
  plus:    svg('<path d="M12 5v14M5 12h14"/>', 16),
  eye:     svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>', 16),
  eyeOff:  svg('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M1 1l22 22M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 16),
};

const SEGMENTS = [
  ['visitor', 'الزوّار', 'Visitors', 'users'],
  ['photographer', 'المصوّرين', 'Photographers', 'camera'],
];
const segLabel = (v) => {
  const x = SEGMENTS.find(s => s[0] === v) || SEGMENTS[0];
  return `<span style="display:inline-flex;align-items:center;gap:6px;">${ICON[x[3]]}${isEn() ? x[2] : x[1]}</span>`;
};

// Keep the sidebar WhatsApp status chip in sync.
async function syncWaStatus() {
  const st = await api.get('/api/admin/settings');
  const on = !!st.whatsapp?.configured;
  const el = $('waStatus');
  if (el) el.textContent = on ? t('واتساب متصل', 'WhatsApp connected') : t('واتساب: وضع تجريبي', 'WhatsApp: mock mode');
  return st;
}

async function populateDrawSelect() {
  const { items } = await api.get('/api/admin/campaigns');
  if (selectedCampaignId && !items.find(c => c.id === selectedCampaignId)) selectedCampaignId = null;
  const sel = document.getElementById('drawSelect');
  sel.innerHTML = items.map(c =>
    `<option value="${c.id}" ${c.id === selectedCampaignId ? 'selected' : ''}>${c.name}${c.active ? ' •' : ''}</option>`).join('');
  if (!selectedCampaignId && items.length) { selectedCampaignId = (items.find(c => c.active) || items[0]).id; sel.value = String(selectedCampaignId); }
}

// ── Auth ─────────────────────────────────────────────────
async function boot() {
  const r = await api.get('/api/auth/me');
  if (r.admin) { me = r.admin; showApp(); } else showLogin();
}
function syncAvatar() {
  if (me) $('meAvatar').textContent = (me.name || '?').trim().charAt(0);
}
function showLogin() { $('loginScreen').style.display = 'grid'; $('appScreen').style.display = 'none'; }
async function showApp() {
  $('loginScreen').style.display = 'none'; $('appScreen').style.display = 'grid';
  if (!me) { const r = await api.get('/api/auth/me'); me = r.admin; }
  syncAvatar();
  await populateDrawSelect();
  syncWaStatus();
  render();
}

// Draw selector in the topbar scopes the whole admin to one draw.
$('drawSelect').addEventListener('change', (e) => {
  selectedCampaignId = parseInt(e.target.value, 10);
  localStorage.setItem('ld_draw', String(selectedCampaignId));
  setupSelectedId = selectedCampaignId;
  render();
});

$('loginBtn').addEventListener('click', login);
$('password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
async function login() {
  const email = $('email').value.trim(), password = $('password').value;
  const btn = $('loginBtn'); btn.disabled = true; btn.style.opacity = '.6';
  const r = await api.post('/api/auth/login', { email, password });
  btn.disabled = false; btn.style.opacity = '1';
  if (r.ok) showApp(); else toast(t('بيانات الدخول غير صحيحة', 'Invalid credentials'), true);
}
$('logoutBtn').addEventListener('click', async () => { await api.post('/api/auth/logout'); showLogin(); });
$('langBtn').addEventListener('click', () => { toggleLang(); render(); });

// ── Nav ──────────────────────────────────────────────────
document.querySelectorAll('.nav-btn[data-view]').forEach(b => {
  b.addEventListener('click', () => {
    currentView = b.dataset.view;
    document.querySelectorAll('.nav-btn').forEach(x => x.classList.toggle('active', x === b));
    render();
  });
});

const TITLES = {
  dashboard: ['لوحة التحكم', 'Dashboard', 'نظرة سريعة على أداء الحملة', 'Quick overview of your campaign'],
  participants: ['المشاركون', 'Participants', 'جميع العملاء المسجلين في السحب', 'All customers entered in the draw'],
  setup: ['إعداد السحب', 'Draw setup', 'جهّز سحباً جديداً وحدد الجائزة', 'Configure the draw and prize'],
  winners: ['الفائزون', 'Winners', 'سجل الفائزين وحالة الجوائز', 'Winners log and prize status'],
  settings: ['الإعدادات', 'Settings', 'الهوية والرسائل والربط', 'Branding, messages and integrations'],
  users: ['المستخدمون', 'Users', 'حسابات مديري النظام', 'System administrator accounts'],
  profile: ['الملف الشخصي', 'My profile', 'بياناتك الشخصية وكلمة المرور', 'Your info and password'],
};

async function render() {
  const T = TITLES[currentView];
  $('pageTitle').textContent = isEn() ? T[1] : T[0];
  $('pageSub').textContent = isEn() ? T[3] : T[2];
  const c = $('content');
  c.style.animation = 'none'; void c.offsetWidth; c.style.animation = 'fadeUp .35s ease both';
  if (currentView === 'dashboard') return renderDashboard();
  if (currentView === 'participants') return renderParticipants();
  if (currentView === 'setup') return renderSetup();
  if (currentView === 'winners') return renderWinners();
  if (currentView === 'settings') return renderSettings();
  if (currentView === 'users') return renderUsers();
  if (currentView === 'profile') return renderProfile();
}

// Topbar avatar opens the profile view.
$('meAvatar').addEventListener('click', () => { currentView = 'profile'; syncNav(); render(); });

// ── Dashboard ────────────────────────────────────────────
async function renderDashboard() {
  const s = await api.get('/api/admin/stats' + qs());
  $('navCount').textContent = s.total;
  const segBadge = s.campaign?.type ? `<span class="pill" style="margin-inline-start:8px;">${segLabel(s.campaign.type)}</span>` : '';
  $('pageTitle').innerHTML = (isEn() ? 'Dashboard' : 'لوحة التحكم') + segBadge;
  const isPhotog = s.campaign?.type === 'photographer';
  const kpis = isPhotog
    ? [
        ['المصوّرون', 'Photographers', s.total, ICON.camera],
        ['الريلز المقبولة', 'Accepted reels', s.reels, ICON.film],
        ['مسجلون اليوم', 'Registered today', s.today, ICON.calendar],
        ['إجمالي الفائزين', 'Total winners', s.winnersCount, ICON.trophy],
      ]
    : [
        ['إجمالي المشاركين', 'Total participants', s.total, ICON.users],
        ['مسجلون اليوم', 'Registered today', s.today, ICON.calendar],
        ['عدد السحوبات', 'Draws held', s.draws, ICON.target],
        ['إجمالي الفائزين', 'Total winners', s.winnersCount, ICON.trophy],
      ];
  const avgReels = isPhotog && s.total ? (s.reels / s.total).toFixed(1) : null;
  if (isPhotog && avgReels) kpis[1][4] = t(`بمعدل ${avgReels} لكل مصوّر`, `avg ${avgReels} per photographer`);
  const maxBar = Math.max(1, ...s.chart.map(b => b.count));
  const days = isEn() ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] : ['أحد','اثن','ثلا','أرب','خمي','جمع','سبت'];

  $('content').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:24px;">
    <div class="kpi-grid">
      ${kpis.map(k => `
        <div class="card" style="padding:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div class="eyebrow" style="letter-spacing:.12em;">${t(k[0], k[1])}</div>
            <div style="width:34px;height:34px;border-radius:11px;background:var(--sidebar-icon-bg);color:var(--sidebar-icon-color);display:grid;place-items:center;font-size:1.1rem;">${k[3]}</div>
          </div>
          <div class="h1" style="margin-top:12px;font-size:clamp(1.6rem,2.4vw,2.1rem);">${k[2]}</div>
          ${k[4] ? `<div class="caption" style="margin-top:4px;color:var(--poslix-accent-strong);font-weight:600;">${k[4]}</div>` : ''}
        </div>`).join('')}
    </div>

    <div class="two-col">
      <div class="card" style="padding:22px;">
        <div class="h3" style="margin-bottom:20px;">${t('التسجيلات خلال 7 أيام','Registrations · last 7 days')}</div>
        <div style="display:flex;align-items:flex-end;gap:14px;height:180px;">
          ${s.chart.map((b,i) => `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;height:100%;justify-content:flex-end;">
              <div style="font-size:.7rem;color:var(--text-muted);">${b.count}</div>
              <div style="width:100%;max-width:34px;border-radius:10px 10px 4px 4px;background:linear-gradient(180deg,var(--poslix-accent),var(--poslix-accent-strong));height:${Math.round(b.count/maxBar*100)}%;min-height:8px;"></div>
              <div class="caption" style="font-size:.68rem;">${days[new Date(b.date).getDay()]}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="card" style="padding:22px;">
        <div class="h3" style="margin-bottom:18px;">${t('إجراءات سريعة','Quick actions')}</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button class="qa" data-act="add" style="display:flex;align-items:center;gap:12px;padding:13px 15px;border-radius:14px;background:var(--surface-muted);text-align:start;font-weight:600;color:var(--text-primary);"><span style="width:32px;height:32px;border-radius:10px;background:var(--sidebar-icon-bg);color:var(--sidebar-icon-color);display:grid;place-items:center;">+</span>${t('إضافة مشارك','Add participant')}</button>
          <button class="qa" data-act="setup" style="display:flex;align-items:center;gap:12px;padding:13px 15px;border-radius:14px;background:var(--surface-muted);text-align:start;font-weight:600;color:var(--text-primary);"><span style="width:32px;height:32px;border-radius:10px;background:var(--sidebar-icon-bg);color:var(--sidebar-icon-color);display:grid;place-items:center;">${ICON.edit}</span>${t('إعداد السحب','Draw setup')}</button>
          <a class="qa" href="/live" target="_blank" style="display:flex;align-items:center;gap:12px;padding:13px 15px;border-radius:14px;background:var(--poslix-brand);color:#fff;text-align:start;font-weight:600;"><span style="width:32px;height:32px;border-radius:10px;background:rgba(255,255,255,.14);display:grid;place-items:center;">${ICON.play}</span>${t('فتح شاشة السحب','Open live screen')}</a>
          <a class="qa" href="/api/admin/participants.csv${qs()}" style="display:flex;align-items:center;gap:12px;padding:13px 15px;border-radius:14px;background:var(--surface-muted);text-align:start;font-weight:600;color:var(--text-primary);"><span style="width:32px;height:32px;border-radius:10px;background:var(--sidebar-icon-bg);color:var(--sidebar-icon-color);display:grid;place-items:center;">${ICON.download}</span>${t('تصدير البيانات','Export data')}</a>
        </div>
      </div>
    </div>

    <div class="card" style="padding:22px;">
      <div class="h3" style="margin-bottom:16px;">${t('آخر المشاركين','Latest participants')}</div>
      <div style="display:flex;flex-direction:column;">
        ${s.recent.map(p => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--border-subtle);">
            <div style="width:38px;height:38px;border-radius:999px;background:var(--sidebar-icon-bg);color:var(--sidebar-icon-color);display:grid;place-items:center;font-weight:700;">${esc((p.name||'?').trim().charAt(0))}</div>
            <div style="flex:1;min-width:0;"><div style="font-weight:600;">${esc(p.name)}</div><div class="caption" style="direction:ltr;text-align:start;">${esc(p.phone)}</div></div>
            <span class="pill">${p.source === 'kiosk' ? t('كشك','kiosk') : p.source === 'admin' ? t('يدوي','manual') : t('عام','public')}</span>
          </div>`).join('') || `<div class="caption">${t('لا يوجد مشاركون بعد','No participants yet')}</div>`}
      </div>
    </div>
  </div>`;

  document.querySelectorAll('.qa[data-act]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.act === 'add') { currentView = 'participants'; syncNav(); render().then(() => addParticipantPrompt()); }
    else { currentView = 'setup'; syncNav(); render(); }
  }));
}

function syncNav() {
  document.querySelectorAll('.nav-btn[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === currentView));
}

// ── Participants ─────────────────────────────────────────
let searchQ = '';
function reelChips(p) {
  const reels = [p.reel1, p.reel2, p.reel3].filter(Boolean);
  if (!reels.length) return `<span class="caption">—</span>`;
  return reels.map((r, i) => `<a href="${esc(r)}" target="_blank" rel="noopener" class="pill" style="text-decoration:none;margin-inline-end:4px;">${ICON.film}<span style="margin-inline-start:4px;">${i + 1}</span></a>`).join('');
}
async function renderParticipants() {
  const data = await api.get('/api/admin/participants' + qs() + (qs() ? '&' : '?') + 'q=' + encodeURIComponent(searchQ));
  $('navCount').textContent = data.total;
  const isPhotog = data.segment === 'photographer';
  $('pageTitle').innerHTML = (isEn() ? 'Participants' : 'المشاركون') + `<span class="pill" style="margin-inline-start:8px;">${segLabel(data.segment)}</span>`;
  $('content').innerHTML = `
  <div class="card" style="overflow:hidden;">
    <div style="display:flex;align-items:center;gap:12px;padding:18px;flex-wrap:wrap;">
      <input id="searchInput" class="field" style="flex:1;min-width:200px;" placeholder="${t('بحث بالاسم أو رقم الهاتف…','Search by name or phone…')}" value="${esc(searchQ)}">
      <button id="addBtn" class="btn-primary" style="padding:11px 18px;">${t('+ إضافة مشارك','+ Add participant')}</button>
      <a href="/api/admin/participants.csv${qs()}" class="btn-ghost" style="padding:11px 18px;">${t('تصدير CSV','Export CSV')}</a>
    </div>
    <div style="overflow-x:auto;">
      <table>
        <thead><tr>
          <th>${t('الاسم','Name')}</th><th>${t('الهاتف','Phone')}</th>
          ${isPhotog ? `<th>${t('الريلز','Reels')}</th>` : ''}
          <th>${t('المصدر','Source')}</th><th>${t('التاريخ','Date')}</th><th>${t('الحالة','Status')}</th><th></th>
        </tr></thead>
        <tbody>
          ${data.items.map(p => `
            <tr data-id="${p.id}">
              <td><button class="pName" data-id="${p.id}" style="font-weight:600;color:var(--poslix-accent-strong);background:none;text-align:start;padding:0;">${esc(p.name)}${p.won_before ? ICON.trophy : ''}</button></td>
              <td style="direction:ltr;text-align:start;">${esc(p.phone)}</td>
              ${isPhotog ? `<td style="direction:ltr;text-align:start;">${reelChips(p)}</td>` : ''}
              <td><span class="pill">${p.source}</span></td>
              <td class="caption">${esc((p.created_at||'').slice(0,10))}</td>
              <td>${p.excluded ? `<span style="color:var(--status-negative);font-weight:600;font-size:.8rem;">${t('مستبعد','excluded')}</span>` : `<span style="color:var(--status-positive-strong);font-weight:600;font-size:.8rem;">${t('نشط','active')}</span>`}</td>
              <td style="white-space:nowrap;">
                <button class="tExc btn-ghost" style="padding:6px 10px;font-size:.78rem;">${p.excluded ? t('تفعيل','Include') : t('استبعاد','Exclude')}</button>
                <button class="tDel btn-ghost" style="padding:6px 10px;font-size:.78rem;color:var(--status-negative);border-color:rgba(192,73,47,.4);">${ICON.close}</button>
              </td>
            </tr>`).join('') || `<tr><td colspan="${isPhotog ? 7 : 6}" class="caption" style="text-align:center;padding:30px;">${t('لا نتائج','No results')}</td></tr>`}
        </tbody>
      </table>
    </div>
    <div class="caption" style="padding:14px 18px;">${t(`عرض ${data.items.length} من ${data.total} مشارك`, `Showing ${data.items.length} of ${data.total}`)}</div>
  </div>`;

  const si = $('searchInput');
  si.addEventListener('input', () => { searchQ = si.value; clearTimeout(si._t); si._t = setTimeout(() => renderParticipants().then(() => $('searchInput').focus()), 250); });
  $('addBtn').addEventListener('click', addParticipantPrompt);
  document.querySelectorAll('tr[data-id]').forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector('.tExc').addEventListener('click', async () => {
      const excluded = tr.querySelector('.tExc').textContent.includes(isEn()?'Exclude':'استبعاد');
      await api.patch('/api/admin/participants/' + id, { excluded });
      renderParticipants();
    });
    tr.querySelector('.tDel').addEventListener('click', async () => {
      if (!confirm(t('حذف هذا المشارك؟','Delete this participant?'))) return;
      await api.del('/api/admin/participants/' + id); renderParticipants();
    });
  });
  document.querySelectorAll('.pName').forEach(b => b.addEventListener('click', () => openProfile(b.dataset.id)));
}

// ── Participant profile modal ────────────────────────────
function closeModal() { document.getElementById('ldModal')?.remove(); }

async function openProfile(id) {
  const d = await api.get('/api/admin/participants/' + id);
  if (d.error) return toast(t('تعذّر فتح الملف','Could not open profile'), true);
  const p = d.participant;
  const isPhotog = d.segment === 'photographer';
  const initial = (p.name || '?').trim().charAt(0);
  const dateStr = (p.created_at || '').slice(0, 16);
  const waLink = 'https://wa.me/' + String(p.phone).replace(/[^\d]/g, '');

  const reelEmbed = (u) => { const m = String(u).match(/instagram\.com\/(reel|reels|p|tv)\/([^/?#]+)/i); return m ? `https://www.instagram.com/${m[1]}/${m[2]}/embed` : ''; };
  const reelsHtml = isPhotog ? `
    <div style="margin-top:18px;">
      <div class="eyebrow" style="margin-bottom:10px;display:flex;align-items:center;gap:7px;">${ICON.film}${t('معاينة الريلز','Reel previews')} · ${d.reels.length}</div>
      ${d.reels.length ? `
        <div id="reelTabs" style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
          ${d.reels.map((r, i) => `<button class="reelTab btn-ghost" data-embed="${esc(reelEmbed(r))}" data-url="${esc(r)}" style="padding:8px 16px;font-size:.82rem;${i === 0 ? 'background:var(--surface-chip);color:var(--pill-color);border-color:var(--poslix-accent);' : ''}">${ICON.film}<span style="margin-inline-start:6px;">${t('ريل','Reel')} ${i + 1}</span></button>`).join('')}
        </div>
        <div style="max-width:360px;margin:0 auto;border-radius:16px;overflow:hidden;border:1px solid var(--border-soft);background:#fff;">
          <iframe id="reelFrame" src="${esc(reelEmbed(d.reels[0]))}" width="100%" height="780" frameborder="0" scrolling="no" allowtransparency="true" loading="lazy" style="border:none;display:block;width:100%;"></iframe>
        </div>
        <a id="reelOpen" href="${esc(d.reels[0])}" target="_blank" rel="noopener" class="caption" style="display:inline-block;margin-top:10px;font-weight:600;">${t('فتح في إنستقرام','Open on Instagram')} ${ICON.external}</a>`
        : `<div class="caption">${t('لا توجد روابط','No links')}</div>`}
    </div>` : '';

  const winsHtml = d.wins.length ? `
    <div style="margin-top:18px;">
      <div class="eyebrow" style="margin-bottom:10px;display:flex;align-items:center;gap:7px;">${ICON.trophy}${t('الجوائز','Prizes won')}</div>
      ${d.wins.map(w => `<div class="reel-card" style="border-color:var(--poslix-accent);"><span>${ICON.trophy}</span><div style="flex:1;"><div style="font-weight:600;">${esc(w.prize)}</div><div class="caption">#${w.rank} · ${w.received ? t('تم الاستلام','received') : t('بانتظار الاستلام','pending')}</div></div></div>`).join('')}
    </div>` : '';

  const el = document.createElement('div');
  el.className = 'modal-overlay';
  el.id = 'ldModal';
  el.innerHTML = `
    <div class="modal">
      <div style="padding:24px 24px 18px;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:14px;">
        <div style="width:56px;height:56px;border-radius:16px;background:var(--poslix-brand);color:#fff;display:grid;place-items:center;font-weight:800;font-size:1.4rem;flex:0 0 auto;">${esc(initial)}</div>
        <div style="flex:1;min-width:0;">
          <div class="h3">${esc(p.name)} ${p.won_before ? ICON.trophy : ''}</div>
          <div style="margin-top:4px;"><span class="pill">${segLabel(d.segment)}</span> <span class="caption" style="direction:ltr;">${esc(p.phone)}</span></div>
        </div>
        <button id="mClose" class="btn-ghost" style="width:36px;height:36px;border-radius:999px;display:grid;place-items:center;flex:0 0 auto;">${ICON.close}</button>
      </div>
      <div style="padding:22px 24px;">
        <div class="info-grid">
          <div class="box"><div class="caption">${t('الشق','Track')}</div><div style="font-weight:600;margin-top:2px;">${segLabel(d.segment)}</div></div>
          <div class="box"><div class="caption">${t('المصدر','Source')}</div><div style="font-weight:600;margin-top:2px;">${esc(p.source)}</div></div>
          <div class="box"><div class="caption">${t('تاريخ التسجيل','Registered')}</div><div style="font-weight:600;margin-top:2px;direction:ltr;text-align:start;">${esc(dateStr)}</div></div>
          <div class="box"><div class="caption">${t('الحالة','Status')}</div><div style="font-weight:600;margin-top:2px;color:${p.excluded ? 'var(--status-negative)' : 'var(--status-positive-strong)'};">${p.excluded ? t('مستبعد','Excluded') : t('نشط في السحب','Active')}</div></div>
        </div>
        ${reelsHtml}
        ${winsHtml}
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:22px;">
          <a href="${waLink}" target="_blank" rel="noopener" class="btn-ghost" style="padding:10px 16px;display:inline-flex;align-items:center;gap:7px;">${ICON.chat}${t('واتساب','WhatsApp')}</a>
          <button id="mExc" class="btn-ghost" style="padding:10px 16px;">${p.excluded ? t('إعادة تفعيل','Re-include') : t('استبعاد من السحب','Exclude from draw')}</button>
          <button id="mDel" class="btn-ghost" style="padding:10px 16px;color:var(--status-negative);border-color:rgba(192,73,47,.4);">${t('حذف','Delete')}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target === el) closeModal(); });
  document.getElementById('mClose').addEventListener('click', closeModal);

  // Reel preview switcher
  const frame = document.getElementById('reelFrame');
  if (frame) el.querySelectorAll('.reelTab').forEach(tab => tab.addEventListener('click', () => {
    frame.src = tab.dataset.embed;
    document.getElementById('reelOpen').href = tab.dataset.url;
    el.querySelectorAll('.reelTab').forEach(t2 => t2.style.cssText = 'padding:8px 16px;font-size:.82rem;');
    tab.style.cssText = 'padding:8px 16px;font-size:.82rem;background:var(--surface-chip);color:var(--pill-color);border-color:var(--poslix-accent);';
  }));
  document.getElementById('mExc').addEventListener('click', async () => {
    await api.patch('/api/admin/participants/' + id, { excluded: !p.excluded });
    closeModal(); renderParticipants();
  });
  document.getElementById('mDel').addEventListener('click', async () => {
    if (!confirm(t('حذف هذا المشارك؟','Delete this participant?'))) return;
    await api.del('/api/admin/participants/' + id);
    closeModal(); renderParticipants();
  });
}

async function addParticipantPrompt() {
  const name = prompt(t('اسم المشارك:','Participant name:')); if (!name) return;
  const phone = prompt(t('رقم الهاتف:','Phone number:')); if (!phone) return;
  const r = await api.post('/api/admin/participants' + qs(), { name, phone });
  if (r.ok) { toast(t('تمت الإضافة','Added')); renderParticipants(); }
  else toast(r.status === 409 ? t('الرقم مسجّل مسبقاً','Duplicate phone') : t('خطأ','Error'), true);
}

// ── Setup (multiple draws, one per audience segment) ─────
const typeLabel = segLabel;
let setupSelectedId = null;

async function renderSetup() {
  const { items } = await api.get('/api/admin/campaigns');
  if (!items.length) { $('content').innerHTML = `<div class="caption">${t('لا توجد سحوبات','No draws')}</div>`; return; }
  if (!setupSelectedId || !items.find(c => c.id === setupSelectedId)) {
    setupSelectedId = (items.find(c => c.active) || items[0]).id;
  }
  const c = items.find(x => x.id === setupSelectedId);
  const isActive = !!c.active;

  $('content').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:20px;max-width:900px;">
    <!-- draws list -->
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div class="eyebrow">${t('السحوبات','Draws')} · ${items.length}</div>
        <button id="newDrawBtn" class="btn-primary" style="padding:9px 16px;font-size:.82rem;">${t('+ سحب جديد','+ New draw')}</button>
      </div>
      <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:6px;">
        ${items.map(d => `
          <button class="drawCard" data-id="${d.id}" style="flex:0 0 auto;width:210px;text-align:start;padding:16px;border-radius:16px;border:1.5px solid ${d.id===setupSelectedId?'var(--poslix-accent)':'var(--card-border)'};background:${d.id===setupSelectedId?'var(--surface-chip)':'var(--card-bg)'};box-shadow:var(--shadow-card-light);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
              <span class="caption" style="font-weight:700;">${typeLabel(d.type)}</span>
              ${d.active ? `<span style="font-size:.64rem;font-weight:700;color:#fff;background:var(--status-positive);padding:2px 8px;border-radius:999px;">${t('نشط','LIVE')}</span>` : ''}
            </div>
            <div style="font-weight:700;font-size:.95rem;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(d.name)}</div>
            <div class="caption" style="display:flex;gap:12px;">
              <span style="display:inline-flex;align-items:center;gap:5px;">${ICON.users}${d.participants}</span><span style="display:inline-flex;align-items:center;gap:5px;">${ICON.trophy}${d.winners}/${d.prize_count}</span>
            </div>
          </button>`).join('')}
      </div>
    </div>

    <!-- editor -->
    <div class="card" style="padding:26px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:12px;flex-wrap:wrap;">
        <div class="h3">${t('تفاصيل السحب','Draw details')}</div>
        ${isActive
          ? `<span class="pill" style="background:var(--status-positive-soft);color:var(--status-positive-strong);">${t('السحب النشط حالياً','Currently active')}</span>`
          : `<button id="activateBtn" class="btn-ghost" style="padding:8px 16px;font-size:.82rem;border-color:var(--poslix-accent);color:var(--poslix-accent-strong);">${t('تفعيل هذا السحب','Make this active')}</button>`}
      </div>

      <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('اسم السحب / الحملة','Draw / campaign name')}</label>
      <input id="fName" class="field" value="${esc(c.name||'')}" style="margin-bottom:16px;">

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div><label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('شق الاشتراك','Audience track')}</label>
          <select id="fType" class="field">
            ${SEGMENTS.map(d => `<option value="${d[0]}" ${d[0]===c.type?'selected':''}>${d[3]} ${isEn()?d[2]:d[1]}</option>`).join('')}
          </select></div>
        <div><label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('الجائزة','Prize')}</label>
          <input id="fPrize" class="field" value="${esc(c.prize||'')}"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">
        <div><label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('عدد الفائزين','Number of winners')}</label>
          <input id="fCount" class="field" type="number" min="1" value="${c.prize_count||1}"></div>
        <div><label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('تاريخ السحب','Draw date')}</label>
          <input id="fDate" class="field" type="date" value="${esc(c.draw_date||'')}"></div>
      </div>

      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin:18px 0;">
        <input type="checkbox" id="fExclude" ${c.exclude_prev ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--poslix-accent-strong);">
        <span class="small">${t('استبعاد الفائزين السابقين من السحب','Exclude previous winners from the draw')}</span>
      </label>

      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="saveBtn" class="btn-primary" style="padding:13px 26px;">${t('حفظ الإعدادات','Save settings')}</button>
        <button id="delBtn" class="btn-ghost" style="padding:13px 20px;color:var(--status-negative);border-color:rgba(192,73,47,.4);">${t('حذف السحب','Delete draw')}</button>
      </div>
    </div>
  </div>`;

  document.querySelectorAll('.drawCard').forEach(b => b.addEventListener('click', () => { setupSelectedId = parseInt(b.dataset.id, 10); renderSetup(); }));

  $('newDrawBtn').addEventListener('click', async () => {
    const name = prompt(t('اسم السحب الجديد:', 'New draw name:')); if (!name) return;
    const r = await api.post('/api/admin/campaigns', { name, prize: t('جائزة', 'Prize'), type: 'visitor', prize_count: 1 });
    if (r.ok) { setupSelectedId = r.data.id; toast(t('تم إنشاء السحب', 'Draw created')); await populateDrawSelect(); renderSetup(); }
    else toast(t('خطأ', 'Error'), true);
  });

  $('saveBtn').addEventListener('click', async () => {
    const r = await api.put('/api/admin/campaigns/' + setupSelectedId, {
      name: $('fName').value.trim(), prize: $('fPrize').value.trim(), type: $('fType').value,
      prize_count: parseInt($('fCount').value, 10) || 1,
      draw_date: $('fDate').value, exclude_prev: $('fExclude').checked,
    });
    if (r.ok) { toast(t('تم الحفظ', 'Saved')); await populateDrawSelect(); renderSetup(); } else toast(t('خطأ', 'Error'), true);
  });

  const actBtn = $('activateBtn');
  if (actBtn) actBtn.addEventListener('click', async () => {
    const r = await api.post('/api/admin/campaigns/' + setupSelectedId + '/activate');
    if (r.ok) { toast(t('تم التفعيل', 'Activated')); await populateDrawSelect(); renderSetup(); } else toast(t('خطأ', 'Error'), true);
  });

  $('delBtn').addEventListener('click', async () => {
    if (!confirm(t('حذف هذا السحب وكل مشاركيه وفائزيه؟', 'Delete this draw with all its participants and winners?'))) return;
    const r = await api.del('/api/admin/campaigns/' + setupSelectedId);
    if (r.ok) { setupSelectedId = null; selectedCampaignId = null; toast(t('تم الحذف', 'Deleted')); await populateDrawSelect(); renderSetup(); }
    else toast(r.data?.error === 'cannot-delete-last' ? t('لا يمكن حذف آخر سحب', 'Cannot delete the last draw') : t('خطأ', 'Error'), true);
  });
}

async function renderDashboardCount() {
  const s = await api.get('/api/admin/stats');
  $('navCount').textContent = s.total;
}

// ── Winners ──────────────────────────────────────────────
async function renderWinners() {
  const data = await api.get('/api/admin/winners' + qs());
  $('pageTitle').innerHTML = (isEn() ? 'Winners' : 'الفائزون') + `<span class="pill" style="margin-inline-start:8px;">${segLabel(data.segment)}</span>`;
  $('content').innerHTML = `
  <div class="card" style="overflow:hidden;">
    ${data.items.length ? `
    <div style="overflow-x:auto;"><table>
      <thead><tr><th>#</th><th>${t('الاسم','Name')}</th><th>${t('الهاتف','Phone')}</th><th>${t('الجائزة','Prize')}</th><th>${t('الاستلام','Received')}</th><th></th></tr></thead>
      <tbody>
        ${data.items.map(w => `
          <tr data-id="${w.id}">
            <td style="font-weight:700;color:var(--poslix-accent-strong);">${w.rank}</td>
            <td style="font-weight:600;">${esc(w.name)}</td>
            <td style="direction:ltr;text-align:start;">${esc(w.phone)}</td>
            <td>${esc(w.prize)}</td>
            <td>${w.received ? `<span style="color:var(--status-positive-strong);font-weight:600;">${t('تم','yes')}</span>` : `<span class="caption">${t('بانتظار','pending')}</span>`}</td>
            <td style="white-space:nowrap;">
              <button class="wNotify btn-ghost" style="padding:6px 10px;font-size:.78rem;">${w.notified ? ICON.check : ''}${t('إشعار واتساب','WhatsApp')}</button>
              <button class="wRecv btn-ghost" style="padding:6px 10px;font-size:.78rem;">${w.received ? t('إلغاء','Undo') : t('تم الاستلام','Mark received')}</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table></div>` : `<div style="text-align:center;padding:50px 20px;">
      <div style="margin-bottom:10px;color:var(--poslix-accent);display:flex;justify-content:center;">${svg('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z"/>', 44)}</div>
      <div class="h3" style="margin-bottom:6px;">${t('لا يوجد فائزون بعد','No winners yet')}</div>
      <div class="caption" style="margin-bottom:18px;">${t('افتح شاشة السحب وابدأ السحب المباشر','Open the live screen and run the draw')}</div>
      <a href="/live" target="_blank" class="btn-primary" style="padding:11px 22px;display:inline-block;">${t('فتح شاشة السحب','Open live screen')}</a>
    </div>`}
  </div>`;
  document.querySelectorAll('tr[data-id]').forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector('.wNotify').addEventListener('click', async () => {
      const r = await api.post('/api/admin/winners/' + id + '/notify');
      toast(r.data?.mock ? t('تم الإرسال (وضع تجريبي)','Sent (mock mode)') : r.ok ? t('تم إرسال الإشعار','Notification sent') : t('فشل الإرسال','Send failed'), !r.ok);
      renderWinners();
    });
    tr.querySelector('.wRecv').addEventListener('click', async () => {
      const received = tr.querySelector('.wRecv').textContent.includes(isEn()?'Mark':'الاستلام');
      await api.patch('/api/admin/winners/' + id, { received }); renderWinners();
    });
  });
}

// ── Settings ─────────────────────────────────────────────
async function renderSettings() {
  const c = await api.get('/api/admin/campaign');
  const st = await syncWaStatus();
  const waOn = st.whatsapp?.configured;
  $('content').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:18px;max-width:640px;">
    <div class="card" style="padding:24px;">
      <div class="h3" style="margin-bottom:16px;">${t('الهوية','Branding')}</div>
      <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('اسم المتجر','Store name')}</label>
      <input id="sName" class="field" value="${esc(c.store_name||'')}" style="margin-bottom:16px;">
      <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('حساب انستغرام','Instagram handle')}</label>
      <input id="sHandle" class="field" value="${esc(c.store_handle||'')}" style="direction:ltr;text-align:start;">
      <button id="sSave" class="btn-primary" style="padding:12px 24px;margin-top:18px;">${t('حفظ','Save')}</button>
    </div>
    <div class="card" style="padding:24px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
        <div class="h3">${t('ربط واتساب','WhatsApp integration')}</div>
        <span id="waBadge" style="display:inline-flex;align-items:center;gap:7px;padding:5px 13px;border-radius:999px;font-size:.76rem;font-weight:700;
          background:${waOn ? 'var(--status-positive-soft)' : 'rgba(201,138,30,.16)'};color:${waOn ? 'var(--status-positive-strong)' : 'var(--status-warning)'};">
          <span style="width:8px;height:8px;border-radius:999px;background:currentColor;"></span>
          ${waOn ? t('متصل','Connected') : t('وضع تجريبي','Mock mode')}
        </span>
      </div>

      <div class="caption" style="margin-bottom:16px;">
        ${t('أدخل مفتاح Wasender API لتفعيل الإرسال الفعلي. يُحفظ في قاعدة البيانات ولا يُعرض بعد الحفظ.','Enter your Wasender API key to enable real sending. Stored in the database and never shown again after saving.')}
        <a href="https://wasenderapi.com" target="_blank" rel="noopener" style="font-weight:600;">wasenderapi.com ${ICON.external}</a>
      </div>

      <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('رقم الواتساب المرسِل','Sender WhatsApp number')}</label>
      <input id="waPhone" class="field" value="${esc(st.whatsapp?.phone || '')}" placeholder="+968 9•• •• ••" inputmode="tel"
             style="direction:ltr;text-align:start;margin-bottom:14px;">

      <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('مفتاح API','API key')}</label>
      <div style="display:flex;gap:8px;margin-bottom:14px;">
        <input id="waKey" class="field" type="password" autocomplete="off" spellcheck="false"
               placeholder="${st.whatsapp?.masked ? esc(st.whatsapp.masked) + '  ' + t('(محفوظ)','(saved)') : t('الصق المفتاح هنا','Paste your key here')}"
               style="flex:1;direction:ltr;text-align:start;">
        <button id="waEye" class="btn-ghost" type="button" style="padding:0 14px;" title="${t('إظهار','Show')}">${ICON.eye}</button>
      </div>

      <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('رابط الـ API','API base URL')}</label>
      <input id="waUrl" class="field" value="${esc(st.whatsapp?.baseUrl || 'https://wasenderapi.com/api')}" style="direction:ltr;text-align:start;margin-bottom:18px;">

      <!-- ── Webhook ── -->
      <div style="background:var(--surface-muted);border:1px solid var(--border-subtle);border-radius:14px;padding:16px;margin-bottom:18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
          <div class="eyebrow">Webhook</div>
          ${st.whatsapp?.webhook?.sessionStatus ? `<span class="pill">${t('حالة الجلسة','Session')}: ${esc(st.whatsapp.webhook.sessionStatus)}</span>` : ''}
        </div>
        <div class="caption" style="margin-bottom:10px;">${t('انسخ هذا الرابط والصقه في لوحة Wasender ← Webhooks لاستقبال حالة الجلسة والرسائل.','Copy this URL into the Wasender dashboard → Webhooks to receive session and message events.')}</div>
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <input id="whUrl" class="field" readonly value="${esc(st.whatsapp?.webhook?.url || '')}" style="flex:1;direction:ltr;text-align:start;font-size:.85rem;background:var(--surface-card);">
          <button id="whCopy" class="btn-ghost" type="button" style="padding:0 16px;white-space:nowrap;">${t('نسخ','Copy')}</button>
        </div>
        <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('سر الـ Webhook (من لوحة Wasender)','Webhook secret (from the Wasender dashboard)')}</label>
        <input id="whSecret" class="field" type="password" autocomplete="off" spellcheck="false"
               placeholder="${st.whatsapp?.webhook?.secretSet ? esc(st.whatsapp.webhook.secretMasked) + '  ' + t('(محفوظ)','(saved)') : t('الصق السر هنا للتحقق من الطلبات الواردة','Paste the secret to verify incoming requests')}"
               style="direction:ltr;text-align:start;">
        ${st.whatsapp?.webhook?.lastEvent ? `<div class="caption" style="margin-top:10px;direction:ltr;text-align:start;">✓ ${t('آخر حدث','Last event')}: <b>${esc(st.whatsapp.webhook.lastEvent.event)}</b> · ${esc((st.whatsapp.webhook.lastEvent.at || '').replace('T',' ').slice(0,16))}</div>` : `<div class="caption" style="margin-top:10px;">${t('لم يصل أي حدث بعد — بعد لصق الرابط في Wasender اضغط Test هناك.','No events yet — after pasting the URL in Wasender, hit Test there.')}</div>`}
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="waSave" class="btn-primary" style="padding:12px 24px;">${t('حفظ الربط','Save connection')}</button>
        <button id="waTest" class="btn-ghost" style="padding:12px 20px;">${t('إرسال رسالة تجريبية','Send test message')}</button>
        ${st.whatsapp?.source === 'db' ? `<button id="waClear" class="btn-ghost" style="padding:12px 18px;color:var(--status-negative);border-color:rgba(192,73,47,.4);">${t('حذف المفتاح','Remove key')}</button>` : ''}
      </div>
      ${st.whatsapp?.source === 'env' ? `<div class="caption" style="margin-top:12px;">${t('المفتاح الحالي مقروء من ملف .env — أي مفتاح تحفظه هنا سيَجُبّه.','The current key comes from .env — a key saved here overrides it.')}</div>` : ''}
    </div>

    <!-- ── Message templates ── -->
    <div class="card" style="padding:24px;">
      <div class="h3" style="margin-bottom:6px;">${t('الرسائل النصية','Message templates')}</div>
      <div class="caption" style="margin-bottom:16px;">${t('نص رسائل واتساب التي تُرسَل للمشتركين والفائزين. اضغط على أي متغيّر لإدراجه.','The WhatsApp text sent to entrants and winners. Click a variable to insert it.')}</div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;" id="varChips">
        ${(st.messages?.vars || []).map(v => `<button class="varChip btn-ghost" type="button" data-var="{${v}}" style="padding:6px 12px;font-size:.76rem;font-family:var(--font-mono);direction:ltr;">{${v}}</button>`).join('')}
      </div>

      <label class="small" style="display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:600;margin-bottom:6px;">
        <span>${t('رسالة تأكيد التسجيل','Registration confirmation')}</span>
        <button id="msgResetReg" type="button" class="caption" style="color:var(--poslix-accent-strong);font-weight:600;">${t('استعادة الافتراضي','Restore default')}</button>
      </label>
      <textarea id="msgReg" class="field" rows="4" style="resize:vertical;line-height:1.7;margin-bottom:8px;">${esc(st.messages?.registered || '')}</textarea>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-bottom:20px;">
        <input type="checkbox" id="msgAuto" ${st.messages?.autoRegistered ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--poslix-accent-strong);">
        <span class="small">${t('إرسال رسالة التأكيد تلقائياً عند كل تسجيل','Send the confirmation automatically on every registration')}</span>
      </label>

      <label class="small" style="display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:600;margin-bottom:6px;">
        <span>${t('رسالة إشعار الفائز','Winner notification')}</span>
        <button id="msgResetWin" type="button" class="caption" style="color:var(--poslix-accent-strong);font-weight:600;">${t('استعادة الافتراضي','Restore default')}</button>
      </label>
      <textarea id="msgWin" class="field" rows="4" style="resize:vertical;line-height:1.7;margin-bottom:16px;">${esc(st.messages?.winner || '')}</textarea>

      <div style="background:var(--surface-muted);border:1px solid var(--border-subtle);border-radius:14px;padding:14px 16px;margin-bottom:18px;">
        <div class="eyebrow" style="margin-bottom:8px;">${t('معاينة','Preview')}</div>
        <div id="msgPreview" class="small" style="white-space:pre-wrap;line-height:1.7;color:var(--text-primary);">—</div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="msgSave" class="btn-primary" style="padding:12px 24px;">${t('حفظ الرسائل','Save messages')}</button>
        <button id="msgPrevBtn" class="btn-ghost" style="padding:12px 20px;">${t('تحديث المعاينة','Refresh preview')}</button>
      </div>
    </div>
    <div class="card" style="padding:24px;">
      <div class="h3" style="margin-bottom:12px;">${t('روابط سريعة','Quick links')}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <a href="/" target="_blank" class="btn-ghost" style="padding:10px 16px;">${t('صفحة الاشتراك','Subscribe page')}</a>
        <a href="/kiosk" target="_blank" class="btn-ghost" style="padding:10px 16px;">${t('شاشة الكشك','Kiosk')}</a>
        <a href="/live" target="_blank" class="btn-ghost" style="padding:10px 16px;">${t('شاشة السحب','Live screen')}</a>
      </div>
    </div>
  </div>`;
  $('sSave').addEventListener('click', async () => {
    const r = await api.put('/api/admin/campaign', { store_name: $('sName').value.trim(), store_handle: $('sHandle').value.trim() });
    if (r.ok) toast(t('تم الحفظ','Saved')); else toast(t('خطأ','Error'), true);
  });

  // ── WhatsApp connection ──
  $('waEye').addEventListener('click', () => {
    const f = $('waKey');
    const show = f.type === 'password';
    f.type = show ? 'text' : 'password';
    $('waEye').innerHTML = show ? ICON.eyeOff : ICON.eye;
  });

  $('whCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('whUrl').value);
      toast(t('تم نسخ الرابط ✓','URL copied ✓'));
    } catch { $('whUrl').select(); document.execCommand('copy'); toast(t('تم النسخ ✓','Copied ✓')); }
  });

  $('waSave').addEventListener('click', async () => {
    const key = $('waKey').value.trim();
    const url = $('waUrl').value.trim();
    if (!key && !st.whatsapp?.configured) return toast(t('أدخل مفتاح API أولاً','Enter an API key first'), true);
    const body = { baseUrl: url, phone: $('waPhone').value.trim() };
    if (key) body.apiKey = key;                    // empty = keep the stored key
    const whs = $('whSecret').value.trim();
    if (whs) body.webhookSecret = whs;             // empty = keep the stored secret
    const btn = $('waSave'); btn.disabled = true; btn.style.opacity = '.6';
    const r = await api.put('/api/admin/settings/whatsapp', body);
    btn.disabled = false; btn.style.opacity = '1';
    if (r.ok) { toast(t('تم حفظ الربط','Connection saved')); renderSettings(); }
    else toast(r.data?.error === 'api-key-too-short' ? t('المفتاح قصير جداً','Key too short')
             : r.data?.error === 'base-url-invalid' ? t('رابط غير صالح','Invalid URL')
             : r.data?.error === 'phone-invalid' ? t('رقم الواتساب غير صحيح','Invalid WhatsApp number')
             : t('خطأ','Error'), true);
  });

  $('waTest').addEventListener('click', async () => {
    const phone = prompt(t('رقم الواتساب لإرسال رسالة تجريبية:','WhatsApp number to send a test message:'), '+968');
    if (!phone) return;
    const btn = $('waTest'); btn.disabled = true; btn.style.opacity = '.6';
    const r = await api.post('/api/admin/settings/whatsapp/test', { phone });
    btn.disabled = false; btn.style.opacity = '1';
    if (r.ok && r.data?.mock) toast(t('وضع تجريبي — لم تُرسَل رسالة فعلية','Mock mode — no real message sent'), true);
    else if (r.ok && r.data?.ok) toast(t('تم إرسال الرسالة التجريبية','Test message sent'));
    else toast(t('فشل الإرسال — تحقق من المفتاح','Send failed — check your key'), true);
  });

  const waClear = $('waClear');
  if (waClear) waClear.addEventListener('click', async () => {
    if (!confirm(t('حذف مفتاح الربط والعودة للوضع التجريبي؟','Remove the key and fall back to mock mode?'))) return;
    const r = await api.put('/api/admin/settings/whatsapp', { apiKey: '' });
    if (r.ok) { toast(t('تم حذف المفتاح','Key removed')); renderSettings(); } else toast(t('خطأ','Error'), true);
  });

  // ── Message templates ──
  let lastFocused = $('msgReg');
  [$('msgReg'), $('msgWin')].forEach(el => el.addEventListener('focus', () => { lastFocused = el; }));

  // Insert a {variable} at the caret of whichever textarea was last focused.
  document.querySelectorAll('.varChip').forEach(chip => chip.addEventListener('click', () => {
    const el = lastFocused || $('msgReg');
    const v = chip.dataset.var;
    const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
    el.value = el.value.slice(0, s) + v + el.value.slice(e);
    el.focus();
    el.selectionStart = el.selectionEnd = s + v.length;
    refreshPreview();
  }));

  async function refreshPreview() {
    const r = await api.post('/api/admin/settings/messages/preview', {
      registered: $('msgReg').value, winner: $('msgWin').value,
    });
    if (!r.ok) return;
    $('msgPreview').textContent =
      `— ${t('التسجيل','Registration')} —\n${r.data.registered}\n\n— ${t('الفائز','Winner')} —\n${r.data.winner}`;
  }
  let prevTimer;
  [$('msgReg'), $('msgWin')].forEach(el => el.addEventListener('input', () => {
    clearTimeout(prevTimer); prevTimer = setTimeout(refreshPreview, 350);
  }));
  $('msgPrevBtn').addEventListener('click', refreshPreview);
  refreshPreview();

  $('msgSave').addEventListener('click', async () => {
    const registered = $('msgReg').value.trim(), winner = $('msgWin').value.trim();
    if (!registered || !winner) return toast(t('لا يمكن ترك الرسالة فارغة','Message cannot be empty'), true);
    const btn = $('msgSave'); btn.disabled = true; btn.style.opacity = '.6';
    const r = await api.put('/api/admin/settings/messages', { registered, winner, autoRegistered: $('msgAuto').checked });
    btn.disabled = false; btn.style.opacity = '1';
    if (r.ok) toast(t('تم حفظ الرسائل','Messages saved')); else toast(t('خطأ','Error'), true);
  });

  const resetTo = async (kind) => {
    if (!confirm(t('استعادة النص الافتراضي؟','Restore the default text?'))) return;
    const r = await api.put('/api/admin/settings/messages', { reset: kind });
    if (r.ok) { toast(t('تمت الاستعادة','Restored')); renderSettings(); } else toast(t('خطأ','Error'), true);
  };
  $('msgResetReg').addEventListener('click', () => resetTo('registered'));
  $('msgResetWin').addEventListener('click', () => resetTo('winner'));
}

// ── Admin users ──────────────────────────────────────────
const USER_ERR = {
  'email-taken':    ['البريد مستخدم مسبقاً', 'Email already in use'],
  'email-invalid':  ['البريد الإلكتروني غير صحيح', 'Invalid email'],
  'name-required':  ['الاسم مطلوب', 'Name is required'],
  'password-short': ['كلمة المرور 6 أحرف على الأقل', 'Password must be at least 6 characters'],
  'wrong-password': ['كلمة المرور الحالية غير صحيحة', 'Current password is incorrect'],
  'cannot-delete-self': ['لا يمكنك حذف حسابك', "You can't delete your own account"],
  'cannot-delete-last': ['لا يمكن حذف آخر مستخدم', "Can't delete the last user"],
};
const userErr = (r) => { const m = USER_ERR[r.data?.error]; return m ? t(m[0], m[1]) : t('حدث خطأ', 'Something went wrong'); };

async function renderUsers() {
  const { items, self } = await api.get('/api/admin/users');
  $('content').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:18px;max-width:820px;">
    <div class="card" style="overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px;flex-wrap:wrap;">
        <div class="h3">${t('مديرو النظام','Administrators')} <span class="pill" style="margin-inline-start:6px;">${items.length}</span></div>
        <button id="addUserBtn" class="btn-primary" style="padding:11px 18px;">${t('+ مستخدم جديد','+ New user')}</button>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>${t('المستخدم','User')}</th><th>${t('البريد الإلكتروني','Email')}</th><th>${t('أُنشئ في','Created')}</th><th></th></tr></thead>
          <tbody>
            ${items.map(u => `
              <tr data-id="${u.id}">
                <td>
                  <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:38px;height:38px;border-radius:999px;background:var(--poslix-brand);color:#fff;display:grid;place-items:center;font-weight:700;flex:0 0 auto;">${esc((u.name||'?').trim().charAt(0))}</div>
                    <div style="font-weight:600;">${esc(u.name)} ${u.id === self ? `<span class="pill" style="margin-inline-start:6px;background:var(--status-positive-soft);color:var(--status-positive-strong);">${t('أنت','you')}</span>` : ''}</div>
                  </div>
                </td>
                <td style="direction:ltr;text-align:start;">${esc(u.email)}</td>
                <td class="caption">${esc((u.created_at||'').slice(0,10))}</td>
                <td style="white-space:nowrap;">
                  <button class="uEdit btn-ghost" style="padding:6px 12px;font-size:.78rem;">${t('تعديل','Edit')}</button>
                  ${u.id === self ? '' : `<button class="uDel btn-ghost" style="padding:6px 12px;font-size:.78rem;color:var(--status-negative);border-color:rgba(192,73,47,.4);">${ICON.close}</button>`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="caption">${t('كل مستخدم يملك صلاحيات كاملة على لوحة التحكم وشاشة السحب.','Every user has full access to the dashboard and the live draw screen.')}</div>
  </div>`;

  $('addUserBtn').addEventListener('click', () => userModal(null));
  document.querySelectorAll('tr[data-id]').forEach(tr => {
    const u = items.find(x => x.id === parseInt(tr.dataset.id, 10));
    tr.querySelector('.uEdit').addEventListener('click', () => userModal(u));
    tr.querySelector('.uDel')?.addEventListener('click', async () => {
      if (!confirm(t(`حذف المستخدم "${u.name}"؟`, `Delete user "${u.name}"?`))) return;
      const r = await api.del('/api/admin/users/' + u.id);
      if (r.ok) { toast(t('تم الحذف', 'Deleted')); renderUsers(); } else toast(userErr(r), true);
    });
  });
}

// Add / edit user modal. Pass null to create.
function userModal(user) {
  closeModal();
  const isNew = !user;
  const isSelf = user && me && user.id === me.id;
  const el = document.createElement('div');
  el.className = 'modal-overlay';
  el.id = 'ldModal';
  el.innerHTML = `
    <div class="modal" style="width:min(440px,100%);">
      <div style="padding:22px 24px 16px;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;justify-content:space-between;">
        <div class="h3">${isNew ? t('مستخدم جديد','New user') : t('تعديل المستخدم','Edit user')}</div>
        <button id="mClose" class="btn-ghost" style="width:36px;height:36px;border-radius:999px;display:grid;place-items:center;">${ICON.close}</button>
      </div>
      <div style="padding:22px 24px;">
        <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('الاسم','Name')}</label>
        <input id="uName" class="field" value="${esc(user?.name || '')}" style="margin-bottom:16px;">
        <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('البريد الإلكتروني','Email')}</label>
        <input id="uEmail" class="field" value="${esc(user?.email || '')}" style="margin-bottom:16px;direction:ltr;text-align:start;" inputmode="email">
        <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${isNew ? t('كلمة المرور','Password') : t('كلمة مرور جديدة (اتركها فارغة للإبقاء)','New password (leave empty to keep)')}</label>
        <input id="uPass" class="field" type="password" style="margin-bottom:20px;direction:ltr;text-align:start;" autocomplete="new-password">
        <button id="uSave" class="btn-primary" style="width:100%;padding:13px;">${isNew ? t('إنشاء المستخدم','Create user') : t('حفظ التعديلات','Save changes')}</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target === el) closeModal(); });
  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('uSave').addEventListener('click', async () => {
    const body = {
      name: document.getElementById('uName').value.trim(),
      email: document.getElementById('uEmail').value.trim(),
    };
    const pass = document.getElementById('uPass').value;
    if (isNew || pass) body.password = pass;
    const r = isNew
      ? await api.post('/api/admin/users', body)
      : await api.put('/api/admin/users/' + user.id, body);
    if (r.ok) {
      toast(isNew ? t('تم إنشاء المستخدم','User created') : t('تم الحفظ','Saved'));
      if (isSelf) { me = { ...me, name: body.name, email: body.email }; syncAvatar(); }
      closeModal(); renderUsers();
    } else toast(userErr(r), true);
  });
}

// ── My profile ───────────────────────────────────────────
async function renderProfile() {
  $('content').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:18px;max-width:560px;">
    <div class="card" style="padding:24px;">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:22px;">
        <div style="width:64px;height:64px;border-radius:20px;background:var(--poslix-brand);color:#fff;display:grid;place-items:center;font-weight:800;font-size:1.6rem;" id="pfAvatar">${esc((me?.name||'?').trim().charAt(0))}</div>
        <div>
          <div class="h3">${esc(me?.name || '')}</div>
          <div class="caption" style="direction:ltr;text-align:start;">${esc(me?.email || '')}</div>
        </div>
      </div>
      <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('الاسم','Name')}</label>
      <input id="pfName" class="field" value="${esc(me?.name || '')}" style="margin-bottom:16px;">
      <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('البريد الإلكتروني','Email')}</label>
      <input id="pfEmail" class="field" value="${esc(me?.email || '')}" style="margin-bottom:20px;direction:ltr;text-align:start;" inputmode="email">
      <button id="pfSave" class="btn-primary" style="padding:12px 26px;">${t('حفظ البيانات','Save info')}</button>
    </div>

    <div class="card" style="padding:24px;">
      <div class="h3" style="margin-bottom:16px;">${t('تغيير كلمة المرور','Change password')}</div>
      <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('كلمة المرور الحالية','Current password')}</label>
      <input id="pfCur" class="field" type="password" style="margin-bottom:16px;direction:ltr;text-align:start;" autocomplete="current-password">
      <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('كلمة المرور الجديدة','New password')}</label>
      <input id="pfNew" class="field" type="password" style="margin-bottom:16px;direction:ltr;text-align:start;" autocomplete="new-password">
      <label class="small" style="display:block;font-weight:600;margin-bottom:6px;">${t('تأكيد كلمة المرور الجديدة','Confirm new password')}</label>
      <input id="pfNew2" class="field" type="password" style="margin-bottom:20px;direction:ltr;text-align:start;" autocomplete="new-password">
      <button id="pfPassSave" class="btn-primary" style="padding:12px 26px;">${t('تغيير كلمة المرور','Change password')}</button>
    </div>
  </div>`;

  $('pfSave').addEventListener('click', async () => {
    const r = await api.put('/api/admin/profile', { name: $('pfName').value.trim(), email: $('pfEmail').value.trim() });
    if (r.ok) { me = r.data.admin; syncAvatar(); toast(t('تم الحفظ','Saved')); renderProfile(); }
    else toast(userErr(r), true);
  });

  $('pfPassSave').addEventListener('click', async () => {
    const cur = $('pfCur').value, nw = $('pfNew').value, nw2 = $('pfNew2').value;
    if (!nw) return toast(t('أدخل كلمة المرور الجديدة','Enter the new password'), true);
    if (nw !== nw2) return toast(t('كلمتا المرور غير متطابقتين','Passwords do not match'), true);
    const r = await api.put('/api/admin/profile', { currentPassword: cur, newPassword: nw });
    if (r.ok) { toast(t('تم تغيير كلمة المرور','Password changed')); renderProfile(); }
    else toast(userErr(r), true);
  });
}

boot();
