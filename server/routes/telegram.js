const router = require('express').Router();
const wrap = require('../middleware/asyncHandler');
const tg = require('../services/telegram');
const TelegramLink = require('../models/TelegramLink');

router.get(
  '/status',
  wrap(async (req, res) => {
    // canManage: only the admin may sign the shared support account in/out
    res.json({ ...(await tg.status()), canManage: (req.user?.role || 'admin') === 'admin' });
  })
);

const adminOnly = (req, res, next) => ((req.user?.role || 'admin') === 'admin' ? next() : res.status(403).json({ error: 'Only the admin can sign the support account in or out' }));

// Sign in as the support account: phone -> code (-> 2FA password)
router.post(
  '/login/start',
  adminOnly,
  wrap(async (req, res) => {
    const phone = String(req.body?.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'Phone number (with country code) is required' });
    try {
      res.json(await tg.loginStart(phone));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  })
);
router.post(
  '/login/complete',
  adminOnly,
  wrap(async (req, res) => {
    try {
      res.json(await tg.loginComplete({ code: req.body?.code, password: req.body?.password }));
    } catch (e) {
      const msg = String(e.message || '');
      res.status(400).json({ error: msg.includes('PHONE_CODE_INVALID') ? 'That code is not correct' : msg.includes('PASSWORD_HASH_INVALID') ? 'Wrong 2FA password' : msg });
    }
  })
);
router.post(
  '/logout',
  adminOnly,
  wrap(async (req, res) => {
    res.json(await tg.logout());
  })
);

// Clients + their linked groups (with unread/last-message when signed in)
router.get(
  '/clients',
  wrap(async (req, res) => {
    const links = await TelegramLink.find().sort({ order: 1, name: 1 }).lean();
    let extra = {};
    try {
      extra = await tg.overview(links.filter((l) => l.chatId).map((l) => l.chatId));
    } catch {
      extra = {}; // not signed in yet — plain list
    }
    res.json(links.map((l) => ({ ...l, ...(extra[l.chatId] || {}) })));
  })
);
router.post(
  '/clients',
  wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Client name is required' });
    try {
      res.status(201).json(await TelegramLink.create({ name }));
    } catch (e) {
      res.status(400).json({ error: e.code === 11000 ? 'A client with that name already exists' : e.message });
    }
  })
);
router.put(
  '/clients/:id',
  wrap(async (req, res) => {
    const doc = await TelegramLink.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Client not found' });
    if (req.body.name !== undefined) doc.name = String(req.body.name).trim() || doc.name;
    if (req.body.chatId !== undefined) {
      doc.chatId = String(req.body.chatId || '');
      doc.chatTitle = String(req.body.chatTitle || '');
      doc.chatUsername = String(req.body.chatUsername || '');
    }
    await doc.save();
    res.json(doc);
  })
);
router.delete(
  '/clients/:id',
  wrap(async (req, res) => {
    await TelegramLink.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  })
);

// Groups of the signed-in account (for the "link a group" picker)
router.get(
  '/dialogs',
  wrap(async (req, res) => {
    try {
      res.json(await tg.dialogs());
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  })
);

// Messages of a linked chat; opening marks it read
router.get(
  '/messages',
  wrap(async (req, res) => {
    const chat = String(req.query.chat || '');
    if (!chat) return res.status(400).json({ error: 'chat is required' });
    try {
      const list = await tg.messages(chat, { limit: Number(req.query.limit) || 50 });
      if (req.query.markRead !== 'false') tg.markRead(chat).catch(() => {});
      res.json(list);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  })
);
router.post(
  '/messages',
  wrap(async (req, res) => {
    const { chat, text, replyTo } = req.body || {};
    if (!chat || !String(text || '').trim()) return res.status(400).json({ error: 'chat and text are required' });
    try {
      res.status(201).json(await tg.send(String(chat), String(text).trim(), replyTo || null));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  })
);

module.exports = router;
