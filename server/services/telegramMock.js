/** Offline in-memory fake of services/telegram.js (enabled with TELEGRAM_MOCK=1 — local UI testing only). */
let signedIn = false;
let msgId = 500;
const now = Date.now();
const H = 3600 * 1000;

const chats = {
  '-1001001': { title: 'Paybitz ⇄ Artha Support', username: 'paybitz_support', unreadCount: 2, members: 14 },
  '-1001002': { title: 'Global Bridge Support', username: '', unreadCount: 0, members: 9 },
  '-1001003': { title: 'Internal Devs', username: '', unreadCount: 5, members: 6 },
};
const msgs = {
  '-1001001': [
    { id: 101, date: new Date(now - 26 * H), out: false, text: 'Hi team, settlement file for yesterday seems short by 2 records', sender: 'Kiran (Paybitz)', replyToId: null, media: null },
    { id: 102, date: new Date(now - 25 * H), out: true, text: 'Checking with the ops team, will confirm in 30 mins', sender: 'You', replyToId: 101, media: null },
    { id: 103, date: new Date(now - 24 * H), out: false, text: 'Thanks. Also sharing the recon sheet', sender: 'Kiran (Paybitz)', replyToId: null, media: { kind: 'file', mime: 'text/csv', filename: 'recon-aug.csv', size: 48213 } },
    { id: 1035, date: new Date(now - 23 * H), out: false, text: 'Screenshot of the failing settlement screen', sender: 'Kiran (Paybitz)', replyToId: null, media: { kind: 'photo', mime: 'image/svg+xml', filename: 'photo-1035.svg', size: 900 } },
    { id: 104, date: new Date(now - 2 * H), out: false, text: 'Any update on the 2 missing records?', sender: 'Kiran (Paybitz)', replyToId: null, media: null },
    { id: 105, date: new Date(now - 1 * H), out: false, text: 'Our finance head is asking for ETA today', sender: 'Meera (Paybitz)', replyToId: null, media: null },
  ],
  '-1001002': [
    { id: 201, date: new Date(now - 50 * H), out: false, text: 'UAT sign-off done for the remittance flow 🎉', sender: 'Daniel (Global Bridge)', replyToId: null, media: null },
    { id: 202, date: new Date(now - 49 * H), out: true, text: 'Great! Production deployment is planned for Friday night', sender: 'You', replyToId: null, media: null },
  ],
  '-1001003': [{ id: 301, date: new Date(now - 3 * H), out: false, text: 'standup moved to 11', sender: 'Rahul', replyToId: null, media: null }],
};
const last = (id) => {
  const l = msgs[id][msgs[id].length - 1];
  return { text: l.text.slice(0, 120), date: l.date };
};

const svgPic = (label) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#eef2ff"/><rect x="16" y="16" width="448" height="238" rx="12" fill="#c7d2fe"/><text x="240" y="140" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#3730a3">${label}</text></svg>`
  );

module.exports = {
  configured: () => true,
  status: async () => (signedIn ? { configured: true, signedIn: true, me: { name: 'Artha Support', username: 'artha_support', phone: '+91900000000' } } : { configured: true, signedIn: false }),
  loginStart: async (phone) => ({ ok: true, phone }),
  loginComplete: async ({ code, password }) => {
    if (String(code) === '2fa' && !password) return { needPassword: true };
    if (String(code || '').length < 4) throw new Error('PHONE_CODE_INVALID');
    signedIn = true;
    return { ok: true };
  },
  logout: async () => {
    signedIn = false;
    return { ok: true };
  },
  dialogs: async () => Object.entries(chats).map(([id, c]) => ({ id, title: c.title, username: c.username, isChannel: false, members: c.members, unreadCount: c.unreadCount, lastMessage: last(id) })),
  overview: async (ids) => {
    const map = {};
    ids.forEach((id) => {
      if (chats[id]) map[id] = { unreadCount: chats[id].unreadCount, lastMessage: last(id), username: chats[id].username };
    });
    return map;
  },
  messages: async (chatId) => [...(msgs[chatId] || [])],
  send: async (chatId, text, replyToId) => {
    const m = { id: ++msgId, date: new Date(), out: true, text, sender: 'You', replyToId: replyToId || null, media: null };
    (msgs[chatId] = msgs[chatId] || []).push(m);
    return m;
  },
  media: async (chatId, msgId) => {
    const m = (msgs[chatId] || []).find((x) => x.id === Number(msgId));
    if (!m || !m.media) { const e = new Error('No media on that message'); e.status = 404; throw e; }
    if (m.media.kind === 'photo' || m.media.kind === 'image') return { buffer: svgPic(m.media.filename), mime: 'image/svg+xml', filename: m.media.filename };
    return { buffer: Buffer.from(['date,amount,ref', '2026-08-30,120000,TXN881', '2026-08-30,80500,TXN882', ''].join(String.fromCharCode(10))), mime: m.media.mime, filename: m.media.filename };
  },
  markRead: async (chatId) => {
    if (chats[chatId]) chats[chatId].unreadCount = 0;
    return { ok: true };
  },
};
