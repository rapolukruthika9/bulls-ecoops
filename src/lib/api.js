// Thin client for the Express API. Keys never reach the browser; these calls only ever send
// computed evidence and declared assumptions.

async function json(path, options) {
  const res = await fetch(path, options);
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error(`API unavailable (${res.status}). Is the server running?`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

const post = (path, body) => json(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export const getHealth = () => json('/api/health');
export const requestSolarEstimate = (body) => post('/api/solar-estimate', body);
export const requestProposal = (evidence) => post('/api/proposal', { evidence });
/** Server-rendered PDF (US Letter or A4). Returns a Blob. */
export async function requestReportPdf(body) {
  const res = await fetch('/api/report-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    let message = `PDF request failed (${res.status}).`;
    try { message = (await res.json()).error || message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  return res.blob();
}
export const requestBrainstorm = (context) => post('/api/brainstorm', { context });
