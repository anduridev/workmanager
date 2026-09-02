/**
 * Telegram support inbox — signs in as YOUR support Telegram account (MTProto via gramjs, not a bot),
 * so replies appear from you. Env vars (my.telegram.org → API development tools):
 *   TELEGRAM_API_ID, TELEGRAM_API_HASH
 * The signed-in session string is AES-encrypted in MongoDB (Setting 'telegram.session').
 * TELEGRAM_MOCK=1 swaps in an offline in-memory fake (local testing only).
 */

if (process.env.TELEGRAM_MOCK === '1') {
  module.exports = require('./telegramMock');
} else {
  const Setting = require('../models/Setting');
  const secrets = require('./secrets');

  const apiId = () => Number(process.env.TELEGRAM_API_ID || 0);
  const apiHash = () => (process.env.TELEGRAM_API_HASH || '').trim();
  const configured = () => Boolean(apiId() && apiHash());

  let live = null; // connected TelegramClient for the saved session
  let pending = null; // { client, phone, phoneCodeHash } while a sign-in is in progress
  const senderCache = new Map(); // senderId -> display name

  function lib() {
    // required lazily so the app still boots if the dependency ever fails to load
    const { TelegramClient, Api } = require('telegram');
    const { StringSession } = require('telegram/sessions');
    const { computeCheck } = require('telegram/Password');
    return { TelegramClient, Api, StringSession, computeCheck };
  }

  async function savedSession() {
    return secrets.decrypt(await Setting.get('telegram.session', ''));
  }

  /** Connected client for the saved session (throws when not signed in). */
  async function getClient() {
    if (live?.connected) return live;
    if (!configured()) throw new Error('Telegram is not configured — set TELEGRAM_API_ID and TELEGRAM_API_HASH');
    const session = await savedSession();
    if (!session) throw new Error('Not signed in to Telegram yet');
    const { TelegramClient, StringSession } = lib();
    const c = new TelegramClient(new StringSession(session), apiId(), apiHash(), { connectionRetries: 3 });
    await c.connect();
    if (!(await c.isUserAuthorized())) {
      await Setting.set('telegram.session', '');
      throw new Error('Telegram session expired — sign in again');
    }
    live = c;
    return c;
  }

  async function status() {
    if (!configured()) return { configured: false, signedIn: false };
    try {
      const c = await getClient();
      const me = await c.getMe();
      return { configured: true, signedIn: true, me: { name: [me.firstName, me.lastName].filter(Boolean).join(' '), username: me.username || '', phone: me.phone || '' } };
    } catch (e) {
      return { configured: true, signedIn: false, pendingPhone: pending?.phone || '', error: /not signed in/i.test(e.message) ? undefined : e.message };
    }
  }

  /** Step 1: send the login code to the phone. */
  async function loginStart(phone) {
    if (!configured()) throw new Error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH first');
    const { TelegramClient, StringSession } = lib();
    const c = new TelegramClient(new StringSession(''), apiId(), apiHash(), { connectionRetries: 3 });
    await c.connect();
    const res = await c.sendCode({ apiId: apiId(), apiHash: apiHash() }, phone);
    pending = { client: c, phone, phoneCodeHash: res.phoneCodeHash };
    return { ok: true, phone };
  }

  /** Step 2: complete with the received code (and the 2FA password when the account has one). */
  async function loginComplete({ code, password }) {
    if (!pending) throw new Error('Start the sign-in with your phone number first');
    const { Api, computeCheck } = lib();
    const { client: c, phone, phoneCodeHash } = pending;
    try {
      await c.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: String(code || '').trim() }));
    } catch (e) {
      if (String(e.errorMessage || e.message).includes('SESSION_PASSWORD_NEEDED')) {
        if (!password) return { needPassword: true };
        const pwd = await c.invoke(new Api.account.GetPassword());
        await c.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pwd, password) }));
      } else throw new Error(e.errorMessage || e.message);
    }
    await Setting.set('telegram.session', secrets.encrypt(c.session.save()));
    if (live) try { await live.disconnect(); } catch {}
    live = c;
    pending = null;
    return { ok: true };
  }

  async function logout() {
    try {
      if (live) await live.disconnect();
    } catch {}
    live = null;
    pending = null;
    senderCache.clear();
    await Setting.set('telegram.session', '');
    return { ok: true };
  }

  /** Groups/channels of the support account (to link one to a client). */
  async function dialogs() {
    const c = await getClient();
    const list = await c.getDialogs({ limit: 150 });
    return list
      .filter((d) => d.isGroup || d.isChannel)
      .map((d) => ({
        id: d.id.toString(),
        title: d.title || '',
        username: d.entity?.username || '',
        isChannel: Boolean(d.isChannel && !d.isGroup),
        members: d.entity?.participantsCount || null,
        unreadCount: d.unreadCount || 0,
        lastMessage: d.message ? { text: (d.message.message || '').slice(0, 120), date: new Date((d.message.date || 0) * 1000) } : null,
      }));
  }

  /** Unread count + last message per chat id, for the clients list. */
  async function overview(chatIds) {
    const all = await dialogs();
    const map = {};
    for (const d of all) if (chatIds.includes(d.id)) map[d.id] = { unreadCount: d.unreadCount, lastMessage: d.lastMessage, username: d.username };
    return map;
  }

  async function entity(c, chatId) {
    const bigInt = require('big-integer');
    try {
      return await c.getInputEntity(bigInt(String(chatId)));
    } catch {
      await c.getDialogs({ limit: 150 }); // refresh the entity cache, then retry
      return await c.getInputEntity(bigInt(String(chatId)));
    }
  }

  async function senderName(c, m) {
    const id = m.senderId?.toString();
    if (!id) return '';
    if (senderCache.has(id)) return senderCache.get(id);
    let name = '';
    try {
      const s = await m.getSender();
      name = s ? [s.firstName, s.lastName].filter(Boolean).join(' ') || s.title || s.username || id : id;
    } catch {
      name = id;
    }
    senderCache.set(id, name);
    return name;
  }

  /** Latest messages of a chat, oldest first. */
  async function messages(chatId, { limit = 50, maxId } = {}) {
    const c = await getClient();
    const ent = await entity(c, chatId);
    const list = await c.getMessages(ent, { limit: Math.min(100, limit), ...(maxId ? { maxId: Number(maxId) } : {}) });
    const out = [];
    for (const m of list) {
      out.push({
        id: m.id,
        date: new Date((m.date || 0) * 1000),
        out: Boolean(m.out),
        text: m.message || '',
        sender: m.out ? 'You' : await senderName(c, m),
        replyToId: m.replyTo?.replyToMsgId || null,
        media: mediaInfo(m),
        action: m.action ? 'service' : null, // joined/left/pinned etc.
      });
    }
    return out.reverse();
  }

  /** What kind of media a message carries (shape shared with the client). */
  function mediaInfo(m) {
    if (!m?.media) return null;
    if (m.photo) return { kind: 'photo', mime: 'image/jpeg', filename: `photo-${m.id}.jpg`, size: 0 };
    const doc = m.media.document;
    if (doc) {
      const attrs = doc.attributes || [];
      const filename = attrs.find((a) => a.className === 'DocumentAttributeFilename')?.fileName || '';
      const mime = doc.mimeType || 'application/octet-stream';
      const audio = attrs.find((a) => a.className === 'DocumentAttributeAudio');
      let kind = 'file';
      if (attrs.some((a) => a.className === 'DocumentAttributeSticker')) kind = mime === 'image/webp' ? 'image' : 'file';
      else if (audio?.voice) kind = 'voice';
      else if (mime.startsWith('audio/')) kind = 'audio';
      else if (mime.startsWith('video/')) kind = 'video';
      else if (mime.startsWith('image/')) kind = 'image';
      return { kind, mime, filename, size: Number(doc.size || 0) };
    }
    return { kind: 'other', mime: '', filename: '', size: 0 };
  }

  const MEDIA_MAX = 20 * 1024 * 1024; // bigger files: open in Telegram

  /** Download one message's media (the route streams it to the browser). */
  async function media(chatId, msgId) {
    const c = await getClient();
    const ent = await entity(c, chatId);
    const [m] = await c.getMessages(ent, { ids: [Number(msgId)] });
    if (!m || !m.media) {
      const e = new Error('No media on that message');
      e.status = 404;
      throw e;
    }
    const info = mediaInfo(m);
    if (info.size > MEDIA_MAX) {
      const e = new Error(`File is ${(info.size / 1048576).toFixed(1)} MB — open it in Telegram to view`);
      e.status = 413;
      throw e;
    }
    const buffer = await c.downloadMedia(m, {});
    if (!buffer || !buffer.length) {
      const e = new Error('Could not download the media');
      e.status = 404;
      throw e;
    }
    return { buffer, mime: info.mime, filename: info.filename || `media-${msgId}` };
  }

  async function send(chatId, text, replyToId) {
    const c = await getClient();
    const ent = await entity(c, chatId);
    const m = await c.sendMessage(ent, { message: text, ...(replyToId ? { replyTo: Number(replyToId) } : {}) });
    return { id: m.id, date: new Date((m.date || 0) * 1000), out: true, text, sender: 'You', replyToId: replyToId || null, media: null };
  }

  async function markRead(chatId) {
    const c = await getClient();
    await c.markAsRead(await entity(c, chatId));
    return { ok: true };
  }

  module.exports = { configured, status, loginStart, loginComplete, logout, dialogs, overview, messages, send, markRead, media };
}
