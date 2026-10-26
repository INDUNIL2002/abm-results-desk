/**
 * server.mjs — ABM Results Desk backend
 * Serves the app + a full admin dashboard with rankings, class categories, semester GPAs.
 * Zero npm dependencies — Node.js built-ins only.
 */
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DIST  = path.join(__dir, 'dist');
const DATA  = path.join(__dir, 'data');
const DB    = path.join(DATA, 'submissions.json');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = 'abm2021';          // change this!
const PORT           = process.env.PORT || 4173;

// Degree classification thresholds (University of Ruhuna standard)
const CLASSES = [
  { label: 'First Class',           short: '1st',    min: 3.70, color: '#1d6b3e', bg: '#e8f5e9', border: '#66bb6a' },
  { label: 'Second Class (Upper)',   short: '2U',     min: 3.30, color: '#5c6b1a', bg: '#f9fbe7', border: '#aed581' },
  { label: 'Second Class (Lower)',   short: '2L',     min: 3.00, color: '#7b5a0f', bg: '#fff8e1', border: '#ffca28' },
  { label: 'Pass',                   short: 'Pass',   min: 2.00, color: '#6a4b7a', bg: '#f3e5f5', border: '#ce93d8' },
  { label: 'Fail / Incomplete',      short: 'Fail',   min: 0,    color: '#9a3d31', bg: '#fde8e8', border: '#ef9a9a' },
];

function classify(cgpa) {
  if (cgpa == null) return null;
  for (const c of CLASSES) { if (cgpa >= c.min) return c; }
  return CLASSES[CLASSES.length - 1];
}

const SEMESTERS_ORDERED = ['Orientation','1-I','1-II','2-I','2-II','3-I','3-II','4-I','4-II'];
const SEM_LABELS = {
  'Orientation': 'Ori', '1-I': 'Y1·S1', '1-II': 'Y1·S2',
  '2-I': 'Y2·S1', '2-II': 'Y2·S2', '3-I': 'Y3·S1',
  '3-II': 'Y3·S2', '4-I': 'Y4·S1', '4-II': 'Y4·S2',
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};

// ── DB helpers ────────────────────────────────────────────────────────────────
async function loadDB() {
  try { return JSON.parse(await readFile(DB, 'utf8')); } catch { return []; }
}
async function saveDB(rows) {
  if (!existsSync(DATA)) await mkdir(DATA, { recursive: true });
  await writeFile(DB, JSON.stringify(rows, null, 2), 'utf8');
}

// ── Body + response helpers ───────────────────────────────────────────────────
function readBody(req) {
  return new Promise((res, rej) => {
    const c = []; req.on('data', d => c.push(d)); req.on('end', () => res(Buffer.concat(c).toString('utf8'))); req.on('error', rej);
  });
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => n == null ? '—' : Number(n).toFixed(d);

// ── Session store ─────────────────────────────────────────────────────────────
const SESSIONS = new Set();
function isLoggedIn(req) {
  const m = (req.headers.cookie || '').match(/abm_admin=([^;]+)/);
  return m && SESSIONS.has(m[1]);
}
function makeSession(res) {
  const t = Math.random().toString(36).slice(2) + Date.now().toString(36);
  SESSIONS.add(t);
  res.setHeader('Set-Cookie', `abm_admin=${t}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=86400`);
}
function clearSession(req, res) {
  const m = (req.headers.cookie || '').match(/abm_admin=([^;]+)/);
  if (m) SESSIONS.delete(m[1]);
  res.setHeader('Set-Cookie', 'abm_admin=; Path=/admin; Max-Age=0');
}

// ── CSV export ────────────────────────────────────────────────────────────────
function toCSV(rows) {
  const sorted = [...rows].sort((a, b) => (b.cgpa ?? -1) - (a.cgpa ?? -1));
  const p = v => { let t = String(v ?? ''); if (/^[=+@-]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
  const semCols = SEMESTERS_ORDERED.filter(s => s !== 'Orientation');
  const header = ['Rank', 'Name', 'Registration', 'Batch', 'Results Up To', 'CGPA', 'Degree Class',
    'GPA Credits', 'Courses Graded', ...semCols.map(s => `${SEM_LABELS[s]} GPA`), 'Submitted'];
  const data = sorted.map((r, i) => {
    const cls = classify(r.cgpa);
    const semMap = Object.fromEntries((r.semesters || []).map(s => [s.semester, s.gpa]));
    return [i + 1, r.name, r.registration, r.batch, r.resultsThrough,
      r.cgpa != null ? r.cgpa.toFixed(2) : '', cls?.label || '',
      r.credits, r.gradedCount,
      ...semCols.map(s => semMap[s] != null ? semMap[s].toFixed(2) : ''),
      r.submittedAt ? new Date(r.submittedAt).toISOString() : ''];
  });
  return '\uFEFF' + [header, ...data].map(r => r.map(p).join(',')).join('\r\n');
}

// ── Admin HTML ────────────────────────────────────────────────────────────────
function adminPage(rows, mode = 'dash') {
  if (mode === 'login' || mode === 'wrong') return loginPage(mode === 'wrong');

  const sorted = [...rows].sort((a, b) => {
    if (a.cgpa == null && b.cgpa == null) return 0;
    if (a.cgpa == null) return 1; if (b.cgpa == null) return -1;
    return b.cgpa - a.cgpa;
  });

  // Stats
  const withGpa  = sorted.filter(r => r.cgpa != null);
  const avg      = withGpa.length ? (withGpa.reduce((s, r) => s + r.cgpa, 0) / withGpa.length) : null;
  const top      = withGpa[0]?.cgpa ?? null;
  const classCounts = Object.fromEntries(CLASSES.map(c => [c.label, 0]));
  sorted.forEach(r => { const c = classify(r.cgpa); if (c) classCounts[c.label]++; });

  // Determine which semesters have any data
  const activeSems = SEMESTERS_ORDERED.filter(s =>
    s !== 'Orientation' && sorted.some(r => (r.semesters || []).some(x => x.semester === s))
  );

  // Top 3 podium
  const podium = sorted.slice(0, Math.min(3, sorted.length));
  const medal  = i => ['🥇', '🥈', '🥉'][i] || '';

  // Class badge HTML
  const badge = (cgpa) => {
    const c = classify(cgpa);
    if (!c) return '<span class="badge badge-none">No data</span>';
    return `<span class="badge" style="background:${c.bg};color:${c.color};border-color:${c.border}">${c.label}</span>`;
  };

  // GPA chip color
  const gpaColor = (gpa) => {
    if (gpa == null) return '#aaa';
    if (gpa >= 3.70) return '#1d6b3e';
    if (gpa >= 3.30) return '#5c6b1a';
    if (gpa >= 2.70) return '#7b5a0f';
    if (gpa >= 2.00) return '#6a4b7a';
    return '#9a3d31';
  };

  // Rows HTML
  const tableRows = sorted.map((r, i) => {
    const semMap = Object.fromEntries((r.semesters || []).map(s => [s.semester, s]));
    const cls    = classify(r.cgpa);
    const date   = r.submittedAt ? new Date(r.submittedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    return `<tr class="data-row${i < 3 && r.cgpa != null ? ' top-row' : ''}">
      <td class="rank-cell"><strong>${medal(i) || (i + 1)}</strong></td>
      <td class="name-cell">
        <div class="name">${esc(r.name)}</div>
        <div class="reg">${esc(r.registration)}</div>
      </td>
      <td class="gpa-cell"><strong style="color:${gpaColor(r.cgpa)};font-size:18px;font-variant-numeric:tabular-nums">${fmt(r.cgpa)}</strong></td>
      <td class="class-cell">${badge(r.cgpa)}</td>
      ${activeSems.map(s => {
        const sd = semMap[s];
        return `<td class="sem-cell">${sd?.gpa != null
          ? `<span style="color:${gpaColor(sd.gpa)};font-weight:600">${sd.gpa.toFixed(2)}</span><br><small>${sd.credits}cr</small>`
          : '<span style="color:#ccc">—</span>'}</td>`;
      }).join('')}
      <td class="num-cell">${r.credits ?? '—'}</td>
      <td class="num-cell">${r.gradedCount ?? '—'}</td>
      <td class="batch-cell">${esc(r.batch || '—')}</td>
      <td class="date-cell">${date}</td>
    </tr>`;
  }).join('');

  // Class summary rows
  const classSummary = CLASSES.map(c => {
    const count = classCounts[c.label];
    const pct   = sorted.length ? Math.round((count / sorted.length) * 100) : 0;
    return `<div class="class-card" style="border-left-color:${c.border}">
      <div class="class-header">
        <span class="class-badge" style="background:${c.bg};color:${c.color};border-color:${c.border}">${c.label}</span>
        <span class="class-range" style="color:${c.color}">GPA ≥ ${c.min.toFixed(2)}</span>
      </div>
      <div class="class-count">${count}</div>
      <div class="class-pct">
        <div class="pct-bar"><div class="pct-fill" style="width:${pct}%;background:${c.border}"></div></div>
        <span>${pct}% of batch</span>
      </div>
    </div>`;
  }).join('');

  // Podium HTML
  const podiumHTML = podium.length ? podium.map((r, i) => `
    <div class="podium-card podium-${i + 1}">
      <div class="podium-medal">${medal(i)}</div>
      <div class="podium-rank">${['1st Place', '2nd Place', '3rd Place'][i]}</div>
      <div class="podium-name">${esc(r.name)}</div>
      <div class="podium-reg">${esc(r.registration)}</div>
      <div class="podium-gpa">${r.cgpa != null ? r.cgpa.toFixed(2) : '—'}</div>
      ${badge(r.cgpa)}
    </div>`).join('') : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ABM Admin — Batch Results</title>
  <style>
    :root {
      --green:#183f32; --mint:#e8eee3; --line:#dedfd4; --muted:#6e776f;
      --paper:#f7f6f0; --white:#fffefa; --ink:#21392f;
      font-family:"Segoe UI",Arial,sans-serif; font-size:14px;
    }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); }
    [hidden] { display:none !important; }

    /* ── Header ── */
    header {
      background:var(--green); color:#fff; padding:16px 32px;
      display:flex; align-items:center; justify-content:space-between; gap:20px;
      position:sticky; top:0; z-index:100;
    }
    .header-brand { display:flex; align-items:center; gap:14px; }
    .brand-icon {
      height:36px; width:36px; display:inline-flex; align-items:center; justify-content:center;
      background:rgba(255,255,255,.15); color:#c9ebb7; border-radius:9px 9px 3px 9px;
      font:italic 32px/1 Georgia,serif; padding-bottom:4px;
    }
    .header-title { font-size:17px; font-weight:600; }
    .header-sub   { font-size:11px; color:#9ccfb2; margin-top:1px; }
    .header-actions { display:flex; align-items:center; gap:10px; }
    .admin-pill { background:#7c3aed; font-size:10px; font-weight:700; letter-spacing:1px; padding:4px 11px; border-radius:20px; }
    .hbtn { background:rgba(255,255,255,.12); border:0; color:#fff; border-radius:6px; padding:7px 14px; font:inherit; font-size:12px; font-weight:600; cursor:pointer; }
    .hbtn:hover { background:rgba(255,255,255,.22); }
    .hbtn.green { background:#2e7d32; }
    .hbtn.green:hover { background:#388e3c; }

    /* ── Layout ── */
    .shell { max-width:1400px; margin:0 auto; padding:28px 32px; }
    .eyebrow { font-size:9px; font-weight:700; letter-spacing:1.8px; color:var(--muted); margin-bottom:8px; }
    h1 { font-family:Georgia,serif; font-size:clamp(28px,3vw,40px); font-weight:400; letter-spacing:-1.5px; margin:0 0 4px; }
    h2 { font-size:17px; font-weight:600; margin:0 0 16px; }
    h1 em { color:#5d7655; }

    /* ── Stat cards ── */
    .stats-row { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:28px; }
    .stat { background:var(--white); border:1px solid var(--line); border-radius:9px; padding:18px 20px; }
    .stat.main { background:var(--green); color:#fff; border-color:var(--green); }
    .stat-label { font-size:9px; font-weight:700; letter-spacing:1.4px; color:var(--muted); }
    .stat.main .stat-label { color:#9ccfb2; }
    .stat-value { font-size:34px; font-weight:500; letter-spacing:-1px; margin-top:10px; font-variant-numeric:tabular-nums; line-height:1; }
    .stat-sub { font-size:11px; color:var(--muted); margin-top:6px; }
    .stat.main .stat-sub { color:#9ccfb2; }

    /* ── Podium ── */
    .podium-section { margin-bottom:32px; }
    .podium-grid { display:flex; gap:16px; align-items:flex-end; flex-wrap:wrap; }
    .podium-card {
      flex:1; min-width:180px; max-width:280px;
      background:var(--white); border:1px solid var(--line); border-radius:12px;
      padding:20px; text-align:center; transition:transform .15s;
    }
    .podium-card:hover { transform:translateY(-3px); }
    .podium-1 { border-color:#f9c74f; box-shadow:0 4px 20px rgba(249,199,79,.2); }
    .podium-2 { border-color:#c9d6df; box-shadow:0 4px 16px rgba(0,0,0,.06); }
    .podium-3 { border-color:#e8b49a; box-shadow:0 4px 16px rgba(0,0,0,.06); }
    .podium-medal { font-size:36px; line-height:1; margin-bottom:8px; }
    .podium-rank  { font-size:10px; font-weight:700; letter-spacing:1px; color:var(--muted); margin-bottom:6px; }
    .podium-name  { font-size:15px; font-weight:700; margin-bottom:2px; }
    .podium-reg   { font-size:11px; color:var(--muted); margin-bottom:12px; }
    .podium-gpa   { font-size:32px; font-weight:500; letter-spacing:-1px; font-variant-numeric:tabular-nums; margin-bottom:10px; }

    /* ── Class summary ── */
    .class-section { margin-bottom:32px; }
    .class-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; }
    .class-card { background:var(--white); border:1px solid var(--line); border-left:4px solid; border-radius:9px; padding:16px 18px; }
    .class-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
    .class-badge { font-size:11px; font-weight:700; padding:3px 9px; border-radius:12px; border:1px solid; }
    .class-range { font-size:10px; font-weight:600; }
    .class-count { font-size:36px; font-weight:500; letter-spacing:-1px; font-variant-numeric:tabular-nums; }
    .class-pct { display:flex; align-items:center; gap:8px; margin-top:8px; font-size:11px; color:var(--muted); }
    .pct-bar { flex:1; height:4px; background:#eee; border-radius:2px; overflow:hidden; }
    .pct-fill { height:100%; border-radius:2px; transition:width .4s; }

    /* ── Full table ── */
    .table-section { margin-bottom:32px; }
    .table-controls { display:flex; align-items:center; gap:12px; margin-bottom:14px; flex-wrap:wrap; }
    .search-input { flex:1; min-width:200px; max-width:340px; height:38px; border:1px solid var(--line); border-radius:6px; padding:8px 12px; font:inherit; font-size:13px; background:var(--white); }
    .filter-select { height:38px; border:1px solid var(--line); border-radius:6px; padding:0 10px; font:inherit; font-size:13px; background:var(--white); }
    .table-wrap { overflow-x:auto; border-radius:9px; border:1px solid var(--line); }
    table { width:100%; border-collapse:collapse; background:var(--white); min-width:900px; }
    thead th { background:var(--mint); text-align:left; padding:11px 13px; font-size:10px; font-weight:700; letter-spacing:.5px; color:#3a5c44; white-space:nowrap; position:sticky; top:0; }
    td { padding:11px 13px; border-top:1px solid var(--line); vertical-align:middle; }
    .data-row:hover td { background:#f5f9f3; }
    .top-row:nth-of-type(1) td { background:linear-gradient(90deg,rgba(249,199,79,.07),transparent); }
    .rank-cell { font-size:18px; width:48px; text-align:center; }
    .name-cell .name { font-weight:600; font-size:13px; }
    .name-cell .reg  { font-size:11px; color:var(--muted); }
    .gpa-cell { white-space:nowrap; }
    .class-cell { white-space:nowrap; }
    .sem-cell { text-align:center; font-size:12px; line-height:1.3; white-space:nowrap; }
    .sem-cell small { color:var(--muted); font-size:10px; }
    .num-cell { text-align:center; color:var(--muted); }
    .batch-cell { font-size:12px; color:var(--muted); }
    .date-cell { font-size:11px; color:var(--muted); white-space:nowrap; }
    .empty { text-align:center; padding:60px; color:var(--muted); }

    /* ── Badge ── */
    .badge { display:inline-block; font-size:10px; font-weight:700; padding:3px 9px; border-radius:12px; border:1px solid; white-space:nowrap; }
    .badge-none { background:#f0f0f0; color:#999; border-color:#ddd; }

    /* ── Responsive ── */
    @media(max-width:900px) {
      .stats-row { grid-template-columns:repeat(2,1fr); }
      .class-grid { grid-template-columns:repeat(2,1fr); }
      .shell { padding:20px 16px; }
    }
  </style>
</head>
<body>

<header>
  <div class="header-brand">
    <span class="brand-icon">a</span>
    <div>
      <div class="header-title">ABM Results Desk — Admin</div>
      <div class="header-sub">University of Ruhuna · Faculty of Agriculture · Agribusiness Management</div>
    </div>
  </div>
  <div class="header-actions">
    <span class="admin-pill">ADMIN</span>
    <a href="/admin/export" class="hbtn green">⬇ Export CSV</a>
    <form method="POST" action="/admin/logout" style="display:inline">
      <button type="submit" class="hbtn">Sign out</button>
    </form>
  </div>
</header>

<div class="shell">

  <!-- Page title -->
  <div style="margin-bottom:24px">
    <p class="eyebrow">BATCH ACADEMIC RECORD</p>
    <h1>Results <em>dashboard.</em></h1>
  </div>

  <!-- Summary stats -->
  <div class="stats-row">
    <div class="stat main">
      <div class="stat-label">TOTAL SUBMISSIONS</div>
      <div class="stat-value">${sorted.length}</div>
      <div class="stat-sub">students in record</div>
    </div>
    <div class="stat">
      <div class="stat-label">AVERAGE CGPA</div>
      <div class="stat-value">${fmt(avg)}</div>
      <div class="stat-sub">batch average</div>
    </div>
    <div class="stat">
      <div class="stat-label">HIGHEST CGPA</div>
      <div class="stat-value">${fmt(top)}</div>
      <div class="stat-sub">top performer</div>
    </div>
    <div class="stat">
      <div class="stat-label">FIRST CLASS</div>
      <div class="stat-value" style="color:#1d6b3e">${classCounts['First Class']}</div>
      <div class="stat-sub">students (GPA ≥ 3.70)</div>
    </div>
    <div class="stat">
      <div class="stat-label">SECOND CLASS+</div>
      <div class="stat-value" style="color:#5c6b1a">${classCounts['Second Class (Upper)'] + classCounts['Second Class (Lower)']}</div>
      <div class="stat-sub">students (GPA ≥ 2.70)</div>
    </div>
  </div>

  ${podium.length ? `
  <!-- Podium: Top 3 -->
  <div class="podium-section">
    <h2>🏆 Top Performers</h2>
    <div class="podium-grid">${podiumHTML}</div>
  </div>` : ''}

  <!-- Degree class breakdown -->
  <div class="class-section">
    <h2>Degree Class Distribution</h2>
    <div class="class-grid">${classSummary}</div>
  </div>

  <!-- Full ranking table -->
  <div class="table-section">
    <h2>Full Batch Ranking</h2>
    <div class="table-controls">
      <input type="search" class="search-input" id="search-input" placeholder="Search by name or registration…" oninput="filterTable()">
      <select class="filter-select" id="class-filter" onchange="filterTable()">
        <option value="">All classes</option>
        ${CLASSES.map(c => `<option value="${c.label}">${c.label}</option>`).join('')}
      </select>
      <span id="row-count" style="font-size:12px;color:var(--muted)"></span>
    </div>
    <div class="table-wrap">
      <table id="results-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Student</th>
            <th>CGPA</th>
            <th>Class</th>
            ${activeSems.map(s => `<th title="${s}">${SEM_LABELS[s]}</th>`).join('')}
            <th>Credits</th>
            <th>Courses</th>
            <th>Batch</th>
            <th>Submitted</th>
          </tr>
        </thead>
        <tbody id="table-body">
          ${sorted.length === 0
            ? '<tr><td colspan="20" class="empty">No submissions yet. Share the app link with your batchmates.</td></tr>'
            : tableRows}
        </tbody>
      </table>
    </div>
  </div>

  <p style="font-size:11px;color:var(--muted);margin-top:8px">
    Degree classifications are based on standard University of Ruhuna grading:
    First Class ≥ 3.70 · Second Class Upper ≥ 3.30 · Second Class Lower ≥ 2.70 · Pass ≥ 2.00.
    Data reflects students' latest submission.
  </p>
</div>

<script>
  function filterTable() {
    const q   = document.getElementById('search-input').value.toLowerCase().trim();
    const cls = document.getElementById('class-filter').value;
    const rows = document.querySelectorAll('#table-body tr.data-row');
    let visible = 0;
    rows.forEach(row => {
      const text  = row.textContent.toLowerCase();
      const badge = row.querySelector('.badge')?.textContent || '';
      const matchQ   = !q   || text.includes(q);
      const matchCls = !cls || badge.includes(cls);
      row.hidden = !(matchQ && matchCls);
      if (!row.hidden) visible++;
    });
    document.getElementById('row-count').textContent = q || cls ? \`Showing \${visible} of \${rows.length}\` : \`\${rows.length} students\`;
  }
  filterTable();
</script>
</body>
</html>`;
}

function loginPage(wrong = false) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ABM Admin — Sign in</title>
  <style>
    :root { font-family:"Segoe UI",Arial,sans-serif; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
      background:linear-gradient(135deg,#0f2b22,#183f32,#1e5240); }
    .card { background:#fffefa; border-radius:16px; padding:40px 44px; width:100%; max-width:380px; box-shadow:0 24px 80px rgba(0,0,0,.35); }
    .brand { display:flex; align-items:center; gap:14px; margin-bottom:28px; }
    .bi { height:38px; width:38px; display:inline-flex; align-items:center; justify-content:center;
      background:#183f32; color:#d8e8a7; border-radius:10px 10px 3px 10px; font:italic 34px/1 Georgia,serif; padding-bottom:5px; }
    .bn { font-size:16px; } .bn strong { font-weight:500; }
    .bs { font-size:11px; color:#6e776f; margin-top:2px; }
    h2 { margin:0 0 22px; font-size:22px; font-weight:600; letter-spacing:-.5px; }
    label { display:flex; flex-direction:column; gap:7px; font-size:11px; font-weight:600; color:#546352; margin-bottom:16px; }
    input { width:100%; min-height:44px; border:1px solid #d9ddcf; border-radius:6px; padding:10px 12px; font:inherit; font-size:14px; }
    input:focus { outline:3px solid #57836c; border-color:#6f9275; }
    button { width:100%; min-height:44px; background:#183f32; color:#fff; border:0; border-radius:7px; font:inherit; font-weight:600; font-size:14px; cursor:pointer; }
    button:hover { background:#24553f; }
    .err { background:#fff3f0; border:1px solid #e8bdb7; border-left:3px solid #c0392b; border-radius:5px; padding:10px 13px; font-size:12px; color:#7a2c22; margin-bottom:14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <span class="bi">a</span>
      <div><div class="bn">ABM <strong>Results Desk</strong></div><div class="bs">Admin access only</div></div>
    </div>
    <h2>Admin sign in</h2>
    ${wrong ? '<p class="err">Wrong password. Try again.</p>' : ''}
    <form method="POST" action="/admin">
      <label>Admin password<input type="password" name="password" autofocus required placeholder="Enter admin password"></label>
      <button type="submit">Sign in →</button>
    </form>
  </div>
</body>
</html>`;
}

// ── HTTP server ───────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const url    = new URL(req.url, 'http://localhost');
  const method = req.method.toUpperCase();

  // API: submit results
  if (url.pathname === '/api/submit' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.name || !body.registration) { json(res, 400, { error: 'Name and registration are required.' }); return; }
      const rows = await loadDB();
      const idx  = rows.findIndex(r => r.registration?.trim().toLowerCase() === body.registration.trim().toLowerCase());
      const entry = {
        name:           String(body.name).slice(0, 120),
        registration:   String(body.registration).slice(0, 60),
        batch:          String(body.batch || '').slice(0, 40),
        resultsThrough: String(body.resultsThrough || '').slice(0, 80),
        cgpa:           typeof body.cgpa === 'number' ? body.cgpa : null,
        credits:        typeof body.credits === 'number' ? body.credits : null,
        gradedCount:    typeof body.gradedCount === 'number' ? body.gradedCount : null,
        semesters:      Array.isArray(body.semesters) ? body.semesters.slice(0, 10).map(s => ({
          semester:    String(s.semester || ''),
          gpa:         typeof s.gpa === 'number' ? s.gpa : null,
          credits:     typeof s.credits === 'number' ? s.credits : null,
          gradedCount: typeof s.gradedCount === 'number' ? s.gradedCount : null,
        })) : [],
        submittedAt: new Date().toISOString(),
      };
      if (idx >= 0) rows[idx] = entry; else rows.push(entry);
      await saveDB(rows);
      json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: 'Invalid request.' }); }
    return;
  }

  // Admin: logout
  if (url.pathname === '/admin/logout') {
    clearSession(req, res); res.writeHead(302, { Location: '/admin' }); res.end(); return;
  }

  // Admin: CSV export
  if (url.pathname === '/admin/export') {
    if (!isLoggedIn(req)) { res.writeHead(302, { Location: '/admin' }); res.end(); return; }
    const rows = await loadDB();
    res.writeHead(200, { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': 'attachment;filename="abm-batch-results.csv"' });
    res.end(toCSV(rows)); return;
  }

  // Admin: GET
  if (url.pathname === '/admin' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
    if (!isLoggedIn(req)) { res.end(loginPage()); return; }
    res.end(adminPage(await loadDB())); return;
  }

  // Admin: POST (login)
  if (url.pathname === '/admin' && method === 'POST') {
    const params = new URLSearchParams(await readBody(req));
    if (params.get('password') === ADMIN_PASSWORD) {
      makeSession(res); res.writeHead(302, { Location: '/admin' }); res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); res.end(loginPage(true));
    }
    return;
  }

  // Static files
  try {
    const pathname = decodeURIComponent(url.pathname);
    const file     = path.resolve(DIST, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(DIST + path.sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }

}).listen(PORT, '0.0.0.0', () => console.log(`\n  ABM Results Desk running!\n\n  App:   http://127.0.0.1:${PORT}\n  Admin: http://127.0.0.1:${PORT}/admin\n`));
