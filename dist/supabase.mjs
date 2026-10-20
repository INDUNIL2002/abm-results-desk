/**
 * supabase.mjs — Shared Supabase client configuration & CRUD operations
 * With smart cross-device semester merging and registration normalization.
 */
export const SUPABASE_URL = 'https://hxzwzduuwhsisbjcjpbh.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4end6ZHV1d2hzaXNiamNqcGJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0ODk4NzQsImV4cCI6MjEwODA2NTg3NH0.JsM6hCaOQYZW5sFLKzooxGYXpbgyyqQ3gUz6uG-8ebQ';

const defaultHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

export const cleanReg = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
export const cleanName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

export async function fetchSubmissionsFromSupabase() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/submissions?select=*&order=cgpa.desc.nullslast`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

export async function fetchSubmissionByRegistration(registration) {
  const reg = cleanReg(registration);
  if (!reg) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/submissions?registration=eq.${encodeURIComponent(reg)}&select=*`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (!res.ok) return null;
    const list = await res.json();
    return list.length ? list[0] : null;
  } catch {
    return null;
  }
}

export async function upsertSubmissionToSupabase(payload) {
  const reg = cleanReg(payload.registration);
  if (!reg) return false;

  const incomingName = cleanName(payload.name);
  const incomingBatch = payload.batch || '';
  const incomingThrough = payload.results_through || payload.resultsThrough || '';
  const incomingSemesters = Array.isArray(payload.semesters) ? payload.semesters : [];

  // Try to check existing cloud record to perform smart merge across devices
  let mergedSemesters = [...incomingSemesters];
  let finalName = incomingName;
  let finalBatch = incomingBatch;
  let finalThrough = incomingThrough;

  try {
    const existing = await fetchSubmissionByRegistration(reg);
    if (existing && Array.isArray(existing.semesters) && existing.semesters.length > 0) {
      if (!finalName && existing.name) finalName = existing.name;
      if (!finalBatch && existing.batch) finalBatch = existing.batch;

      // Map incoming semesters by key
      const incomingMap = new Map(incomingSemesters.map(s => [s.semester, s]));

      // Merge: keep all semesters from existing that are not in incoming, or update with newer incoming
      const allSemKeys = new Set([...existing.semesters.map(s => s.semester), ...incomingSemesters.map(s => s.semester)]);
      const semsOrder = ['1-I', '1-II', '2-I', '2-II', '3-I', '3-II', '4-I', '4-II'];

      mergedSemesters = [];
      for (const semKey of semsOrder) {
        if (!allSemKeys.has(semKey)) continue;
        const inc = incomingMap.get(semKey);
        const ext = existing.semesters.find(s => s.semester === semKey);
        if (inc && (inc.gradedCount > 0 || (inc.courses && inc.courses.length > 0))) {
          mergedSemesters.push(inc);
        } else if (ext) {
          mergedSemesters.push(ext);
        } else if (inc) {
          mergedSemesters.push(inc);
        }
      }
    }
  } catch (err) {
    console.warn('Could not check existing cloud record before upsert:', err);
  }

  // Calculate combined totals from merged semesters
  let totalPoints = 0;
  let totalCredits = 0;
  let totalGraded = 0;

  mergedSemesters.forEach(sem => {
    if (sem.gpa != null && sem.credits) {
      totalPoints += Number(sem.gpa) * Number(sem.credits);
      totalCredits += Number(sem.credits);
    }
    totalGraded += Number(sem.gradedCount || 0);
  });

  const finalCgpa = totalCredits > 0 ? (totalPoints / totalCredits) : (payload.cgpa != null ? Number(payload.cgpa) : null);
  const finalTotalCredits = totalCredits > 0 ? totalCredits : (payload.credits != null ? Number(payload.credits) : null);
  const finalGradedCount = totalGraded > 0 ? totalGraded : (payload.graded_count != null ? Number(payload.graded_count) : (payload.gradedCount != null ? Number(payload.gradedCount) : null));

  const row = {
    registration:    reg,
    name:            finalName,
    batch:           finalBatch || '2021/2022',
    results_through: finalThrough,
    cgpa:            finalCgpa != null ? Math.round(finalCgpa * 10000) / 10000 : null,
    credits:         finalTotalCredits,
    graded_count:    finalGradedCount,
    semesters:       mergedSemesters,
    submitted_at:    new Date().toISOString(),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/submissions`, {
    method: 'POST',
    headers: {
      ...defaultHeaders,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) throw new Error(await res.text());
  return true;
}

export async function deleteSubmissionFromSupabase(registration) {
  const enc = encodeURIComponent(cleanReg(registration));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/submissions?registration=eq.${enc}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return true;
}

export async function updateSubmissionInSupabase(registration, patchData) {
  const enc = encodeURIComponent(cleanReg(registration));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/submissions?registration=eq.${enc}`, {
    method: 'PATCH',
    headers: {
      ...defaultHeaders,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(patchData),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}
