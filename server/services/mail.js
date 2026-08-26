/**
 * Mailbox reader for the Expense Manager: connects over IMAP (Gmail / Outlook / Zoho / any provider with an
 * app password), lists new messages, keeps only bank / payment alerts and returns their plain text.
 */
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const dayjs = require('dayjs');

// Senders that typically send transaction alerts (banks, cards, wallets, brokers, billers)
const SENDER_RX =
  /bank|hdfc|icici|sbi|axis|kotak|yesbank|indusind|idfc|federal|baroda|bob|pnb|canara|union|aubank|rbl|standardchartered|scb|hsbc|citi|amex|americanexpress|dbs|bandhan|karur|kvb|southindian|tmb|paytm|phonepe|gpay|googlepay|google\.com|cred\b|onecard|slice|jupiter|fi\.money|niyo|zerodha|groww|upstox|kuvera|coin|razorpay|billdesk|paypal|stripe|payu|cashfree|sodexo|pluxee|amazonpay|mobikwik|freecharge|lic|insurance|mutualfund|nps|epfo|pfrda|alerts?@|txn|transaction|notify|noreply|no-reply|donotreply/i;
const SUBJECT_RX =
  /transaction|debit|credit|spent|payment|paid|purchase|txn|alert|statement|upi|card|a\/c|acct|account|emi|withdraw|received|refund|bill|charge|invoice|receipt|order|salary|neft|imps|rtgs|autopay|mandate/i;
const STRONG_RX = /debited|credited|spent|transaction alert|txn alert|charged|withdrawn|payment (?:of|received|successful)|has been paid|salary/i;
const SKIP_RX = /otp|one[- ]time password|verification code|unsubscribe now|newsletter|webinar|job alert|apply now|pre-approved|congratulations you|lucky|offer ends|% off|sale is live/i;

function cfgFrom(input) {
  const c = input || {};
  return {
    host: String(c.host || '').trim(),
    port: Number(c.port || 993),
    secure: c.secure !== false && c.secure !== 'false',
    user: String(c.user || '').trim(),
    pass: String(c.pass || ''),
    folder: String(c.folder || 'INBOX').trim() || 'INBOX',
    senders: Array.isArray(c.senders) ? c.senders.map((s) => String(s).trim().toLowerCase()).filter(Boolean) : [],
  };
}

async function withClient(cfg, fn) {
  const c = cfgFrom(cfg);
  if (!c.host || !c.user || !c.pass) throw new Error('Mailbox is not configured (host, username and app password are required)');
  const client = new ImapFlow({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass },
    logger: false,
    emitLogs: false,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
  });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(friendly(e));
  }
  try {
    return await fn(client, c);
  } finally {
    await client.logout().catch(() => {});
  }
}

function friendly(e) {
  const m = String(e?.message || e);
  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication failed|Application-specific password/i.test(m))
    return 'Mailbox login failed — check the username and use an app password (not your normal password)';
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return `Mail server not found: ${m.match(/ENOTFOUND\s*(\S+)/)?.[1] || 'check the IMAP host'}`;
  if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(m)) return 'Could not reach the mail server (check host/port, TLS and that IMAP is enabled)';
  return m.replace(/^Error:\s*/, '');
}

/** Does this envelope look like a bank / payment alert? */
function looksLikeBankMail(envelope, c) {
  const from = envelope?.from?.[0] || {};
  const fromStr = `${from.name || ''} ${from.address || ''}`.toLowerCase();
  const subject = envelope?.subject || '';
  if (SKIP_RX.test(subject) && !STRONG_RX.test(subject)) return false;
  if (c.senders.length) return c.senders.some((s) => fromStr.includes(s)) && (SUBJECT_RX.test(subject) || STRONG_RX.test(subject));
  if (STRONG_RX.test(subject)) return true;
  return SENDER_RX.test(fromStr) && SUBJECT_RX.test(subject);
}

/** Plain text from a parsed message (mailparser gives text for text/plain parts; html-only mails are stripped here). */
function bodyText(parsed) {
  let t = parsed.text || '';
  if (!t.trim() && parsed.html) {
    t = String(parsed.html)
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#39;|&rsquo;/gi, "'")
      .replace(/&quot;/gi, '"');
  }
  return t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/** Connection test: login, open the folder, report message count + how many recent mails look like alerts. */
async function test(cfg) {
  return withClient(cfg, async (client, c) => {
    const lock = await client.getMailboxLock(c.folder);
    try {
      const since = dayjs().subtract(14, 'day').toDate();
      const uids = (await client.search({ since }, { uid: true })) || [];
      let matched = 0;
      const sample = [];
      if (uids.length) {
        for await (const msg of client.fetch(uids.slice(-400), { uid: true, envelope: true }, { uid: true })) {
          if (looksLikeBankMail(msg.envelope, c)) {
            matched++;
            if (sample.length < 5) sample.push({ from: msg.envelope.from?.[0]?.address, subject: msg.envelope.subject });
          }
        }
      }
      return { ok: true, folder: c.folder, total: client.mailbox?.exists || 0, recent: uids.length, matched, sample };
    } finally {
      lock.release();
    }
  });
}

/**
 * Fetch bank-looking mails. { sinceDays, afterUid, limit } -> { emails: [{uid, messageId, subject, from, date, text}], maxUid, scanned }
 */
async function fetchBankEmails(cfg, { sinceDays = 30, afterUid = 0, limit = 200 } = {}) {
  return withClient(cfg, async (client, c) => {
    const lock = await client.getMailboxLock(c.folder);
    try {
      const since = dayjs().subtract(sinceDays, 'day').toDate();
      const query = afterUid > 0 ? { uid: `${afterUid + 1}:*`, since } : { since };
      let uids = (await client.search(query, { uid: true })) || [];
      uids = uids.filter((u) => u > afterUid).sort((a, b) => a - b);
      const maxUid = uids.length ? uids[uids.length - 1] : afterUid;
      const matched = [];
      for (let i = 0; i < uids.length; i += 500) {
        const chunk = uids.slice(i, i + 500);
        for await (const msg of client.fetch(chunk, { uid: true, envelope: true }, { uid: true })) {
          if (looksLikeBankMail(msg.envelope, c)) matched.push(msg.uid);
        }
      }
      const emails = [];
      const wanted = matched.slice(-limit);
      for (let i = 0; i < wanted.length; i += 50) {
        const chunk = wanted.slice(i, i + 50);
        for await (const msg of client.fetch(chunk, { uid: true, envelope: true, internalDate: true, source: { maxLength: 300 * 1024 } }, { uid: true })) {
          try {
            const parsed = await simpleParser(msg.source);
            emails.push({
              uid: msg.uid,
              messageId: parsed.messageId || msg.envelope?.messageId || `uid-${c.user}-${msg.uid}`,
              subject: parsed.subject || msg.envelope?.subject || '',
              from: parsed.from?.value?.[0]?.address || msg.envelope?.from?.[0]?.address || '',
              fromName: parsed.from?.value?.[0]?.name || msg.envelope?.from?.[0]?.name || '',
              date: parsed.date || msg.internalDate || new Date(),
              text: bodyText(parsed).slice(0, 6000),
            });
          } catch (e) {
            console.warn(`[mail] could not parse uid ${msg.uid}: ${e.message}`);
          }
        }
      }
      return { emails, maxUid, scanned: uids.length, matched: matched.length, skipped: Math.max(0, matched.length - wanted.length) };
    } finally {
      lock.release();
    }
  });
}

module.exports = { test, fetchBankEmails, looksLikeBankMail, bodyText, cfgFrom, friendly };
