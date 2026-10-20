
import {
  fetchSubmissionsFromSupabase,
  upsertSubmissionToSupabase,
  deleteSubmissionFromSupabase
} from '/supabase.mjs';

const ADMIN_PASSWORD = 'abm2021';
const CLASSES = [
  { label: 'First Class',           min: 3.70, color: '#1d6b3e', bg: '#e8f5e9', border: '#66bb6a' },
  { label: 'Second Class (Upper)',   min: 3.30, color: '#5c6b1a', bg: '#f9fbe7', border: '#aed581' },
  { label: 'Second Class (Lower)',   min: 2.70, color: '#7b5a0f', bg: '#fff8e1', border: '#ffca28' },
  { label: 'Pass',                   min: 2.00, color: '#6a4b7a', bg: '#f3e5f5', border: '#ce93d8' },
  { label: 'Fail / Incomplete',      min: 0,    color: '#9a3d31', bg: '#fde8e8', border: '#ef9a9a' },
];

function classify(cgpa) {
  if (cgpa == null || cgpa === '') return null;
  const val = Number(cgpa);
  for (const c of CLASSES) { if (val >= c.min) return c; }
  return CLASSES[CLASSES.length - 1];
}

const SEMESTERS_ORDERED = ['1-I','1-II','2-I','2-II','3-I','3-II','4-I','4-II'];
const SEM_LABELS = {
  '1-I': 'Year 1 · Semester I',
  '1-II': 'Year 1 · Semester II',
  '2-I': 'Year 2 · Semester I',
  '2-II': 'Year 2 · Semester II',
  '3-I': 'Year 3 · Semester I',
  '3-II': 'Year 3 · Semester II',
  '4-I': 'Year 4 · Semester I',
  '4-II': 'Year 4 · Semester II',
};
const SEM_SHORT = {
  '1-I': 'Y1·S1', '1-II': 'Y1·S2', '2-I': 'Y2·S1', '2-II': 'Y2·S2',
  '3-I': 'Y3·S1', '3-II': 'Y3·S2', '4-I': 'Y4·S1', '4-II': 'Y4·S2',
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => n == null || n === '' ? '—' : Number(n).toFixed(d);

let allRows = [];
let editingReg = null;
let currentViewStudent = null;

async function loadDashboard() {
  try {
    allRows = await fetchSubmissionsFromSupabase();
  } catch (err) {
    console.error('Supabase fetch failed:', err);
    try {
      const res = await fetch('/data/submissions.json');
      if (res.ok) allRows = await res.json();
    } catch {}
  }

  // Sort by CGPA desc
  allRows.sort((a, b) => {
    if (a.cgpa == null && b.cgpa == null) return 0;
    if (a.cgpa == null) return 1;
    if (b.cgpa == null) return -1;
    return b.cgpa - a.cgpa;
  });

  renderDashboardView();
}

function renderDashboardView() {
  const withGpa = allRows.filter(r => r.cgpa != null && r.cgpa !== '');
  const avg = withGpa.length ? (withGpa.reduce((s, r) => s + Number(r.cgpa), 0) / withGpa.length) : null;
  const top = withGpa[0]?.cgpa ?? null;

  const classCounts = Object.fromEntries(CLASSES.map(c => [c.label, 0]));
  allRows.forEach(r => { const c = classify(r.cgpa); if (c) classCounts[c.label]++; });

  document.getElementById('stat-total').textContent = allRows.length;
  document.getElementById('stat-avg').textContent = fmt(avg);
  document.getElementById('stat-top').textContent = fmt(top);
  document.getElementById('stat-first').textContent = classCounts['First Class'];
  document.getElementById('stat-second').textContent = classCounts['Second Class (Upper)'] + classCounts['Second Class (Lower)'];

  // Podium
  const podium = allRows.slice(0, Math.min(3, allRows.length));
  const medal = i => ['🥇', '🥈', '🥉'][i] || '';
  const podiumSec = document.getElementById('podium-section');
  if (podium.length && podium[0].cgpa != null) {
    podiumSec.hidden = false;
    document.getElementById('podium-grid').innerHTML = podium.map((r, i) => {
      const c = classify(r.cgpa);
      return `
        <div class="podium-card podium-${i + 1}" data-action="view" data-reg="${esc(r.registration)}" title="Click to view full record">
          <div class="podium-medal">${medal(i)}</div>
          <div class="podium-rank">${['1st Place', '2nd Place', '3rd Place'][i]}</div>
          <div class="podium-name">${esc(r.name)}</div>
          <div class="podium-reg">${esc(r.registration)}</div>
          <div class="podium-gpa">${r.cgpa != null ? Number(r.cgpa).toFixed(2) : '—'}</div>
          <span class="badge" style="background:${c.bg};color:${c.color};border-color:${c.border}">${c.label}</span>
        </div>
      `;
    }).join('');
  } else {
    podiumSec.hidden = true;
  }

  // Class Summary
  document.getElementById('class-grid').innerHTML = CLASSES.map(c => {
    const count = classCounts[c.label];
    const pct = allRows.length ? Math.round((count / allRows.length) * 100) : 0;
    return `
      <div class="class-card" style="border-left-color:${c.border}">
        <div class="class-header">
          <span class="class-badge" style="background:${c.bg};color:${c.color};border-color:${c.border}">${c.label}</span>
          <span class="class-range" style="color:${c.color}">GPA ≥ ${c.min.toFixed(2)}</span>
        </div>
        <div class="class-count">${count}</div>
        <div class="class-pct">
          <div class="pct-bar"><div class="pct-fill" style="width:${pct}%;background:${c.border}"></div></div>
          <span>${pct}% of batch</span>
        </div>
      </div>
    `;
  }).join('');

  // Active sems
  const activeSems = SEMESTERS_ORDERED.filter(s =>
    allRows.some(r => (r.semesters || []).some(x => x.semester === s && x.gpa != null))
  );

  // Table header
  document.getElementById('table-head').innerHTML = `
    <tr>
      <th>#</th>
      <th>Student</th>
      <th>CGPA</th>
      <th>Class</th>
      ${activeSems.map(s => `<th>${SEM_SHORT[s]}</th>`).join('')}
      <th>Credits</th>
      <th>Batch</th>
      <th>Submitted</th>
      <th style="text-align:center">Actions</th>
    </tr>
  `;

  // Table rows
  const tbody = document.getElementById('table-body');
  if (!allRows.length) {
    tbody.innerHTML = `<tr><td colspan="15" style="text-align:center;padding:40px;color:var(--muted)">No student submissions found in database yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = allRows.map((r, i) => {
    const semMap = Object.fromEntries((r.semesters || []).map(s => [s.semester, s]));
    const cls = classify(r.cgpa);
    const date = r.submitted_at || r.submittedAt ? new Date(r.submitted_at || r.submittedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';
    return `
      <tr class="data-row">
        <td class="rank-cell">${medal(i) || (i + 1)}</td>
        <td class="name-cell" data-action="view" data-reg="${esc(r.registration)}" title="Click to view full results">
          <div class="name">${esc(r.name)}</div>
          <div class="reg">${esc(r.registration)}</div>
        </td>
        <td><strong style="color:${cls?.color || '#333'};font-size:16px;font-variant-numeric:tabular-nums">${fmt(r.cgpa)}</strong></td>
        <td><span class="badge" style="background:${cls?.bg};color:${cls?.color};border-color:${cls?.border}">${cls?.label || 'Incomplete'}</span></td>
        ${activeSems.map(s => {
          const sd = semMap[s];
          return `<td class="sem-cell">${sd?.gpa != null ? `<strong>${Number(sd.gpa).toFixed(2)}</strong><br><small>${sd.credits || ''}cr</small>` : '<span style="color:#ccc">—</span>'}</td>`;
        }).join('')}
        <td style="text-align:center">${r.credits ?? '—'}</td>
        <td class="batch-col"><small style="color:var(--muted)">${esc(r.batch || '—')}</small></td>
        <td><small style="color:var(--muted)">${date}</small></td>
        <td style="text-align:center">
          <div class="actions-cell">
            <button type="button" class="act-btn view" data-action="view" data-reg="${esc(r.registration)}" title="View complete academic results">👁️ View</button>
            <button type="button" class="act-btn edit" data-action="edit" data-reg="${esc(r.registration)}" title="Edit student">✏️ Edit</button>
            <button type="button" class="act-btn del" data-action="delete" data-reg="${esc(r.registration)}" title="Delete student">🗑️ Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  filterTable();
}

let currentDegreeFilter = 'all';
let currentBatchFilter = 'all';

function filterTable() {
  const q = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const cls = document.getElementById('class-filter')?.value || '';
  const rows = document.querySelectorAll('#table-body tr.data-row');
  let visible = 0;

  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    const badge = row.querySelector('.badge')?.textContent || '';
    const regText = (row.querySelector('.reg')?.textContent || '').toUpperCase();
    const batchText = (row.querySelector('.batch-col')?.textContent || row.textContent).toUpperCase();

    // Match search
    const matchQ = !q || text.includes(q);

    // Match class
    const matchCls = !cls || badge.includes(cls);

    // Match Degree
    let matchDeg = true;
    if (currentDegreeFilter !== 'all') {
      const deg = currentDegreeFilter.toUpperCase();
      const inBatch = batchText.includes(deg);
      const inReg = (deg === 'ABM' && regText.includes('/AB/')) ||
                    (deg === 'ARMT' && (regText.includes('/AT/') || regText.includes('/AR/') || regText.includes('/RM/'))) ||
                    (deg === 'GT' && regText.includes('/GT/'));
      matchDeg = inBatch || inReg;
    }

    // Match Batch
    let matchBatch = true;
    if (currentBatchFilter !== 'all') {
      const aliases = {
        '45': ['45', '2021', '21/22'],
        '46': ['46', '2022', '22/23'],
        '47': ['47', '2023', '23/24'],
        '48': ['48', '2024', '24/25'],
      }[currentBatchFilter] || [currentBatchFilter];
      matchBatch = aliases.some(a => batchText.toLowerCase().includes(a) || regText.toLowerCase().includes(a));
    }

    row.hidden = !(matchQ && matchCls && matchDeg && matchBatch);
    if (!row.hidden) visible++;
  });

  const countEl = document.getElementById('row-count');
  if (countEl) countEl.textContent = `Showing ${visible} of ${rows.length} students`;
}

// ── View Full Student Academic Results Modal ──────────────────────────────────
function openViewStudentModal(reg) {
  const r = allRows.find(x => String(x.registration).trim() === String(reg).trim());
  if (!r) return alert('Student record not found.');
  currentViewStudent = r;

  const cls = classify(r.cgpa);
  document.getElementById('view-student-title').textContent = r.name || 'Student Record';
  document.getElementById('view-student-subtitle').textContent = `${r.registration} · Batch ${r.batch || '2021/2022'}`;

  // Filter semesters that have results
  const semsWithData = (r.semesters || []).filter(s => s.gpa != null || (s.courses && s.courses.length));
  const lastSem = semsWithData.length ? semsWithData[semsWithData.length - 1] : null;
  const computedThrough = lastSem ? (SEM_LABELS[lastSem.semester] || lastSem.semester) : 'Year 1 · Semester I';
  const displayThrough = (r.results_through && r.results_through.trim() !== '' && 
                          r.results_through !== 'Latest' && 
                          r.results_through !== 'Latest Completed' && 
                          r.results_through !== 'Latest Completed Semester') 
    ? r.results_through 
    : computedThrough;

  // Hero KPI Card
  document.getElementById('view-hero').innerHTML = `
    <div>
      <div style="font-size:17px;font-weight:700;color:var(--green)">${esc(r.name)}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">Reg No: <strong>${esc(r.registration)}</strong> · Batch: <strong>${esc(r.batch || '2021/2022')}</strong></div>
      <div style="font-size:11px;color:var(--muted);margin-top:3px">Results up to: <strong>${esc(displayThrough)}</strong></div>
    </div>
    <div class="view-kpi-group">
      <div class="view-kpi-item">
        <div class="view-kpi-val" style="color:${cls?.color || '#183f32'}">${fmt(r.cgpa)}</div>
        <div class="view-kpi-lbl">CGPA</div>
      </div>
      <div class="view-kpi-item">
        <span class="badge" style="background:${cls?.bg || '#eee'};color:${cls?.color || '#333'};border-color:${cls?.border || '#ccc'};font-size:11px;padding:5px 11px">
          ${cls ? cls.label : 'Incomplete'}
        </span>
        <div class="view-kpi-lbl">Class</div>
      </div>
      <div class="view-kpi-item">
        <div class="view-kpi-val" style="color:#334155">${r.credits ?? '—'}</div>
        <div class="view-kpi-lbl">Credits</div>
      </div>
    </div>
  `;

  // Build Result Sheet HTML
  const resultSheetHTML = `
    <div class="result-sheet-preview-wrap">
      <div class="rsp-header">
        <h2>RESULT SHEET</h2>
        <h3>UNIVERSITY OF RUHUNA</h3>
        <h3>FACULTY OF AGRICULTURE</h3>
        <p>BSc. Hons Agribusiness Management</p>
      </div>

      <table class="rsp-meta">
        <tr>
          <td class="label">Name of Student:</td>
          <td colspan="3" style="font-weight:700">${esc(r.name || '—')}</td>
        </tr>
        <tr>
          <td class="label">Index / Reg. No:</td>
          <td>${esc(r.registration || '—')}</td>
          <td class="label">Academic Year / Intake:</td>
          <td>${esc(r.batch || '2021/2022')}</td>
        </tr>
        <tr>
          <td class="label">Result up to:</td>
          <td style="font-weight:700">${esc(displayThrough)}</td>
          <td class="label">Cumulative GPA (CGPA):</td>
          <td style="font-weight:700;color:${cls?.color || '#000'}">${fmt(r.cgpa)} / 4.00</td>
        </tr>
        <tr>
          <td class="label">Degree Classification:</td>
          <td style="font-weight:700;color:${cls?.color || '#000'}">${cls ? cls.label : 'Incomplete'}</td>
          <td class="label">Total GPA Credits:</td>
          <td>${r.credits ?? 0}</td>
        </tr>
      </table>

      ${semsWithData.length ? `
        <div class="rsp-cols">
          ${semsWithData.map(sem => `
            <div class="rsp-sem-card">
              <div class="rsp-sem-head">
                <span>${SEM_LABELS[sem.semester] || sem.semester}</span>
                <span>SGPA: ${sem.gpa != null ? Number(sem.gpa).toFixed(2) : '—'} | ${sem.credits || 0} cr</span>
              </div>
              ${sem.courses && sem.courses.length ? `
                <table class="rsp-sem-table">
                  <thead>
                    <tr><th style="width:25%">Code</th><th>Course Title</th><th style="width:12%;text-align:center">Cr</th><th style="width:14%;text-align:center">Grade</th></tr>
                  </thead>
                  <tbody>
                    ${sem.courses.map(c => `
                      <tr>
                        <td><b>${esc(c.code)}</b></td>
                        <td>${esc(c.title)}</td>
                        <td style="text-align:center">${c.credits ?? '—'}</td>
                        <td style="text-align:center;font-weight:700">${esc(c.grade)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              ` : `
                <div style="padding:10px 8px;color:#666;font-style:italic">
                  Semester GPA recorded: <strong>${sem.gpa != null ? Number(sem.gpa).toFixed(2) : '—'}</strong> (${sem.credits || 0} credits).
                </div>
              `}
            </div>
          `).join('')}
        </div>
      ` : `
        <div style="text-align:center;padding:24px;color:#777;background:#fafafa;border:1px dashed #ccc;border-radius:4px">
          No semester breakdown found for this student.
        </div>
      `}

      <div class="rsp-sig-block">
        <p>I hereby certify that the examination results and grades recorded above are a true and accurate record of the student's academic performance at the Faculty of Agriculture, University of Ruhuna.</p>
        <div style="display:flex;justify-content:flex-end;margin-top:30px">
          <div style="min-width:220px;text-align:center;border-top:1px dotted #000;padding-top:4px">
            Student's Signature &amp; Date
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('view-sheet-content').innerHTML = resultSheetHTML;
  document.getElementById('view-student-modal').hidden = false;
}

function closeViewModal() {
  document.getElementById('view-student-modal').hidden = true;
  currentViewStudent = null;
}

document.getElementById('btn-close-view').addEventListener('click', closeViewModal);
document.getElementById('btn-close-view-2').addEventListener('click', closeViewModal);

// Edit from view
document.getElementById('btn-edit-from-view').addEventListener('click', () => {
  if (!currentViewStudent) return;
  const reg = currentViewStudent.registration;
  closeViewModal();
  openEditStudentModal(reg);
});

// Print student result sheet
document.getElementById('btn-print-student').addEventListener('click', () => {
  if (!currentViewStudent) return;
  const sheetHTML = document.getElementById('view-sheet-content').innerHTML;
  const printRoot = document.getElementById('admin-print-root');
  printRoot.innerHTML = sheetHTML;
  printRoot.hidden = false;
  const oldTitle = document.title;
  document.title = `ResultSheet-${currentViewStudent.registration}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  window.print();
  document.title = oldTitle;
  printRoot.hidden = true;
  printRoot.innerHTML = '';
});

// ── Modal & CRUD Management ───────────────────────────────────────────────────
function openAddStudentModal() {
  editingReg = null;
  document.getElementById('modal-title').textContent = 'Add New Student Record';
  document.getElementById('student-form').reset();
  const regInput = document.getElementById('m-reg');
  regInput.disabled = false;
  document.getElementById('m-batch').value = '2021/2022';
  document.getElementById('student-modal').hidden = false;
}

function openEditStudentModal(reg) {
  const r = allRows.find(x => String(x.registration).trim() === String(reg).trim());
  if (!r) return alert('Student record not found.');
  editingReg = r.registration;
  document.getElementById('modal-title').textContent = `Edit Record: ${r.name}`;
  document.getElementById('m-name').value = r.name || '';
  const regInput = document.getElementById('m-reg');
  regInput.value = r.registration || '';
  regInput.disabled = true; // Primary key locked on edit
  document.getElementById('m-batch').value = r.batch || '2021/2022';
  document.getElementById('m-through').value = r.results_through || r.resultsThrough || '';
  document.getElementById('m-cgpa').value = r.cgpa != null ? Number(r.cgpa) : '';
  document.getElementById('m-credits').value = r.credits != null ? Number(r.credits) : '';

  // Semesters
  const semMap = Object.fromEntries((r.semesters || []).map(s => [s.semester, s]));
  SEMESTERS_ORDERED.forEach(sem => {
    const input = document.getElementById(`m-sem-${sem}`);
    if (input) {
      input.value = semMap[sem]?.gpa != null ? Number(semMap[sem].gpa) : '';
    }
  });

  document.getElementById('student-modal').hidden = false;
}

function closeModal() {
  document.getElementById('student-modal').hidden = true;
  editingReg = null;
}

document.getElementById('btn-close-modal').addEventListener('click', closeModal);
document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
document.getElementById('btn-add-student').addEventListener('click', openAddStudentModal);
document.getElementById('btn-add-student-2').addEventListener('click', openAddStudentModal);

// Form submit
document.getElementById('student-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById('btn-save-modal');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving to Database…';

  try {
    const registration = (editingReg || document.getElementById('m-reg').value).trim();
    const name = document.getElementById('m-name').value.trim();
    const batch = document.getElementById('m-batch').value;
    const degree = document.getElementById('m-degree').value;
    const batchVal = `${batch} · ${degree}`;
    const results_through = '';
    const cgpaVal = document.getElementById('m-cgpa').value;
    const creditsVal = document.getElementById('m-credits').value;

    // Build semesters array (preserving existing courses if editing)
    const existingStudent = allRows.find(x => String(x.registration).trim() === registration);
    const existingSemMap = Object.fromEntries((existingStudent?.semesters || []).map(s => [s.semester, s]));

    const semesters = [];
    SEMESTERS_ORDERED.forEach(sem => {
      const gpa = document.getElementById(`m-sem-${sem}`)?.value;
      if (gpa !== '' && gpa != null) {
        semesters.push({
          semester: sem,
          gpa: Number(gpa),
          credits: existingSemMap[sem]?.credits || 18,
          gradedCount: existingSemMap[sem]?.gradedCount || 6,
          courses: existingSemMap[sem]?.courses || []
        });
      }
    });

    const payload = {
      registration,
      name,
      batch: batchVal,
      results_through,
      cgpa: cgpaVal !== '' ? Number(cgpaVal) : null,
      credits: creditsVal !== '' ? Number(creditsVal) : null,
      graded_count: semesters.length * 6,
      semesters
    };

    await upsertSubmissionToSupabase(payload);
    closeModal();
    await loadDashboard();
    alert(`Student record for ${name} saved successfully! ✓`);
  } catch (err) {
    console.error('Save failed:', err);
    alert('Failed to save record: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Student Record';
  }
});

// Table action clicks (View / Edit / Delete)
document.getElementById('table-body').addEventListener('click', async (e) => {
  const trigger = e.target.closest('[data-action]');
  if (!trigger) return;
  const action = trigger.dataset.action;
  const reg = trigger.dataset.reg;

  if (action === 'view') {
    openViewStudentModal(reg);
  } else if (action === 'edit') {
    openEditStudentModal(reg);
  } else if (action === 'delete') {
    const r = allRows.find(x => String(x.registration).trim() === String(reg).trim());
    const name = r ? r.name : reg;
    if (!confirm(`Are you sure you want to permanently delete student:\n\n${name} (${reg})\n\nThis will remove the record from the Supabase database.`)) {
      return;
    }
    trigger.disabled = true;
    trigger.textContent = 'Deleting…';
    try {
      await deleteSubmissionFromSupabase(reg);
      await loadDashboard();
      alert(`Deleted ${name} from database. ✓`);
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Delete failed: ' + err.message);
      trigger.disabled = false;
      trigger.textContent = '🗑️ Delete';
    }
  }
});

// Podium click to view
document.getElementById('podium-grid').addEventListener('click', (e) => {
  const card = e.target.closest('[data-action="view"]');
  if (card && card.dataset.reg) {
    openViewStudentModal(card.dataset.reg);
  }
});

// Authentication
const isAuthed = localStorage.getItem('abm_admin_authed') === 'true';
if (isAuthed) {
  document.getElementById('login-container').hidden = true;
  document.getElementById('dashboard-container').hidden = false;
  document.getElementById('btn-signout').hidden = false;
  loadDashboard();
}

document.getElementById('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const pwd = document.getElementById('admin-password').value;
  if (pwd === ADMIN_PASSWORD) {
    localStorage.setItem('abm_admin_authed', 'true');
    document.getElementById('login-container').hidden = true;
    document.getElementById('dashboard-container').hidden = false;
    document.getElementById('btn-signout').hidden = false;
    loadDashboard();
  } else {
    document.getElementById('login-err').hidden = false;
  }
});

document.getElementById('btn-signout').addEventListener('click', () => {
  localStorage.removeItem('abm_admin_authed');
  location.reload();
});

document.getElementById('search-input').addEventListener('input', filterTable);
document.getElementById('class-filter').addEventListener('change', filterTable);

// Degree and Batch chip filters
document.querySelectorAll('.fdeg').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.fdeg').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDegreeFilter = btn.dataset.deg;
    filterTable();
  });
});

document.querySelectorAll('.fbatch').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.fbatch').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentBatchFilter = btn.dataset.batch;
    filterTable();
  });
});

// CSV Export
document.getElementById('btn-export-csv').addEventListener('click', () => {
  if (!allRows.length) return alert('No data to export.');
  const semCols = SEMESTERS_ORDERED;
  const header = ['Rank', 'Name', 'Registration', 'Batch', 'Results Up To', 'CGPA', 'Degree Class', 'GPA Credits', 'Courses Graded', ...semCols.map(s => `${SEM_LABELS[s]} GPA`), 'Submitted'];
  const p = v => { let t = String(v ?? ''); if (/^[=+@-]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
  const data = allRows.map((r, i) => {
    const cls = classify(r.cgpa);
    const semMap = Object.fromEntries((r.semesters || []).map(s => [s.semester, s.gpa]));
    return [i + 1, r.name, r.registration, r.batch, r.results_through || r.resultsThrough, r.cgpa != null ? Number(r.cgpa).toFixed(2) : '', cls?.label || '', r.credits, r.graded_count || r.gradedCount, ...semCols.map(s => semMap[s] != null ? Number(semMap[s]).toFixed(2) : ''), r.submitted_at || r.submittedAt || ''];
  });
  const csv = '\uFEFF' + [header, ...data].map(row => row.map(p).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'abm-batch-results.csv'; a.click();
});
