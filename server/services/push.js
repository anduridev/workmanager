/**
 * Web Push (VAPID). Keys come from env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) or are generated once
 * and persisted in the Setting collection so they survive restarts without any configuration.
 */
const webpush = require('web-push');
const Setting = require('../models/Setting');
const PushSubscription = require('../models/PushSubscription');

let keys = null;

async function getKeys() {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    keys = await Setting.get('vapidKeys');
    if (!keys) {
      keys = webpush.generateVAPIDKeys();
      await Setting.set('vapidKeys', keys);
      console.log('[push] generated VAPID keys (stored in DB)');
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:workpa@example.com', keys.publicKey, keys.privateKey);
  return keys;
}

async function publicKey() {
  return (await getKeys()).publicKey;
}

async function subscribe(sub, meta = {}) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw Object.assign(new Error('Invalid push subscription'), { status: 400 });
  return PushSubscription.findOneAndUpdate(
    { endpoint: sub.endpoint },
    { endpoint: sub.endpoint, keys: sub.keys, expirationTime: sub.expirationTime || null, userAgent: meta.userAgent || '', label: meta.label || '', failures: 0 },
    { upsert: true, new: true }
  );
}

async function unsubscribe(endpoint) {
  await PushSubscription.deleteOne({ endpoint });
}

/** Send a payload to every subscribed device. Dead subscriptions (404/410) are removed. */
async function sendToAll(payload) {
  await getKeys();
  const subs = await PushSubscription.find();
  if (!subs.length) return { sent: 0, removed: 0 };
  const body = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys, expirationTime: s.expirationTime }, body, { TTL: 60 * 60 });
        sent++;
        await PushSubscription.updateOne({ _id: s._id }, { lastUsedAt: new Date(), failures: 0 });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: s._id });
          removed++;
        } else {
          await PushSubscription.updateOne({ _id: s._id }, { $inc: { failures: 1 } });
          console.warn('[push] send failed:', e.statusCode || e.message);
        }
      }
    })
  );
  return { sent, removed };
}

async function count() {
  return PushSubscription.countDocuments();
}

module.exports = { publicKey, subscribe, unsubscribe, sendToAll, count };
