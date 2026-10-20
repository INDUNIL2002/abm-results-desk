/**
 * supabase.mjs — Shared Supabase client configuration
 */
export const SUPABASE_URL = 'https://hxzwzduuwhsisbjcjpbh.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4end6ZHV1d2hzaXNiamNqcGJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0ODk4NzQsImV4cCI6MjEwODA2NTg3NH0.JsM6hCaOQYZW5sFLKzooxGYXpbgyyqQ3gUz6uG-8ebQ';

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
    registration:    payload.registration,
    name:            payload.name,
    batch:           payload.batch || '',
    results_through: payload.resultsThrough || '',
    cgpa:            typeof payload.cgpa === 'number' ? payload.cgpa : null,
    credits:         typeof payload.credits === 'number' ? payload.credits : null,
    graded_count:    typeof payload.gradedCount === 'number' ? payload.gradedCount : null,
    semesters:       Array.isArray(payload.semesters) ? payload.semesters : [],
    submitted_at:    new Date().toISOString(),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/submissions`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) throw new Error(await res.text());
  return true;
}
