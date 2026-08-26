/**
 * Gmail via Google OAuth 2.0 (user clicks "Connect Gmail", approves on Google's consent screen).
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, optional GOOGLE_REDIRECT_URI (default <app url>/api/expenses/gmail/callback).
 * The refresh token is stored encrypted in MongoDB (Setting "expense.gmail"); scope is gmail.readonly only.
 */
const jwt = require('jsonwebtoken');
const Setting = require('../models/Setting');
const { encrypt, decrypt } = require('./secrets');
const { looksLikeBankMail, bodyText, cfgFrom } = require('./mail');

const KEY = 'expense.gmail';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const STATE_SECRET = () => process.env.JWT_SECRET || 'dev-secret-change-me';

const env = () => ({ clientId: (process.env.GOOGLE_CLIENT_ID || '').trim(), clientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(), redirectUri: (process.env.GOOGLE_REDIRECT_URI || '').trim() });
const configured = () => Boolean(env().clientId && env().clientSecret);

/** Redirect URI: env override, else derived from the request (Railway sits behind a proxy -> x-forwarded-proto). */
function redirectUri(req) {
  if (env().redirectUri) return env().redirectUri;
  if (process.env.APP_URL) return `${process.env.APP_URL.replace(/\/+$/, '')}/api/expenses/gmail/callback`;
  const proto = req?.get?.('x-forwarded-proto') || req?.protocol || 'https';
  const host = req?.get?.('x-forwarded-host') || req?.get?.('host') || 'localhost';
  return `${proto}://${host}/api/expenses/gmail/callback`;
}

function authUrl(req) {
  if (!configured()) throw Object.assign(new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server first'), { status: 400 });
  const state = jwt.sign({ purpose: 'gmail', sub: req.user?.sub }, STATE_SECRET(), { expiresIn: '15m' });
  const p = new URLSearchParams({
    client_id: env().clientId,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // always get a refresh token back
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env().clientId, client_secret: env().clientSecret, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google: ${data.error_description || data.error || res.statusText}`);
  return data;
}

/** OAuth callback: verify state, exchange the code, store the refresh token + account e-mail. */
async function handleCallback(req) {
  const { code, state, error } = req.query;
  if (error) throw new Error(`Google refused: ${error}`);
  try {
    const s = jwt.verify(state, STATE_SECRET());
    if (s.purpose !== 'gmail') throw new Error('bad purpose');
  } catch {
    throw new Error('Login link expired or invalid — open Settings and click Connect Gmail again');
  }
  const tok = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri(req) });
  const prev = (await Setting.get(KEY)) || {};
  const refresh = tok.refresh_token || decrypt(prev.refreshTokenEnc);
  if (!refresh) throw new Error('Google did not return a refresh token — remove WorkPA under myaccount.google.com/permissions and connect again');
  const conn = { refreshTokenEnc: encrypt(refresh), accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in || 3600) * 1000 - 60000, connectedAt: new Date(), scope: tok.scope };
  await Setting.set(KEY, conn);
  const profile = await api('/profile');
  conn.email = profile.emailAddress;
  await Setting.set(KEY, conn);
  await Setting.set('expense.mail', { ...((await Setting.get('expense.mail')) || {}), provider: 'gmail', lastUid: 0, lastError: '', lastAfter: 0 });
  return conn.email;
}

async function connection() {
  const c = (await Setting.get(KEY)) || {};
  const connected = Boolean(decrypt(c.refreshTokenEnc));
  if (connected && !c.email) {
    // profile lookup failed at connect time (e.g. Gmail API was not enabled yet) -> fill it in now
    try {
      const profile = await api('/profile');
      if (profile.emailAddress) {
        c.email = profile.emailAddress;
        await Setting.set(KEY, c);
      }
    } catch {
      /* shown as connected without an address until the API works */
    }
  }
  return { connected, email: c.email || '', connectedAt: c.connectedAt || null };
}

async function disconnect() {
  const c = (await Setting.get(KEY)) || {};
  const refresh = decrypt(c.refreshTokenEnc);
  if (refresh) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST' }).catch(() => {});
  await Setting.set(KEY, {});
  const m = (await Setting.get('expense.mail')) || {};
  if (m.provider === 'gmail') await Setting.set('expense.mail', { ...m, provider: m.host ? 'imap' : '', lastError: '' });
}

async function accessToken() {
  const c = (await Setting.get(KEY)) || {};
  const refresh = decrypt(c.refreshTokenEnc);
  if (!refresh) throw new Error('Gmail is not connected — open Expenses → Settings → Connect Gmail');
  if (c.accessToken && c.expiresAt && Date.now() < c.expiresAt) return c.accessToken;
  let tok;
  try {
    tok = await tokenRequest({ refresh_token: refresh, grant_type: 'refresh_token' });
  } catch (e) {
    if (/invalid_grant/i.test(e.message)) throw new Error('Gmail access was revoked or expired (Google removes tokens of apps in "Testing" status after 7 days) — connect Gmail again');
    throw e;
  }
  await Setting.set(KEY, { ...c, accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in || 3600) * 1000 - 60000 });
  return tok.access_token;
}

async function api(path, params) {
  const token = await accessToken();
  const url = `${API}${path}${params ? `${path.includes('?') ? '&' : '?'}${new URLSearchParams(params)}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${data.error?.message || res.statusText}`);
  return data;
}

const b64 = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
function extract(payload, acc = { text: '', html: '' }) {
  if (!payload) return acc;
  const mime = payload.mimeType || '';
  if (payload.body?.data) {
    if (mime === 'text/plain' && !acc.text) acc.text = b64(payload.body.data);
    else if (mime === 'text/html' && !acc.html) acc.html = b64(payload.body.data);
  }
  (payload.parts || []).forEach((p) => extract(p, acc));
  return acc;
}
const header = (msg, name) => (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
const parseFrom = (v) => {
  const m = String(v).match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim(), address: m[2].trim() } : { name: '', address: String(v).trim() };
};

// Broad full-text search (Gmail stems words and searches subject + body); the metadata pass below narrows it down.
const BROAD_QUERY =
  '{debited credited "debited from" "credited to" spent paid payment transaction txn upi "credit card" "debit card" "a/c" account statement emi refund withdrawn withdrawal salary invoice receipt order autopay mandate "rs." inr rupees}';
const AMOUNT_HINT = /(?:rs\.?|inr|₹|rupees)\s*:?\s*\d|\d[\d,]*(?:\.\d{1,2})?\s*(?:rs\.?|inr|rupees)\b/i;
const MONEY_WORDS = /debited|credited|spent|paid|payment|transaction|txn|withdraw|refund|salary|emi|autopay|charged|purchase/i;

/** Same shape as mail.fetchBankEmails: { emails, scanned, matched, skipped, maxAfter } */
async function fetchBankEmails(cfg, { sinceDays = 30, afterEpoch = 0, limit = 300 } = {}) {
  const c = cfgFrom(cfg);
  const since = Math.max(afterEpoch || 0, Math.floor(Date.now() / 1000) - sinceDays * 86400);
  const q = `after:${since} -in:spam -in:trash ${BROAD_QUERY}`;
  const ids = [];
  let pageToken;
  do {
    const r = await api('/messages', { q, maxResults: '500', ...(pageToken ? { pageToken } : {}) });
    (r.messages || []).forEach((m) => ids.push(m.id));
    pageToken = r.nextPageToken;
  } while (pageToken && ids.length < 5000);
  // newest first from Gmail -> process oldest first so the cursor moves forward sensibly
  ids.reverse();
  // Pass 1 (cheap, headers + snippet): keep mails that look like bank alerts OR mention an amount together with a money word.
  const candidates = [];
  let matched = 0;
  for (const id of ids) {
    try {
      const meta = await api(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      const from = parseFrom(header(meta, 'From'));
      const subject = header(meta, 'Subject');
      const bankLike = looksLikeBankMail({ from: [from], subject }, c);
      if (bankLike) matched++;
      const probe = `${subject}\n${meta.snippet || ''}`;
      const hinted = AMOUNT_HINT.test(probe) && MONEY_WORDS.test(probe);
      if (c.senders.length ? bankLike : bankLike || hinted) candidates.push({ id, from, subject, bankLike });
    } catch (e) {
      console.warn(`[gmail] ${id}: ${e.message}`);
    }
  }
  // Pass 2: download the candidates (newest `limit`), the parser (rules / AI) has the final say.
  const emails = [];
  const wanted = candidates.slice(-limit);
  for (const cand of wanted) {
    const { id, from, subject, bankLike } = cand;
    try {
      const full = await api(`/messages/${id}`, { format: 'full' });
      const { text, html } = extract(full.payload);
      emails.push({
        uid: 0,
        gmailId: id,
        messageId: header(full, 'Message-ID') || `gmail-${id}`,
        subject,
        from: from.address,
        fromName: from.name,
        date: new Date(Number(full.internalDate) || Date.now()),
        text: bodyText({ text, html }).slice(0, 6000),
        bankLike,
      });
    } catch (e) {
      console.warn(`[gmail] ${id}: ${e.message}`);
    }
  }
  console.log(`[gmail] scanned ${ids.length}, candidates ${candidates.length} (bank-like ${matched}), downloaded ${emails.length}`);
  return { emails, scanned: ids.length, matched, candidates: candidates.length, skipped: Math.max(0, candidates.length - wanted.length), maxAfter: Math.floor(Date.now() / 1000) - 86400 }; // 1-day overlap; dedupe handles repeats
}

async function test() {
  const profile = await api('/profile');
  const c = (await Setting.get(KEY)) || {};
  if (profile.emailAddress && c.email !== profile.emailAddress) await Setting.set(KEY, { ...c, email: profile.emailAddress });
  const r = await fetchBankEmails({}, { sinceDays: 14, limit: 0 });
  return { ok: true, email: profile.emailAddress, total: profile.messagesTotal, recent: r.scanned, matched: r.matched };
}

module.exports = { configured, redirectUri, authUrl, handleCallback, connection, disconnect, fetchBankEmails, test, SCOPE };
