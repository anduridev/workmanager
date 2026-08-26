/**
 * Single entry point for raising a notification: stores it (for the bell / in-app toast)
 * and pushes it to every subscribed device via Web Push.
 */
const Notification = require('../models/Notification');
const push = require('./push');

async function notify({ kind = 'system', title, body = '', refType, refId, link }) {
  const n = await Notification.create({ kind, title, body, refType, refId, link });
  push
    .sendToAll({ id: String(n._id), kind, title, body, link: link || '/', tag: String(n._id) })
    .catch((e) => console.warn('[push] error:', e.message));
  return n;
}

module.exports = { notify };
