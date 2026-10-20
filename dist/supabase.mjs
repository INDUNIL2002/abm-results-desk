/**
 * supabase.mjs — Shared Supabase client configuration & CRUD operations
 */
export const SUPABASE_URL = 'https://hxzwzduuwhsisbjcjpbh.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4end6ZHV1d2hzaXNiamNqcGJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0ODk4NzQsImV4cCI6MjEwODA2NTg3NH0.JsM6hCaOQYZW5sFLKzooxGYXpbgyyqQ3gUz6uG-8ebQ';

const defaultHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

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

export async function upsertSubmissionToSupabase(payload) {
  const row = {
    registration:    String(payload.registration || '').trim(),
    name:            String(payload.name || '').trim(),
    batch:           payload.batch || '2021/2022',
    results_through: payload.results_through || payload.resultsThrough || '',
    cgpa:            payload.cgpa != null && payload.cgpa !== '' ? Number(payload.cgpa) : null,
    credits:         payload.credits != null && payload.credits !== '' ? Number(payload.credits) : null,
    graded_count:    payload.graded_count != null ? Number(payload.graded_count) : (payload.gradedCount != null ? Number(payload.gradedCount) : null),
    semesters:       Array.isArray(payload.semesters) ? payload.semesters : [],
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
  const enc = encodeURIComponent(String(registration).trim());
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
  const enc = encodeURIComponent(String(registration).trim());
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
