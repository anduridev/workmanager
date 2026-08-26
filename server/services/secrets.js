/**
 * Encrypt/decrypt small secrets (mailbox password, OpenAI key) before they are stored in MongoDB.
 * AES-256-GCM with a key derived from APP_ENCRYPTION_KEY (or, if unset, JWT_SECRET) — the plaintext never
 * leaves the server and is never returned by the API.
 */
const crypto = require('crypto');

function key() {
  const src = process.env.APP_ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev-secret-change-me';
  return crypto.createHash('sha256').update(String(src)).digest();
}

function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

function decrypt(blob) {
  if (!blob) return '';
  try {
    const [v, iv, tag, data] = String(blob).split('.');
    if (v !== 'v1') return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return ''; // key changed / corrupt -> treat as "not set" so the UI asks for it again
  }
}

const mask = (s) => (s ? `••••${String(s).slice(-4)}` : '');

module.exports = { encrypt, decrypt, mask };
