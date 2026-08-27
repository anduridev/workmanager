/**
 * Minimal OpenAI Chat Completions client (plain fetch, no SDK). The key comes from the Expenses settings
 * (stored encrypted in MongoDB) or, as a fallback, from OPENAI_API_KEY.
 */
const Setting = require('../models/Setting');
const { decrypt } = require('./secrets');

const DEFAULT_MODEL = 'gpt-4o-mini';
const MODELS = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-5-mini', 'gpt-5'];

async function settings() {
  const s = (await Setting.get('expense.openai')) || {};
  const stored = decrypt(s.keyEnc);
  const envKey = (process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY || process.env.OPENAI_KEY || '').trim();
  const key = stored || envKey;
  return { key, model: s.model || process.env.OPENAI_MODEL || DEFAULT_MODEL, fromEnv: !stored && Boolean(envKey) };
}

async function enabled() {
  return Boolean((await settings()).key);
}

/**
 * chat({ system, user, json, maxTokens, temperature, key, model }) -> string (or parsed object when json=true)
 */
async function chat({ system, user, json = false, maxTokens = 1200, temperature = 0.2, key, model } = {}) {
  const s = await settings();
  const apiKey = key || s.key;
  if (!apiKey) throw new Error('OpenAI key is not set — add it under Expenses → Settings');
  const body = {
    model: model || s.model,
    messages: [system && { role: 'system', content: system }, { role: 'user', content: user }].filter(Boolean),
    max_completion_tokens: maxTokens,
  };
  // Reasoning models (gpt-5*, o*) reject a custom temperature; the others accept it
  if (!/^(gpt-5|o\d)/.test(body.model)) body.temperature = temperature;
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: { message: text.slice(0, 200) } };
  }
  if (!res.ok) {
    const err = new Error(`OpenAI ${res.status}: ${data.error?.message || res.statusText}`);
    err.status = res.status === 401 ? 400 : 502;
    throw err;
  }
  const content = data.choices?.[0]?.message?.content || '';
  if (!json) return content;
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('OpenAI returned a non-JSON answer');
  }
}

/** Cheap round trip to validate a key + model. */
async function test({ key, model } = {}) {
  const out = await chat({ user: 'Reply with the single word OK.', maxTokens: 20, key, model, temperature: 0 });
  return { ok: true, reply: String(out).trim().slice(0, 40), model: model || (await settings()).model };
}

module.exports = { chat, test, enabled, settings, MODELS, DEFAULT_MODEL };
