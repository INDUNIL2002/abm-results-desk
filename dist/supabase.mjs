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

export const GRADE_POINTS = {
  'A+': 4.0, 'A': 4.0, 'A-': 3.7,
  'B+': 3.3, 'B': 3.0, 'B-': 2.7,
  'C+': 2.3, 'C': 2.0, 'C-': 1.7,
  'D+': 1.3, 'D': 1.0, 'E': 0.0,
};

export async function fetchSubmissionsFromSupabase() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/submissions?select=*&order=cgpa.desc.nullslast`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
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
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
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

  const row = {
    registration:    reg,
    name:            cleanName(payload.name),
    batch:           payload.batch || '2021/2022',
    results_through: payload.results_through || payload.resultsThrough || '',
    cgpa:            payload.cgpa != null ? Math.round(Number(payload.cgpa) * 10000) / 10000 : null,
    credits:         payload.credits != null ? Number(payload.credits) : 0,
    graded_count:    payload.graded_count != null ? Number(payload.graded_count) : (payload.gradedCount != null ? Number(payload.gradedCount) : 0),
    semesters:       Array.isArray(payload.semesters) ? payload.semesters : [],
    submitted_at:    new Date().toISOString(),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/submissions?on_conflict=registration`, {
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
