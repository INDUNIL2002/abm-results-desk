/**
 * app.mjs — ABM Results Desk
 * Modern Mobile-Friendly Web App & Official Result Sheet Maker.
 * University of Ruhuna · Faculty of Agriculture.
 */
import { GRADE_POINTS, SEMESTERS, calculate } from './gpa.mjs';
import { upsertSubmissionToSupabase, fetchSubmissionByRegistration, deleteSubmissionFromSupabase, cleanReg, cleanName } from './supabase.mjs';

// Register Service Worker for PWA Offline & Install support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW reg error:', err));
  });
}

const $ = (s) => document.querySelector(s);
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => n == null ? '—' : Number(n).toFixed(d);
const cleanCode = (v) => String(v).replace(/\s/g, '').toUpperCase();

const FILE_FORMAT = 'ruhuna-abm-2021-22-v1';
const STORAGE_KEY = 'abm-results-desk-v1';

const SEMESTER_LABELS = {
  'Orientation': 'Orientation',
  '1-I':  'Year 1 · Semester I',
  '1-II': 'Year 1 · Semester II',
  '2-I':  'Year 2 · Semester I',
  '2-II': 'Year 2 · Semester II',
  '3-I':  'Year 3 · Semester I',
  '3-II': 'Year 3 · Semester II',
  '4-I':  'Year 4 · Semester I',
  '4-II': 'Year 4 · Semester II',
};

const SEMESTER_SHORT = {
  'Orientation': 'Ori',
  '1-I':  'Y1·S1',
  '1-II': 'Y1·S2',
  '2-I':  'Y2·S1',
  '2-II': 'Y2·S2',
  '3-I':  'Y3·S1',
  '3-II': 'Y3·S2',
  '4-I':  'Y4·S1',
  '4-II': 'Y4·S2',
};

const DEGREE_CLASSES = [
  { label: 'First Class',           min: 3.70, cls: 'class-first' },
  { label: 'Second Class (Upper)',   min: 3.30, cls: 'class-upper' },
  { label: 'Second Class (Lower)',   min: 2.70, cls: 'class-lower' },
  { label: 'Pass',                   min: 2.00, cls: 'class-pass'  },
  { label: 'Fail / Incomplete',      min: 0,    cls: 'class-fail'  },
];

function classify(cgpa) {
  if (cgpa == null) return null;
  for (const c of DEGREE_CLASSES) {
    if (cgpa >= c.min) return c;
  }
  return DEGREE_CLASSES[DEGREE_CLASSES.length - 1];
}

const ALL_ACADEMIC_SEMS = ['1-I', '1-II', '2-I', '2-II', '3-I', '3-II', '4-I', '4-II'];

function getDisplayThrough(s) {
  if (state.profile.through && state.profile.through.trim() !== '' && 
      state.profile.through !== 'Latest Completed Semester' && 
      state.profile.through !== 'Latest Completed' && 
      state.profile.through !== 'Latest') {
    return state.profile.through.trim();
  }
  const selectedSems = ALL_ACADEMIC_SEMS.filter(sem => (state.completedSemesters || []).includes(sem));
  if (selectedSems.length) {
    const lastSem = selectedSems[selectedSems.length - 1];
    return SEMESTER_LABELS[lastSem] || lastSem;
  }
  const gradedRows = (s?.rows || []).filter(r => r.grade);
  if (gradedRows.length) {
    const lastRow = gradedRows[gradedRows.length - 1];
    return SEMESTER_LABELS[lastRow.semester] || lastRow.semester;
  }
  return 'Year 1 · Semester I';
}

const fresh = () => ({
  format: FILE_FORMAT,
  profile: { name: '', registration: '', batch: '', degree: '', through: '' },
  completedSemesters: [...ALL_ACADEMIC_SEMS],
  results: {},
  customCourses: [],
  overrides: {},
});

function getDegreeTitle() {
  const deg = state.profile.degree || 'ABM';
  const prog = catalogue?.programmes?.[deg] || catalogue?.programmes?.ABM;
  return prog?.degreeTitle || 'BSc. Hons Agribusiness Management';
}

function switchDegreeProgramme(degKey) {
  if (!catalogue?.programmes) return;
  const prog = catalogue.programmes[degKey] || catalogue.programmes.ABM;
  baseCourses = (prog.courses || []).map(c => ({ ...c, id: `${c.semester}:${c.code}` }));
  state.profile.degree = degKey;
}

let state = fresh();
let baseCourses = [];
let currentSemester = '1-I';
let editingId = null;
let toastTimer;
let catalogue;
let autoSyncTimer;
let autoSyncPullTimer;
let lastPullTimestamp = 0;
const PULL_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

// ── Course collection & Summary ───────────────────────────────────────────────
function courses() {
  return [
    ...baseCourses.map(c => ({ ...c, ...state.overrides[c.id], id: c.id, modified: !!state.overrides[c.id] })),
    ...state.customCourses,
  ];
}

function summary() {
  return calculate(courses(), state.results);
}

// ── Toast Notification ────────────────────────────────────────────────────────
function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
}

// ── Local Persistence & Background Cloud Auto-Sync ────────────────────────────
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
  scheduleAutoSync();
}

function scheduleAutoSync() {
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(autoSyncToBatch, 400);
}

window.addEventListener('beforeunload', () => {
  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer);
    autoSyncToBatch();
  }
});

window.addEventListener('pagehide', () => {
  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer);
    autoSyncToBatch();
  }
});

async function autoSyncToBatch() {
  if (!state.profile.name?.trim() || !state.profile.registration?.trim()) return;
  const s = summary();
  if (!s.rows.some(r => r.grade && r.grade !== 'Pending')) return;

  const syncIndicator = $('#sync-indicator');
  const syncText = $('#sync-text');
  if (syncIndicator) syncIndicator.classList.add('syncing');
  if (syncText) syncText.textContent = 'Syncing…';

  try {
    // Include semesters that either have graded courses OR have custom (elective) courses
    // so that elective course metadata (credits, title) always stays up-to-date in the cloud
    // even before a grade is entered.
    const semesterData = s.semesters
      .filter(sem =>
        sem.gradedCount > 0 ||
        state.customCourses.some(c => c.semester === sem.semester)
      )
      .map(sem => {
        const semCourses = s.rows
          .filter(r => r.semester === sem.semester && r.grade && r.grade !== 'Pending')
          .map(r => ({
            code: r.code,
            title: r.title,
            credits: r.credits,
            grade: r.grade,
          }));
        return {
          semester: sem.semester,
          gpa: sem.gpa != null ? Math.round(sem.gpa * 10000) / 10000 : null,
          credits: sem.credits,
          gradedCount: sem.gradedCount,
          courses: semCourses,
        };
      });

    const batchVal = state.profile.batch 
      ? (state.profile.degree ? `${state.profile.batch} · ${state.profile.degree}` : state.profile.batch)
      : (state.profile.degree || '');

    const payload = {
      name:           state.profile.name,
      registration:   state.profile.registration,
      batch:          batchVal,
      resultsThrough: getDisplayThrough(s),
      cgpa:           s.gpa,
      credits:        s.credits,
      gradedCount:    s.gradedCount,
      semesters:      semesterData,
    };

    // 1. Direct cloud sync to Supabase database
    await upsertSubmissionToSupabase(payload);

    // 2. Local backend fallback
    try {
      fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {}

    if (syncText) {
      syncText.textContent = 'Cloud Synced ✓';
    }
  } catch (err) {
    console.warn('Sync issue:', err);
    if (syncText) syncText.textContent = 'Saved locally';
  } finally {
    if (syncIndicator) syncIndicator.classList.remove('syncing');
  }
}

// ── Cloud Restore: restore results when opening app fresh or empty ────────────
async function syncFromCloudIfAvailable(reg, options = { silent: false, force: false }) {
  // If the user already has active local grades and not forced, DO NOT overwrite their local work!
  const hasLocalGrades = Object.values(state.results).some(r => r && r.grade && r.grade !== 'Pending');
  if (hasLocalGrades && !options.force) {
    return;
  }

  try {
    const cloud = await fetchSubmissionByRegistration(reg);
    if (!cloud || !Array.isArray(cloud.semesters) || cloud.semesters.length === 0) {
      if (!options.silent) {
        toast(`No existing online record found for [${reg}]. Entering grades will auto-save online!`);
      }
      return;
    }

    let restoredCount = 0;
    // Restore profile name if empty
    if (!state.profile.name && cloud.name) {
      state.profile.name = cloud.name;
      if ($('#student-name')) $('#student-name').value = cloud.name;
    }
    // Restore batch / degree
    if (cloud.batch) {
      if (cloud.batch.includes('·')) {
        const parts = cloud.batch.split('·').map(s => s.trim());
        if (!state.profile.batch) state.profile.batch = parts[0];
        if (!state.profile.degree && parts[1]) {
          state.profile.degree = parts[1];
          switchDegreeProgramme(parts[1]);
        }
      } else if (!state.profile.batch) {
        state.profile.batch = cloud.batch;
      }
      renderProfile();
    }

    // Restore semester courses from cloud only if not set locally
    cloud.semesters.forEach(sem => {
      if (Array.isArray(sem.courses)) {
        sem.courses.forEach(c => {
          const courseId = `${sem.semester}:${c.code}`;
          if (c.grade && c.grade !== 'Pending' && !state.results[courseId]?.grade) {
            state.results[courseId] = { grade: c.grade, repeat: false, confirmed: true, note: '' };
            restoredCount++;
          }
          // If elective / custom course not in baseCourses, add to customCourses
          const isBase = baseCourses.some(b => cleanCode(b.code) === cleanCode(c.code) && b.semester === sem.semester);
          if (!isBase && !state.customCourses.some(cc => cc.id === courseId)) {
            state.customCourses.push({
              id: courseId,
              semester: sem.semester,
              code: c.code,
              title: c.title,
              credits: c.credits,
              gpa: true,
              custom: true
            });
          }
        });
      }
    });

    if (restoredCount > 0 || !options.silent) {
      persist();
      render();
      toast(`☁️ Cloud Sync: Loaded ${restoredCount > 0 ? restoredCount + ' courses' : 'latest results'} for [${reg}]! ✓`);
    }
  } catch (err) {
    console.warn('Could not sync from cloud:', err);
    if (!options.silent) {
      toast('Cloud sync check encountered an issue. Data is safely saved locally.');
    }
  }
}

// ── Tab Navigation ────────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.nav-tab-btn, .mobile-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${tabId}-pane`);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (tabId === 'transcript') {
    // Push latest local edits to cloud, then render sheet
    const reg = cleanReg(state.profile.registration);
    if (reg && reg.length >= 6 && state.profile.name?.trim()) {
      (async () => {
        try {
          await autoSyncToBatch();
        } catch {} 
        renderOfficialResultSheet();
      })();
    } else {
      renderOfficialResultSheet();
    }
  }
}

// ── Grade Options HTML ────────────────────────────────────────────────────────
function gradeOptions(value = '') {
  return [
    ['', '— Select Grade —'],
    ['Pending', 'Pending'],
    ...Object.keys(GRADE_POINTS).map(g => [g, `${g}  (${GRADE_POINTS[g].toFixed(1)})`]),
  ].map(([v, label]) => `<option value="${v}"${v === value ? ' selected' : ''}>${label}</option>`).join('');
}

function gradeStyleClass(grade) {
  if (!grade || grade === 'Pending') return '';
  if (['A+', 'A', 'A-'].includes(grade)) return 'high';
  if (['B+', 'B', 'B-'].includes(grade)) return 'mid';
  if (['C+', 'C', 'C-'].includes(grade)) return 'pass';
  return 'fail';
}

// ── Profile Rendering ─────────────────────────────────────────────────────────
function renderProfile() {
  $('#student-name').value    = state.profile.name || '';
  $('#student-id').value      = state.profile.registration || '';
  if ($('#student-batch')) $('#student-batch').value = state.profile.batch || '';
  if ($('#student-degree')) $('#student-degree').value = state.profile.degree || '';
}

// ── Completed Semesters Tiles Grid ────────────────────────────────────────────
function renderCompletedSemesters() {
  const container = $('#completed-sems-list');
  if (!container) return;
  const list = ['Orientation', ...ALL_ACADEMIC_SEMS];
  const s = summary();
  const semMap = Object.fromEntries(s.semesters.map(item => [item.semester, item]));

  container.innerHTML = list.map(sem => {
    const checked = state.completedSemesters.includes(sem);
    const sd = semMap[sem];
    const sub = sd?.gpa != null ? `SGPA: ${sd.gpa.toFixed(2)}` : (sd?.credits ? `${sd.credits} Credits` : 'Not graded');
    return `
      <label class="sem-tile${checked ? ' checked' : ''}" data-sem-toggle="${sem}">
        <input type="checkbox" value="${sem}" ${checked ? 'checked' : ''}>
        <div class="sem-tile-text">
          <span class="sem-tile-name">${SEMESTER_SHORT[sem] || sem} · ${SEMESTER_LABELS[sem] || sem}</span>
          <span class="sem-tile-sub">${sub}</span>
        </div>
      </label>
    `;
  }).join('');
}

// ── Summary Metrics Bar (Hero Strip) ──────────────────────────────────────────
function renderMetrics(s) {
  const hasGpa = s.gpa != null;
  $('#hero-cgpa').textContent = hasGpa ? fmt(s.gpa) : '—';
  $('#hero-credits').textContent = s.credits || 0;
  $('#hero-graded').textContent = s.gradedCount || 0;

  // Header pill in navigation
  const tabPill = $('#tab-cgpa-pill');
  if (tabPill) tabPill.textContent = hasGpa ? `CGPA: ${fmt(s.gpa)}` : '—';

  // Class badge
  const clsBadge = $('#hero-class-badge');
  const cls = classify(s.gpa);
  if (cls && s.gradedCount > 0) {
    clsBadge.className = `class-pill ${cls.cls}`;
    clsBadge.textContent = cls.label;
  } else {
    clsBadge.className = 'class-pill';
    clsBadge.textContent = s.gradedCount > 0 ? 'Incomplete' : 'Calculating…';
  }

  // Issues box
  const issuesBox = $('#issues');
  if (s.issues.length) {
    issuesBox.hidden = false;
    issuesBox.innerHTML = `⚠️ <strong>Note:</strong> ${s.issues.map(i => escape(i.message || i)).join(', ')}`;
  } else {
    issuesBox.hidden = true;
    issuesBox.innerHTML = '';
  }
}

// ── Semester Navigation Scroll Bar ────────────────────────────────────────────
function renderSemesterNav(s) {
  const nav = $('#sem-scroll-nav');
  if (!nav) return;
  const semMap = Object.fromEntries(s.semesters.map(item => [item.semester, item]));

  nav.innerHTML = ALL_ACADEMIC_SEMS.map(sem => {
    const isActive = sem === currentSemester;
    const isCompleted = state.completedSemesters.includes(sem);
    const sd = semMap[sem];
    const sgpa = sd?.gpa != null ? sd.gpa.toFixed(2) : (isCompleted ? '—' : 'off');
    return `
      <button type="button" class="sem-pill-btn${isActive ? ' active' : ''}" data-semester="${sem}">
        <span>${isCompleted ? '✓ ' : ''}${SEMESTER_SHORT[sem] || sem}</span>
        <span class="sem-pill-badge">${sgpa}</span>
      </button>
    `;
  }).join('');
}

// ── Course Table for Active Semester ──────────────────────────────────────────
function renderCourses(s) {
  const query = ($('#search-courses')?.value || '').trim().toLowerCase();
  let list = courses();

  if (query) {
    list = list.filter(c =>
      c.code.toLowerCase().includes(query) ||
      c.title.toLowerCase().includes(query) ||
      (SEMESTER_LABELS[c.semester] || '').toLowerCase().includes(query)
    );
  } else {
    list = list.filter(c => c.semester === currentSemester);
  }

  $('#sem-header-title').textContent = query
    ? `Search Results ("${query}")`
    : (SEMESTER_LABELS[currentSemester] || currentSemester);

  const semData = s.semesters.find(x => x.semester === currentSemester);
  $('#sem-sgpa-pill').textContent = semData?.gpa != null ? `SGPA: ${fmt(semData.gpa)}` : 'SGPA: —';
  $('#sem-credits-pill').textContent = `${semData?.credits || 0} Credits`;
  $('#sem-graded-pill').textContent = `${semData?.gradedCount || 0} Graded`;
  $('#sem-footer-gpa').textContent = semData?.gpa != null ? fmt(semData.gpa) : '—';

  const tbody = $('#course-table-body');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--muted)">
      No courses in this semester. Click <strong>+ Add Elective Course</strong> to add your elective.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => {
    const res = state.results[c.id] || { grade: '', repeat: false };
    const r = s.rows.find(x => x.id === c.id) || {};
    const pts = r.weightedPoints != null ? fmt(r.weightedPoints) : '—';

    let tag = '';
    if (c.custom) tag += '<span class="tag-badge tag-elective">Elective</span>';
    if (res.repeat) tag += '<span class="tag-badge tag-repeat">Repeat</span>';
    if (!c.gpa) tag += '<span class="tag-badge tag-nongpa">Non-GPA</span>';

    return `
      <tr data-course-id="${c.id}">
        <td class="code-cell">${escape(c.code)}</td>
        <td class="title-cell">
          ${escape(c.title)}${tag}
          ${query ? `<br><small style="color:var(--muted)">${SEMESTER_SHORT[c.semester] || c.semester}</small>` : ''}
        </td>
        <td style="text-align:center;font-weight:600">${c.credits ?? '—'}</td>
        <td>
          <select class="grade-dropdown ${gradeStyleClass(res.grade)}" data-course="${c.id}">
            ${gradeOptions(res.grade)}
          </select>
        </td>
        <td style="text-align:center;font-weight:700;font-variant-numeric:tabular-nums">${pts}</td>
        <td style="text-align:center">
          <button type="button" class="btn-icon-cell" data-edit="${c.id}" title="Edit course or repeat attempt">✏️</button>
        </td>
      </tr>
    `;
  }).join('');

  // Populate Quick Add Elective dropdown for active semester (Always visible)
  const elSelect = $('#quick-add-elective');
  if (elSelect) {
    elSelect.hidden = false;
    const semElectives = catalogue?.electives?.[currentSemester] || [];
    const currentCodes = new Set(list.map(c => cleanCode(c.code)));
    const available = semElectives.filter(e => !currentCodes.has(cleanCode(e.code)));

    if (available.length > 0) {
      elSelect.disabled = false;
      elSelect.innerHTML = `
        <option value="" disabled selected>➕ Quick Add Handbook Elective (${available.length} available for ${SEMESTER_SHORT[currentSemester] || currentSemester})…</option>
        ${available.map(e => `<option value="${escape(e.code)}">${escape(e.code)} — ${escape(e.title)} (${e.credits} Cr)</option>`).join('')}
      `;
    } else if (['1-I', '1-II'].includes(currentSemester)) {
      // In Ruhuna FoA, Year 1 has compulsory courses only. Electives begin in Year 2.
      // We keep dropdown active and allow browsing/adding electives from the Faculty pool if desired.
      elSelect.disabled = false;
      let optgroups = '';
      if (catalogue?.electives) {
        optgroups = Object.entries(catalogue.electives)
          .map(([semKey, eList]) => {
            const availInSem = eList.filter(e => !currentCodes.has(cleanCode(e.code)));
            if (!availInSem.length) return '';
            return `<optgroup label="📚 ${SEMESTER_LABELS[semKey] || semKey} Electives">` +
              availInSem.map(e => `<option value="${escape(e.code)}">${escape(e.code)} — ${escape(e.title)} (${e.credits} Cr)</option>`).join('') +
              `</optgroup>`;
          }).join('');
      }
      elSelect.innerHTML = `
        <option value="" disabled selected>ℹ️ Electives start in Y2·S1 · Click to browse Faculty Elective Pool…</option>
        ${optgroups}
      `;
    } else if (['4-I', '4-II'].includes(currentSemester)) {
      elSelect.disabled = false;
      let optgroups = '';
      if (catalogue?.electives) {
        optgroups = Object.entries(catalogue.electives)
          .map(([semKey, eList]) => {
            const availInSem = eList.filter(e => !currentCodes.has(cleanCode(e.code)));
            if (!availInSem.length) return '';
            return `<optgroup label="📚 ${SEMESTER_LABELS[semKey] || semKey} Electives">` +
              availInSem.map(e => `<option value="${escape(e.code)}">${escape(e.code)} — ${escape(e.title)} (${e.credits} Cr)</option>`).join('') +
              `</optgroup>`;
          }).join('');
      }
      elSelect.innerHTML = `
        <option value="" disabled selected>ℹ️ Year 4: Core Research Projects · Browse Faculty Electives…</option>
        ${optgroups}
      `;
    } else {
      elSelect.disabled = true;
      elSelect.innerHTML = `<option value="" disabled selected>✓ All handbook electives added for ${SEMESTER_SHORT[currentSemester] || currentSemester}</option>`;
    }
  }
}

function render() {
  const s = summary();
  renderMetrics(s);
  renderSemesterNav(s);
  renderCompletedSemesters();
  renderCourses(s);
}

// ── Course Dialog (Add/Edit Elective) ──────────────────────────────────────────
function openElectiveDialog(id = null) {
  editingId = id;
  const course = id ? courses().find(c => c.id === id) : null;
  const res = id ? state.results[id] || {} : {};

  $('#dialog-heading').textContent = course
    ? (course.custom ? 'Edit Elective Course' : 'Adjust Course')
    : `Add Elective Course (${SEMESTER_SHORT[currentSemester] || currentSemester})`;

  $('#el-semester').value   = course ? course.semester : currentSemester;
  $('#el-code').value       = course ? course.code : '';
  $('#el-title').value      = course ? course.title : '';
  $('#el-credits').value    = course && course.credits != null ? course.credits : '2';
  $('#el-gpa').checked      = course ? !!course.gpa : true;
  $('#el-repeat').checked   = !!res.repeat;
  $('#el-confirmed').checked = !!res.confirmed;
  $('#repeat-sub').hidden   = !res.repeat;
  $('#btn-remove-elective').hidden = !course?.custom;
  $('#el-error').textContent = '';

  $('#elective-dialog').showModal();
}

function saveElective(e) {
  e.preventDefault();
  const code = cleanCode($('#el-code').value);
  const title = $('#el-title').value.trim();
  const credits = parseFloat($('#el-credits').value);
  const gpa = $('#el-gpa').checked;
  const sem = $('#el-semester').value;

  if (!code) { $('#el-error').textContent = 'Course code is required.'; return; }
  if (!title) { $('#el-error').textContent = 'Course title is required.'; return; }
  if (isNaN(credits) || credits <= 0) { $('#el-error').textContent = 'Credits must be positive.'; return; }

  const allCurrent = courses();
  const existingWithSameCode = allCurrent.find(c => cleanCode(c.code) === code && c.id !== editingId);
  if (existingWithSameCode) {
    $('#el-error').textContent = `Course code "${code}" already exists. Edit the existing course instead.`;
    return;
  }

  const fields = { semester: sem, code, title, credits, gpa };
  const id = editingId || `custom:${crypto.randomUUID()}`;

  if (editingId && baseCourses.some(c => c.id === id)) {
    state.overrides[id] = fields;
  } else if (editingId) {
    state.customCourses = state.customCourses.map(c => c.id === id ? { ...c, ...fields } : c);
  } else {
    state.customCourses.push({ id, ...fields, custom: true });
  }

  state.results[id] = {
    ...(state.results[id] || { grade: '' }),
    repeat: $('#el-repeat').checked,
    confirmed: $('#el-repeat').checked && $('#el-confirmed').checked,
    note: '',
  };

  currentSemester = sem;
  $('#elective-dialog').close();
  persist();
  render();
  toast(editingId ? 'Elective updated ✓' : 'Elective added to table ✓');
}

// ══════════════════════════════════════════════════════════════════════════════
// OFFICIAL RESULT SHEET BUILDER (Strictly official, single A4 page fit)
// ══════════════════════════════════════════════════════════════════════════════
function generateOfficialResultSheetHTML(s) {
  const cls = classify(s.gpa);
  const entered = s.rows.filter(r => r.grade && r.grade !== '');

  // Only display tables for selected completed semesters
  const selectedSems = ALL_ACADEMIC_SEMS.filter(sem => (state.completedSemesters || []).includes(sem));
  const activeSems = selectedSems.length ? selectedSems : ALL_ACADEMIC_SEMS;

  const mid = Math.ceil(activeSems.length / 2);
  const col1Sems = activeSems.slice(0, mid);
  const col2Sems = activeSems.slice(mid);

  const renderSemCard = (sem) => {
    const semRows = entered.filter(r => r.semester === sem);
    const sd = s.semesters.find(x => x.semester === sem);
    const sgpaText = sd?.gpa != null ? fmt(sd.gpa) : '—';
    const crText = sd?.credits || 0;

    return `
      <div class="sheet-sem-card">
        <div class="sheet-sem-title-bar">
          <span>${SEMESTER_LABELS[sem] || sem}</span>
          <span>SGPA: ${sgpaText}</span>
        </div>
        <table class="sheet-table">
          <thead>
            <tr>
              <th style="width:28%">Code</th>
              <th>Course Title</th>
              <th class="sheet-center" style="width:12%">Cr</th>
              <th class="sheet-center" style="width:14%">Grade</th>
            </tr>
          </thead>
          <tbody>
            ${semRows.length ? semRows.map(r => `
              <tr>
                <td style="font-family:monospace;font-weight:bold">${escape(r.code)}</td>
                <td>${escape(r.title)}</td>
                <td class="sheet-center">${r.credits ?? '—'}</td>
                <td class="sheet-grade">${escape(r.grade)}</td>
              </tr>
            `).join('') : `<tr><td colspan="4" class="sheet-center" style="color:#888;padding:4px">No results entered</td></tr>`}
          </tbody>
        </table>
        <div class="sheet-sem-total-bar">
          SGPA: ${sgpaText} | Credits: ${crText}
        </div>
      </div>
    `;
  };

  return `
    <div class="official-sheet-wrapper">
      <!-- Formal Official Header -->
      <div class="sheet-header-block">
        <div class="sheet-main-title">RESULT SHEET</div>
        <div class="sheet-uni-name">UNIVERSITY OF RUHUNA</div>
        <div class="sheet-fac-name">FACULTY OF AGRICULTURE</div>
        <div class="sheet-degree-name">${escape(getDegreeTitle())}</div>
      </div>

      <!-- Student Identification & Overall Result Table -->
      <table class="sheet-meta-table">
        <tr>
          <td class="sheet-meta-label">Name of Student:</td>
          <td class="sheet-meta-value" colspan="3">${escape(state.profile.name || '—')}</td>
        </tr>
        <tr>
          <td class="sheet-meta-label">Index / Reg. No:</td>
          <td class="sheet-meta-value">${escape(state.profile.registration || '—')}</td>
          <td class="sheet-meta-label">Academic Year / Intake:</td>
          <td class="sheet-meta-value">${escape(state.profile.batch || '—')}</td>
        </tr>
        <tr>
          <td class="sheet-meta-label">Result up to:</td>
          <td class="sheet-meta-value">${escape(getDisplayThrough(s))}</td>
          <td class="sheet-meta-label">Cumulative GPA (CGPA):</td>
          <td class="sheet-meta-value sheet-meta-hl">${s.gpa != null ? fmt(s.gpa) : '—'} / 4.00</td>
        </tr>
        <tr>
          <td class="sheet-meta-label">Degree Classification:</td>
          <td class="sheet-meta-value sheet-meta-hl">${cls ? cls.label : 'Incomplete'}</td>
          <td class="sheet-meta-label">Total GPA Credits:</td>
          <td class="sheet-meta-value">${s.credits || 0}</td>
        </tr>
      </table>

      <!-- Semesters Layout (Fits selected semesters onto A4) -->
      <div class="sheet-semesters-columns"${col2Sems.length === 0 ? ' style="grid-template-columns: 1fr;"' : ''}>
        <div class="sheet-sem-col">
          ${col1Sems.map(renderSemCard).join('')}
        </div>
        ${col2Sems.length ? `
        <div class="sheet-sem-col">
          ${col2Sems.map(renderSemCard).join('')}
        </div>
        ` : ''}
      </div>

      <!-- Formal Declaration Statement & Signature -->
      <div class="sheet-certification-block">
        <p class="sheet-declaration-text">
          I hereby certify that the examination results and grades recorded above are a true and accurate record of my academic performance at the Faculty of Agriculture, University of Ruhuna.
        </p>
        <div class="sheet-signatures-grid" style="display:flex;justify-content:flex-end">
          <div class="sheet-sig-item" style="min-width:240px">
            <div class="sheet-sig-dots">Student's Signature &amp; Date</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderOfficialResultSheet() {
  const container = $('#official-result-sheet-content');
  if (container) {
    container.innerHTML = generateOfficialResultSheetHTML(summary());
  }
}

// ── Multi-Format Export Functions ─────────────────────────────────────────────

// 1. PDF Export (Triggers A4 Print)
function exportPDF() {
  const s = summary();
  $('#print-root').innerHTML = generateOfficialResultSheetHTML(s);
  const oldTitle = document.title;
  document.title = `ResultSheet-${state.profile.registration || 'Student'}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  window.print();
  document.title = oldTitle;
}

// 2. Word (.doc) Export
function exportWord() {
  const s = summary();
  const cls = classify(s.gpa);
  const docHTML = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>Result Sheet - ${escape(state.profile.name)}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; margin: 25px; }
        .head { text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 12px; }
        .title { font-size: 14pt; font-weight: bold; text-transform: uppercase; margin: 0; }
        .sub { font-size: 11pt; font-weight: bold; margin: 2px 0; }
        .meta { width: 100%; border-collapse: collapse; border: 1px solid #000; margin-bottom: 14px; font-size: 9.5pt; }
        .meta td { padding: 4px 8px; border: 1px solid #ccc; }
        .sem-title { font-size: 10pt; font-weight: bold; background: #eee; padding: 4px; border: 1px solid #000; margin-top: 10px; }
        table.courses { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 9pt; }
        table.courses th, table.courses td { border: 1px solid #000; padding: 3px 6px; }
        table.courses th { background: #f5f5f5; text-align: left; }
        .center { text-align: center; }
        .sig { margin-top: 30px; font-size: 9pt; }
      </style>
    </head>
    <body>
      <div class="head">
        <div class="title">RESULT SHEET</div>
        <div class="sub">UNIVERSITY OF RUHUNA</div>
        <div class="sub">FACULTY OF AGRICULTURE</div>
        <div style="font-style:italic">${escape(getDegreeTitle())}</div>
      </div>

      <table class="meta">
        <tr><td><b>Name of Student:</b></td><td colspan="3">${escape(state.profile.name || '—')}</td></tr>
        <tr><td><b>Index / Reg No:</b></td><td>${escape(state.profile.registration || '—')}</td><td><b>Academic Year / Batch:</b></td><td>${escape(state.profile.batch || '—')}</td></tr>
        <tr><td><b>Result up to:</b></td><td>${escape(getDisplayThrough(s))}</td><td><b>Cumulative GPA (CGPA):</b></td><td><b>${s.gpa != null ? fmt(s.gpa) : '—'} / 4.00</b></td></tr>
        <tr><td><b>Degree Classification:</b></td><td><b>${cls ? cls.label : 'Incomplete'}</b></td><td><b>Total GPA Credits:</b></td><td>${s.credits || 0}</td></tr>
      </table>

      ${(() => {
        const selectedSems = ALL_ACADEMIC_SEMS.filter(sem => (state.completedSemesters || []).includes(sem));
        const activeSems = selectedSems.length ? selectedSems : ALL_ACADEMIC_SEMS;
        return activeSems.map(sem => {
          const semRows = s.rows.filter(r => r.semester === sem && r.grade);
          if (!semRows.length) return '';
          const sd = s.semesters.find(x => x.semester === sem);
          return `
            <div class="sem-title">${SEMESTER_LABELS[sem] || sem} — SGPA: ${sd?.gpa != null ? fmt(sd.gpa) : '—'} | Credits: ${sd?.credits || 0}</div>
            <table class="courses">
              <thead>
                <tr><th style="width:20%">Code</th><th>Course Title</th><th class="center" style="width:12%">Credits</th><th class="center" style="width:15%">Grade</th></tr>
              </thead>
              <tbody>
                ${semRows.map(r => `
                  <tr>
                    <td><b>${escape(r.code)}</b></td>
                    <td>${escape(r.title)}</td>
                    <td class="center">${r.credits ?? '—'}</td>
                    <td class="center"><b>${escape(r.grade)}</b></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `;
        }).join('');
      })()}

      <div class="sig">
        <p><i>I hereby certify that the examination results and grades recorded above are a true and accurate record of my academic performance at the Faculty of Agriculture, University of Ruhuna.</i></p>
        <table style="width:100%;border:0;margin-top:40px">
          <tr>
            <td style="border:0;width:55%"></td>
            <td style="border:0;border-top:1px dotted #000;width:45%;text-align:center">Student's Signature &amp; Date</td>
          </tr>
        </table>
      </div>
    </body>
    </html>
  `;
  downloadBlob(docHTML, 'application/msword;charset=utf-8', `ResultSheet-${getSafeFileName()}.doc`);
  toast('Word Document (.doc) downloaded ✓');
}

// 3. Markdown (.md) Export
function exportMarkdown() {
  const s = summary();
  const cls = classify(s.gpa);
  const lines = [
    `# RESULT SHEET`,
    `## UNIVERSITY OF RUHUNA — FACULTY OF AGRICULTURE`,
    `### ${getDegreeTitle()}`,
    ``,
    `| Student Information | Details |`,
    `| :--- | :--- |`,
    `| **Name of Student** | ${state.profile.name || '—'} |`,
    `| **Index / Reg. No** | ${state.profile.registration || '—'} |`,
    `| **Academic Year / Batch** | ${state.profile.batch || '—'} |`,
    `| **Result up to** | ${getDisplayThrough(s)} |`,
    `| **Cumulative GPA (CGPA)** | **${s.gpa != null ? fmt(s.gpa) : '—'} / 4.00** |`,
    `| **Degree Classification** | **${cls ? cls.label : 'Incomplete'}** |`,
    `| **Total GPA Credits** | ${s.credits || 0} |`,
    ``,
    `---`,
    ``,
  ];

  const selectedSems = ALL_ACADEMIC_SEMS.filter(sem => (state.completedSemesters || []).includes(sem));
  const activeSems = selectedSems.length ? selectedSems : ALL_ACADEMIC_SEMS;
  activeSems.forEach(sem => {
    const semRows = s.rows.filter(r => r.semester === sem && r.grade);
    if (!semRows.length) return;
    const sd = s.semesters.find(x => x.semester === sem);
    lines.push(`### ${SEMESTER_LABELS[sem] || sem} (SGPA: ${sd?.gpa != null ? fmt(sd.gpa) : '—'} | Credits: ${sd?.credits || 0})`);
    lines.push(`| Course Code | Course Title | Credits | Grade |`);
    lines.push(`| :--- | :--- | :---: | :---: |`);
    semRows.forEach(r => {
      lines.push(`| ${r.code} | ${r.title} | ${r.credits ?? '—'} | **${r.grade}** |`);
    });
    lines.push(``);
  });

  lines.push(`*I hereby certify that the examination results and grades recorded above are a true and accurate record of my academic performance at the Faculty of Agriculture, University of Ruhuna.*`);
  downloadBlob(lines.join('\n'), 'text/markdown;charset=utf-8', `ResultSheet-${getSafeFileName()}.md`);
  toast('Markdown (.md) downloaded ✓');
}

// 4. Plain Text (.txt) Export
function exportText() {
  const s = summary();
  const cls = classify(s.gpa);
  const line = '='.repeat(76);
  const subLine = '-'.repeat(76);
  const lines = [
    line,
    '                              RESULT SHEET',
    '                          UNIVERSITY OF RUHUNA',
    '                         FACULTY OF AGRICULTURE',
    `                   ${getDegreeTitle()}`,
    line,
    `Name of Student       : ${state.profile.name || 'Not provided'}`,
    `Index / Reg. No       : ${state.profile.registration || 'Not provided'}`,
    `Academic Year / Batch : ${state.profile.batch || 'Not provided'}`,
    `Result up to          : ${getDisplayThrough(s)}`,
    `Cumulative GPA (CGPA) : ${s.gpa != null ? fmt(s.gpa) : '—'} / 4.00`,
    `Degree Classification : ${cls ? cls.label : 'Incomplete'}`,
    `Total GPA Credits     : ${s.credits || 0}`,
    line,
    '',
  ];

  const selectedSems = ALL_ACADEMIC_SEMS.filter(sem => (state.completedSemesters || []).includes(sem));
  const activeSems = selectedSems.length ? selectedSems : ALL_ACADEMIC_SEMS;
  activeSems.forEach(sem => {
    const semRows = s.rows.filter(r => r.semester === sem && r.grade);
    if (!semRows.length) return;
    const sd = s.semesters.find(x => x.semester === sem);
    lines.push(`[ ${SEMESTER_LABELS[sem] || sem} ]  SGPA: ${sd?.gpa != null ? fmt(sd.gpa) : '—'} | Credits: ${sd?.credits || 0}`);
    lines.push(subLine);
    lines.push('Course Code   Course Title                                  Credits   Grade');
    lines.push(subLine);
    semRows.forEach(r => {
      const code = (r.code || '').padEnd(13);
      const title = (r.title || '').slice(0, 44).padEnd(46);
      const cr = String(r.credits ?? '—').padStart(3);
      const gr = String(r.grade || '—').padStart(8);
      lines.push(`${code} ${title} ${cr} ${gr}`);
    });
    lines.push('');
  });

  lines.push(line);
  lines.push('I hereby certify that the examination results and grades recorded above');
  lines.push('are a true and accurate record of my academic performance at the');
  lines.push('Faculty of Agriculture, University of Ruhuna.');
  lines.push(line);

  downloadBlob(lines.join('\n'), 'text/plain;charset=utf-8', `ResultSheet-${getSafeFileName()}.txt`);
  toast('Plain Text (.txt) downloaded ✓');
}

// 5. Direct Share / Clipboard
async function shareResultSheet() {
  const s = summary();
  const cls = classify(s.gpa);
  const textSummary = [
    `🎓 *RESULT SHEET — UNIVERSITY OF RUHUNA*`,
    `*Faculty of Agriculture — ${getDegreeTitle()}*`,
    `*Student:* ${state.profile.name || 'FOA Student'} (${state.profile.registration || '—'})`,
    `*Batch:* ${state.profile.batch || '2021/2022'}`,
    `⭐ *Cumulative GPA (CGPA):* ${s.gpa != null ? fmt(s.gpa) : '—'} / 4.00`,
    `🏆 *Classification:* ${cls ? cls.label : 'Incomplete'}`,
    `📚 *GPA Credits:* ${s.credits || 0} (${s.gradedCount || 0} courses graded)`,
  ].join('\n');

  if (navigator.share) {
    try {
      await navigator.share({
        title: `Result Sheet - ${state.profile.name || 'FOA Student'}`,
        text: textSummary,
        url: window.location.href,
      });
      toast('Shared successfully ✓');
      return;
    } catch (e) {
      if (e.name !== 'AbortError') copyToClipboard(textSummary);
    }
  } else {
    copyToClipboard(textSummary);
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(
    () => toast('Summary copied to clipboard! 📋'),
    () => toast('Could not copy to clipboard.')
  );
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getSafeFileName() {
  const reg = state.profile.registration || state.profile.name || 'Student';
  return reg.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
}

// ── State Validation ──────────────────────────────────────────────────────────
function validateState(input) {
  if (!input || input.format !== FILE_FORMAT) throw Error('Invalid progress file.');
  const result = fresh();
  if (input.profile) {
    for (const key of ['name', 'registration', 'batch', 'degree', 'through']) {
      if (typeof input.profile[key] === 'string') result.profile[key] = input.profile[key];
    }
  }
  if (Array.isArray(input.completedSemesters)) {
    result.completedSemesters = input.completedSemesters.filter(s => SEMESTERS.includes(s));
  }
  if (Array.isArray(input.customCourses)) {
    const seenCodes = new Set(baseCourses.map(b => cleanCode(b.code)));
    const uniqueCustom = [];
    for (const c of input.customCourses) {
      const code = cleanCode(c.code);
      if (!seenCodes.has(code)) {
        seenCodes.add(code);
        uniqueCustom.push({
          id: c.id,
          semester: c.semester,
          code: c.code,
          title: c.title,
          credits: c.credits,
          gpa: !!c.gpa,
          custom: true,
        });
      }
    }
    result.customCourses = uniqueCustom;
  }
  if (input.overrides && typeof input.overrides === 'object') {
    result.overrides = input.overrides;
  }
  if (input.results && typeof input.results === 'object') {
    result.results = input.results;
  }
  return result;
}

// ── Wire All UI Events ────────────────────────────────────────────────────────
function wire() {
  // Tab Switching
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Data-goto navigation buttons
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.goto));
  });

  // Profile Inputs (Live Auto-save & Auto-sync)
  ['student-name', 'student-id', 'student-batch', 'student-degree'].forEach(id => {
    const el = $(`#${id}`);
    if (!el) return;
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, e => {
      if (id === 'student-name') state.profile.name = e.target.value;
      else if (id === 'student-id') {
        const norm = cleanReg(e.target.value);
        state.profile.registration = norm;
      }
      else if (id === 'student-batch') state.profile.batch = e.target.value;
      else if (id === 'student-degree') {
        state.profile.degree = e.target.value;
        switchDegreeProgramme(e.target.value);
        persist();
        render();
        toast(`Curriculum switched to ${catalogue.programmes[e.target.value]?.shortName || e.target.value} ✓`);
        scheduleAutoSync();
        return;
      }
      persist();
      scheduleAutoSync();
    });
  });

  // Cross-device Cloud Restore on Registration blur / change
  const idInput = $('#student-id');
  if (idInput) {
    const onRegChange = async () => {
      const reg = cleanReg(idInput.value);
      if (reg) {
        idInput.value = reg;
        state.profile.registration = reg;
        persist();
        if (reg.length >= 6) {
          await syncFromCloudIfAvailable(reg, { silent: false });
        }
      }
    };
    idInput.addEventListener('blur', onRegChange);
    idInput.addEventListener('change', onRegChange);
  }

  // Explicit Cloud Sync Button
  const syncBtn = $('#btn-cloud-sync');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      const reg = cleanReg(state.profile.registration || $('#student-id')?.value);
      if (!reg) {
        alert('Please enter your Index / Registration Number first to sync results.');
        $('#student-id')?.focus();
        return;
      }
      syncBtn.disabled = true;
      syncBtn.textContent = 'Syncing…';
      try {
        await syncFromCloudIfAvailable(reg, { silent: false });
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = '☁️ Sync Cloud';
      }
    });
  }

  // Reset / Clear Data Button
  const resetBtn = $('#btn-reset-data');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      const reg = cleanReg(state.profile.registration || $('#student-id')?.value);
      const ok = confirm(
        '⚠️ Reset all entered data on this device?\n\nThis will clear your form and entered grades so you can start fresh.'
      );
      if (!ok) return;

      let deleteOnline = false;
      if (reg) {
        deleteOnline = confirm(
          `Do you ALSO want to permanently delete your saved record (${reg}) from the online batch database?\n\n• Click OK to delete from online database\n• Click Cancel to only clear this device`
        );
      }

      if (deleteOnline && reg) {
        try {
          await deleteSubmissionFromSupabase(reg);
          toast(`Deleted [${reg}] from online database ✓`);
        } catch (err) {
          console.warn('Could not delete online record:', err);
        }
      }

      state = fresh();
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      switchDegreeProgramme('ABM');
      renderProfile();
      render();
      toast('Form and grades cleared! You can enter data fresh. ✓');
    });
  }

  // Quick Add Elective Course from Handbook
  const quickEl = $('#quick-add-elective');
  if (quickEl) {
    quickEl.addEventListener('change', e => {
      const code = e.target.value;
      if (!code) return;
      let found = (catalogue?.electives?.[currentSemester] || []).find(x => x.code === code);
      if (!found && catalogue?.electives) {
        for (const eList of Object.values(catalogue.electives)) {
          found = eList.find(x => x.code === code);
          if (found) break;
        }
      }
      if (!found) return;

      const id = `${currentSemester}:${found.code}`;
      if (!state.customCourses.some(c => c.id === id)) {
        state.customCourses.push({
          id,
          semester: currentSemester,
          code: found.code,
          title: found.title,
          credits: found.credits,
          gpa: true,
          custom: true,
        });
        persist();
        render();
        toast(`Added elective [${found.code}] ${found.title} ✓`);
      }
      quickEl.value = '';
    });
  }

  // Completed Semesters Checkboxes
  $('#completed-sems-list').addEventListener('change', e => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    const sem = cb.value;
    if (cb.checked) {
      if (!state.completedSemesters.includes(sem)) state.completedSemesters.push(sem);
    } else {
      state.completedSemesters = state.completedSemesters.filter(s => s !== sem);
    }
    persist();
    render();
  });

  // Quick Select Buttons
  const setSems = (sems, activeBtnId) => {
    state.completedSemesters = [...sems];
    document.querySelectorAll('.chip-btn').forEach(b => b.classList.toggle('active', b.id === activeBtnId));
    persist();
    render();
  };
  $('#btn-quick-y1').addEventListener('click', () => setSems(['1-I', '1-II'], 'btn-quick-y1'));
  $('#btn-quick-y2').addEventListener('click', () => setSems(['1-I', '1-II', '2-I', '2-II'], 'btn-quick-y2'));
  $('#btn-quick-y3').addEventListener('click', () => setSems(['1-I', '1-II', '2-I', '2-II', '3-I', '3-II'], 'btn-quick-y3'));
  $('#btn-quick-all').addEventListener('click', () => setSems([...ALL_ACADEMIC_SEMS], 'btn-quick-all'));

  // Semester Scroll Navigation (Active Semester Changer)
  $('#sem-scroll-nav').addEventListener('click', e => {
    const btn = e.target.closest('[data-semester]');
    if (btn) {
      currentSemester = btn.dataset.semester;
      if ($('#search-courses')) $('#search-courses').value = '';
      render();
    }
  });

  // Search filter
  $('#search-courses').addEventListener('input', () => renderCourses(summary()));

  // Grade Dropdown Change
  $('#course-table-body').addEventListener('change', e => {
    const sel = e.target.closest('select[data-course]');
    if (!sel) return;
    const id = sel.dataset.course;
    const grade = sel.value;
    const old = state.results[id] || { repeat: false, confirmed: false, note: '' };
    state.results[id] = { ...old, grade, confirmed: old.repeat ? false : old.confirmed };
    persist();
    render();
  });

  // Edit Course Button
  $('#course-table-body').addEventListener('click', e => {
    const btn = e.target.closest('[data-edit]');
    if (btn) openElectiveDialog(btn.dataset.edit);
  });

  // Add Elective Buttons (Top & Bottom)
  $('#btn-add-elective')?.addEventListener('click', () => openElectiveDialog());
  $('#btn-add-elective-bottom')?.addEventListener('click', () => openElectiveDialog());

  // Elective Modal Form
  $('#elective-form').addEventListener('submit', saveElective);
  $('#el-repeat').addEventListener('change', () => {
    $('#repeat-sub').hidden = !$('#el-repeat').checked;
    if (!$('#el-repeat').checked) $('#el-confirmed').checked = false;
  });

  $('#btn-remove-elective').addEventListener('click', () => {
    if (!editingId || !confirm('Remove this elective course and its recorded grade?')) return;
    state.customCourses = state.customCourses.filter(c => c.id !== editingId);
    delete state.results[editingId];
    $('#elective-dialog').close();
    persist();
    render();
    toast('Elective course removed.');
  });

  document.querySelectorAll('.close-dialog').forEach(b => {
    b.addEventListener('click', () => b.closest('dialog').close());
  });

  // Export Buttons on Result Sheet Tab
  $('#btn-export-pdf').addEventListener('click', exportPDF);
  $('#btn-export-word').addEventListener('click', exportWord);
  $('#btn-export-md').addEventListener('click', exportMarkdown);
  $('#btn-export-txt').addEventListener('click', exportText);
  $('#btn-export-json').addEventListener('click', () => {
    const data = JSON.stringify({ ...state, savedAt: new Date().toISOString() }, null, 2);
    downloadBlob(data, 'application/json', `ResultSheet-backup-${getSafeFileName()}.json`);
    toast('Backup JSON file downloaded ✓');
  });
  $('#btn-share-transcript').addEventListener('click', shareResultSheet);

  // ── Secret Admin Shortcuts (Hidden from regular students) ──────────────────
  // 1. Keyboard Shortcut: Ctrl + Shift + A (or Cmd + Shift + A)
  window.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      e.preventDefault();
      try { await autoSyncToBatch(); } catch {}
      window.location.href = '/admin';
    }
  });

  // 2. Triple tap / click on University Brand Crest 🏛️
  let crestClicks = 0;
  let crestTimer = null;
  const brandCrest = $('.brand-crest') || $('.topbar-brand');
  if (brandCrest) {
    brandCrest.addEventListener('click', async () => {
      crestClicks++;
      clearTimeout(crestTimer);
      crestTimer = setTimeout(() => { crestClicks = 0; }, 1500);
      if (crestClicks >= 3) {
        crestClicks = 0;
        try { await autoSyncToBatch(); } catch {}
        window.location.href = '/admin';
      }
    });
  }

  // 3. Triple tap on footer MONTY
  let montyClicks = 0;
  let montyTimer = null;
  document.addEventListener('click', async (e) => {
    if (e.target.closest('#monty-tag')) {
      montyClicks++;
      clearTimeout(montyTimer);
      montyTimer = setTimeout(() => { montyClicks = 0; }, 1500);
      if (montyClicks >= 3) {
        montyClicks = 0;
        try { await autoSyncToBatch(); } catch {}
        window.location.href = '/admin';
      }
    }
  });
}

// ── Application Initialization ────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('./curriculum.json');
    if (!res.ok) throw new Error('Could not load course catalogue.');
    catalogue = await res.json();
    baseCourses = catalogue.courses.map(c => ({ ...c, id: `${c.semester}:${c.code}` }));

    // Populate semester dropdown in elective dialog
    $('#el-semester').innerHTML = SEMESTERS.map(s =>
      `<option value="${s}">${SEMESTER_LABELS[s] || s}</option>`
    ).join('');

    // Restore from localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        state = validateState(JSON.parse(saved));
      }
    } catch {}

    const initDeg = state.profile.degree && catalogue?.programmes?.[state.profile.degree]
      ? state.profile.degree
      : 'ABM';
    switchDegreeProgramme(initDeg);

    wire();
    renderProfile();
    render();

    // Automatically check cloud for any updates from other devices on launch
    if (state.profile.registration && cleanReg(state.profile.registration).length >= 6) {
      lastPullTimestamp = Date.now();
      syncFromCloudIfAvailable(cleanReg(state.profile.registration), { silent: true });
    }

    // Auto-sync initial state if details already filled
    scheduleAutoSync();

    // Re-push in case local changes were made while tab was hidden
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        scheduleAutoSync();
      }
    });
  } catch (err) {
    const box = $('#issues');
    if (box) {
      box.hidden = false;
      box.textContent = `${err.message} Please refresh the page.`;
    }
  }
}

init();
