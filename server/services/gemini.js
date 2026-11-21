// Gemini proposal service. Gemini only explains the supplied evidence. Its JSON is parsed
// and verified (shared/proposal.js); on any failure the deterministic fallback is returned.

import { GoogleGenAI } from '@google/genai';
import {
  SYSTEM_PROMPT, buildUserPrompt, verifyProposal, buildFallbackProposal,
} from '../../shared/proposal.js';

export const DEFAULT_MODEL = 'gemini-2.5-flash';

export function createGeminiClient(apiKey) {
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Gemini request timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function parseJsonText(text) {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

async function callGemini(client, model, contents, timeoutMs) {
  const response = await withTimeout(client.models.generateContent({
    model,
    contents,
    config: { systemInstruction: SYSTEM_PROMPT, responseMimeType: 'application/json', temperature: 0.2 },
  }), timeoutMs);
  return parseJsonText(response.text);
}

/**
 * @returns {Promise<{proposal:object, source:'gemini'|'fallback', model:string|null, warnings:string[]}>}
 */
export async function generateVerifiedProposal(evidence, { client, model = DEFAULT_MODEL, timeoutMs = 30000, attempts = 2 } = {}) {
  const fallback = () => buildFallbackProposal(evidence);
  if (!client) {
    return { proposal: fallback(), source: 'fallback', model: null, warnings: ['Gemini is not configured on the server (GEMINI_API_KEY missing).'] };
  }

  const warnings = [];
  let contents = buildUserPrompt(evidence);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const raw = await callGemini(client, model, contents, timeoutMs);
      const result = verifyProposal(raw, evidence);
      if (result.ok) return { proposal: result.proposal, source: 'gemini', model, warnings };
      warnings.push(`Attempt ${attempt} rejected: ${result.errors.slice(0, 4).join(' | ')}`);
      // One repair attempt: tell the model exactly what was unsupported. It still cannot add numbers.
      contents = `${buildUserPrompt(evidence)}\n\nYour previous JSON was rejected for: ${result.errors.slice(0, 6).join('; ')}.\nReturn corrected JSON using only the supplied metric IDs, source IDs and numbers.`;
    } catch (error) {
      warnings.push(`Attempt ${attempt} failed: ${String(error?.message || error).slice(0, 200)}`);
      if (/timed out|429|quota|API key|permission|401|403/i.test(String(error?.message))) break;
    }
  }
  return { proposal: fallback(), source: 'fallback', model, warnings };
}
