/**
 * Turns bank / payment alert e-mails into transactions.
 *   1) rule-based extraction (amount, debit/credit, merchant, account, method) — works offline, no key needed
 *   2) optional OpenAI pass (batched) that reads the mails and returns clean JSON — better merchants & categories
 */
const dayjs = require('dayjs');
const Expense = require('../models/Expense');
const ai = require('./ai');

const CATEGORIES = Expense.CATEGORIES;

const AMOUNT_RX = /(?:rs\.?|inr|₹|rupees|usd|\$|eur|€|gbp|£)\s*:?\s*(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:rs\.?|inr|rupees)\b/i;
const DEBIT_RX = /debited|spent|paid|payment of|purchase|charged|withdrawn|withdrawal|sent|transferred to|transaction of|was made on your card|has been made|used for|using your|bill payment|autopay|auto-debit|emi/i;
const CREDIT_RX = /credited|received|refund|reversed|reversal|deposited|cashback|salary|interest credited|has been added/i;
const NOT_TXN_RX = /otp|one[- ]time password|verification code|will be debited|is due|due on|reminder|statement is ready|e-statement|minimum amount due|payment due|failed|declined|unsuccessful|could not be processed|request received|offer|apply now|pre-approved/i;
const ACCOUNT_RX = /(?:a\/c|acct|account|card|sb\s*a\/c|savings account|credit card|debit card|bank|wallet)\s*(?:no\.?|number|ending(?: with| in)?|xx+|\*+|•+)?\s*[:#-]?\s*[xX*•]{0,12}(\d{3,6})\b/i;
const CARD_RX = /card\s*(?:ending(?: with| in)?|no\.?|number)?\s*[:#-]?\s*[xX*•]{0,12}(\d{4})\b/i;
// Where the counter-party usually sits in alert mails, in order of reliability. Stop words end the capture.
const STOP = String.raw`(?=\s+(?:on|dated|for|using|via|was|is|has|from|ref|reference|successful|towards|salary|at|by|through|with|thank|avl|available|balance|net|the|your|txn|transaction|upi|dear|if|call|\(|\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4})\b|\s*[.,;)\n]|\s*$)`;
const NAME = String.raw`[A-Za-z][A-Za-z0-9&.'’ \-]{2,45}?`;
const MERCHANT_RX = [
  new RegExp(String.raw`(?:info|remarks?|narration|description|merchant|payee)\s*[:\-]\s*([^\n.,;]{3,60})`, 'i'),
  new RegExp(String.raw`\bat\s+(${NAME})${STOP}`, 'i'),
  new RegExp(String.raw`\bto\s+(?:vpa\s+)?[a-z0-9._-]+@[a-z0-9.]+\s+(${NAME})${STOP}`, 'i'),
  new RegExp(String.raw`\bto\s+(?:vpa\s+)?([a-z0-9._-]{3,}@[a-z0-9.]+)`, 'i'),
  new RegExp(String.raw`\b(?:paid to|sent to|transfer to|trf to|payment to|towards|to)\s+(?!vpa\b|your\b|a\b|the\b|account\b|a\/c)(${NAME})${STOP}`, 'i'),
  new RegExp(String.raw`\bfrom\s+(?!your\b|a\b|the\b|account\b|a\/c|hdfc|icici|sbi|axis|kotak|bank)(${NAME})${STOP}`, 'i'),
  new RegExp(String.raw`\bby\s+(?!neft\b|imps\b|rtgs\b|upi\b|rs\b|inr\b|₹|\d)(${NAME})${STOP}`, 'i'),
];
const BAD_MERCHANT = /^(?:your|you|a|an|the|account|card|transaction|vpa|customer|dear|bank|neft|imps|rtgs|upi|rs|inr|net|avl|available|balance|info|a\/c)\b/i;

const CATEGORY_RULES = [
  ['Salary & Income', /salary|payroll|stipend|wages|incentive|bonus credited/i],
  ['Refunds', /refund|reversal|reversed|cashback/i],
  ['Food & Dining', /swiggy|zomato|domino|pizza|kfc|mcdonald|burger|starbucks|cafe|coffee|restaurant|bistro|kitchen|biryani|dhaba|eat|food|dining|bakery|chai|tea|dunkin|subway|wow momo|haldiram|barbeque|bbq/i],
  ['Groceries', /bigbasket|blinkit|zepto|instamart|dmart|d-mart|grocer|jiomart|reliance fresh|reliance smart|more supermarket|supermarket|kirana|dairy|vegetable|nature'?s basket|spencer|star bazaar|ratnadeep|vijetha|lulu/i],
  ['Fuel', /petrol|fuel|hpcl|hp petro|bpcl|bharat petro|iocl|indian ?oil|shell|nayara|reliance petro|jio-bp|cng|diesel/i],
  ['Transport', /uber|ola\b|rapido|metro|bmtc|tsrtc|apsrtc|msrtc|ksrtc|fastag|parking|toll|auto rickshaw|cab|taxi|namma|yulu|bounce|redbus|abhibus|bus ticket|irctc|rail|train/i],
  ['Travel', /indigo|air india|vistara|akasa|spicejet|airasia|flight|makemytrip|goibibo|cleartrip|yatra|easemytrip|ixigo|oyo|treebo|fabhotel|marriott|taj|itc hotel|hotel|resort|airbnb|booking\.com|agoda|trip|holiday|visa/i],
  ['Subscriptions', /netflix|spotify|prime video|primevideo|hotstar|disney|youtube|google (?:one|play|storage)|apple\.com|icloud|itunes|adobe|microsoft|office 365|chatgpt|openai|claude|anthropic|github|notion|canva|dropbox|zee5|sonyliv|jiocinema|audible|kindle|linkedin premium|membership|subscription|renewal/i],
  ['Bills & Utilities', /airtel|jio\b|vodafone|vi\b|bsnl|act fibernet|hathway|tata play|tataplay|dth|d2h|sun direct|electricity|bescom|tneb|apspdcl|tsspdcl|msedcl|bses|tata power|adani electricity|water bill|gas bill|indane|hp gas|bharat gas|piped gas|mahanagar gas|igl|broadband|postpaid|prepaid recharge|recharge|bill pay|billdesk|utility/i],
  ['Rent & EMI', /\bemi\b|loan|home loan|car loan|personal loan|bajaj fin|hdfc ltd|lic housing|rent\b|house rent|society|maintenance|nobroker rent|housing\.com/i],
  ['Health', /apollo|pharmacy|medplus|1mg|tata 1mg|pharmeasy|netmeds|hospital|clinic|diagnostic|lab\b|practo|doctor|dental|optical|lenskart|medical|medicine|health|cult\.fit|cultfit|gym|fitness/i],
  ['Education', /school|college|university|udemy|coursera|byju|unacademy|vedantu|tuition|fees|course|exam|training|certification/i],
  ['Entertainment', /bookmyshow|pvr|inox|cinema|movie|theatre|game|steam|playstation|xbox|nintendo|concert|event|club|bowling|arcade|wonderla|imagica/i],
  ['Personal Care', /salon|spa|parlour|barber|haircut|nykaa|purplle|beauty|cosmetic|grooming|laundry|dry clean|urban company|urbanclap/i],
  ['Gifts & Donations', /gift|donation|charity|temple|trust|ngo|giveindia|milaap|ketto|cry\b|isha|iskcon/i],
  ['Investments & Insurance', /zerodha|groww|upstox|kuvera|coin\b|mutual fund|\bsip\b|nps|ppf|lic\b|life insurance|policy|premium|insurance|icici pru|hdfc life|sbi life|max life|bajaj allianz|star health|niva|acko|digit|smallcase|paytm money|etmoney|indmoney|gold|sgb|fixed deposit|recurring deposit/i],
  ['Cash', /atm|cash withdrawal|cash wdl|wdl|cardless cash/i],
  ['Fees & Charges', /charges?|fee\b|penalty|late payment|annual fee|gst\b|convenience|surcharge|interest charged|amb charge/i],
  ['Shopping', /amazon|flipkart|myntra|ajio|meesho|tata cliq|croma|reliance digital|vijay sales|ikea|decathlon|zara|h&m|uniqlo|lifestyle|pantaloons|max fashion|westside|shoppers stop|mall|store|mart|retail|shop|boutique|electronics|mobile|apple store|samsung|oneplus|snapdeal|firstcry|hamleys|pepperfry|urban ladder|wakefit/i],
  ['Transfers', /neft|imps|rtgs|transfer|self|own account|to a\/c|fund trf|upi\/p2[pa]|\bp2[pa]\b|family|wallet load|added to wallet|paytm wallet|phonepe wallet/i],
];

const METHOD_RULES = [
  ['UPI', /\bupi\b|vpa|@ok|@ybl|@paytm|@axl|@ibl|@apl|@upi|@icici|@hdfcbank|gpay|phonepe|bhim/i],
  ['Credit Card', /credit card/i],
  ['Debit Card', /debit card/i],
  ['Card', /\bcard\b|pos\b|ecom|e-com/i],
  ['NEFT', /\bneft\b/i],
  ['IMPS', /\bimps\b/i],
  ['RTGS', /\brtgs\b/i],
  ['ATM', /\batm\b|cash withdrawal/i],
  ['Net Banking', /net ?banking|internet banking/i],
  ['Auto-debit', /autopay|auto-debit|auto debit|mandate|nach|ecs\b/i],
];

const BANK_NAMES = [
  ['HDFC', /hdfc/i],
  ['ICICI', /icici/i],
  ['SBI', /\bsbi\b|state bank/i],
  ['Axis', /axis/i],
  ['Kotak', /kotak/i],
  ['Yes Bank', /yes ?bank/i],
  ['IndusInd', /indusind/i],
  ['IDFC', /idfc/i],
  ['Federal', /federal/i],
  ['BoB', /baroda|\bbob\b/i],
  ['PNB', /\bpnb\b|punjab national/i],
  ['Canara', /canara/i],
  ['Union', /union bank/i],
  ['AU', /aubank|au small/i],
  ['RBL', /\brbl\b/i],
  ['SC', /standard chartered/i],
  ['HSBC', /hsbc/i],
  ['Citi', /citi/i],
  ['Amex', /amex|american express/i],
  ['DBS', /\bdbs\b/i],
  ['Paytm', /paytm/i],
  ['PhonePe', /phonepe/i],
  ['GPay', /gpay|google pay/i],
  ['CRED', /\bcred\b/i],
  ['OneCard', /onecard/i],
];

const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[|]/g, ' ').trim();
const titleCase = (s) =>
  clean(s)
    .toLowerCase()
    .replace(/(^|\s)\S/g, (t) => t.toUpperCase());
const norm = (s) =>
  clean(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function parseAmount(text) {
  const m = text.match(AMOUNT_RX);
  if (!m) return null;
  const raw = (m[1] || m[2] || '').replace(/,/g, '');
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const cur = /usd|\$/i.test(m[0]) ? 'USD' : /eur|€/i.test(m[0]) ? 'EUR' : /gbp|£/i.test(m[0]) ? 'GBP' : 'INR';
  return { amount: Math.round(n * 100) / 100, currency: cur };
}

function guessCategory(text, type) {
  if (type === 'credit') {
    if (/salary|payroll|stipend/i.test(text)) return 'Salary & Income';
    if (/refund|reversal|reversed|cashback/i.test(text)) return 'Refunds';
    if (/interest/i.test(text)) return 'Salary & Income';
    return 'Transfers';
  }
  for (const [cat, rx] of CATEGORY_RULES) if (rx.test(text)) return cat;
  return 'Other';
}
function guessMethod(text) {
  for (const [m, rx] of METHOD_RULES) if (rx.test(text)) return m;
  return '';
}
function guessBank(text) {
  for (const [name, rx] of BANK_NAMES) if (rx.test(text)) return name;
  return '';
}
function guessAccount(text, fromStr) {
  const bank = guessBank(`${fromStr} ${text}`);
  const acc = text.match(ACCOUNT_RX) || text.match(CARD_RX);
  const last = acc ? acc[1].slice(-4) : '';
  if (bank && last) return `${bank} ••${last}`;
  return bank || (last ? `••${last}` : '');
}
function guessMerchant(text) {
  const body = String(text || '').replace(/[ \t]+/g, ' ');
  for (const rx of MERCHANT_RX) {
    const m = body.match(rx);
    if (!m || !m[1]) continue;
    let v = clean(m[1]);
    // "UPI/P2A/522812345/RAMESH KUMAR" or "REFUND/AMAZON" -> the last segment that reads like a name
    if (v.includes('/')) {
      const segs = v.split('/').map((s) => s.trim()).filter((s) => /[a-z]{3,}/i.test(s) && !/^(?:upi|imps|neft|rtgs|p2[am]|pos|ecom|refund|rev|txn)$/i.test(s));
      if (segs.length) v = segs[segs.length - 1];
    }
    if (/@/.test(v)) v = v.split('@')[0].replace(/[._-]+/g, ' '); // VPA handle -> name part
    v = v
      .replace(/\b(?:ref(?:erence)?|txn|transaction|upi|no\.?|number|id|successful|hi|dear customer)\b.*$/i, '')
      .replace(/[.:,;\-\s]+$/, '')
      .trim();
    if (/^\d[\d\s]*$/.test(v) || v.length < 3 || BAD_MERCHANT.test(v)) continue;
    return titleCase(v).slice(0, 60);
  }
  return '';
}

const STRONG = (s) => /has been debited|debited from|debited with|credited with|credited to|spent on|was made on your card|paid to|payment of .* (?:was|has been) (?:made|successful)/i.test(s);

/** Rule-based parse of one e-mail -> transaction or null (when it doesn't look like a completed transaction). */
function parseRules(mail) {
  const text = `${mail.subject || ''}\n${mail.text || ''}`;
  const head = text.slice(0, 1500);
  const amt = parseAmount(head) || parseAmount(text);
  if (!amt) return null;
  const isDebit = DEBIT_RX.test(head);
  const isCredit = CREDIT_RX.test(head);
  if (!isDebit && !isCredit) return null;
  if (NOT_TXN_RX.test(mail.subject || '') && !STRONG(head)) return null;
  // "Your card will be debited" / due reminders are not transactions
  if (/will be (?:debited|charged)|is due|payment due|minimum amount due/i.test(head) && !/has been debited|debited from|spent/i.test(head)) return null;
  let type;
  if (isCredit && !isDebit) type = 'credit';
  else if (isDebit && !isCredit) type = 'debit';
  else type = CREDIT_RX.exec(head).index < DEBIT_RX.exec(head).index ? 'credit' : 'debit';
  const merchant = guessMerchant(head) || guessMerchant(text) || titleCase(mail.fromName || (mail.from || '').split('@')[0]);
  const fromStr = `${mail.fromName || ''} ${mail.from || ''}`;
  return {
    date: mail.date ? new Date(mail.date) : new Date(),
    amount: amt.amount,
    currency: amt.currency,
    type,
    merchant,
    description: clean(mail.subject).slice(0, 140),
    category: guessCategory(`${merchant} ${head}`, type),
    account: guessAccount(head, fromStr),
    method: guessMethod(head),
    confidence: 0.6,
  };
}

/** OpenAI pass over a batch of mails -> array aligned with input (null for non-transactions). */
async function parseWithAI(mails) {
  const items = mails.map((m, i) => ({
    i,
    subject: m.subject,
    from: `${m.fromName || ''} <${m.from || ''}>`,
    date: dayjs(m.date).format('YYYY-MM-DD HH:mm'),
    text: String(m.text || '').slice(0, 1800),
  }));
  const system = `You extract completed financial transactions from bank, card, UPI, wallet and merchant e-mails for a personal expense tracker (India; default currency INR).
Return strictly JSON: {"items":[{"i":<index>,"isTransaction":true|false,"amount":<number>,"currency":"INR","type":"debit"|"credit","merchant":"<short clean name, e.g. Swiggy, Amazon, Airtel, Rahul Sharma>","category":"<one of: ${CATEGORIES.join(' | ')}>","account":"<bank/card + last 4 digits, e.g. HDFC ••1234, or empty>","method":"UPI|Credit Card|Debit Card|Card|NEFT|IMPS|RTGS|ATM|Net Banking|Auto-debit|","date":"YYYY-MM-DD","description":"<one short line>","confidence":0-1}]}.
Rules: OTPs, payment-due reminders, statements, offers, failed/declined attempts and "will be debited" notices are NOT transactions (isTransaction=false). Money going out of the user's account/card = debit; money coming in (salary, refund, cashback, received) = credit. Transfers to the user's own accounts -> category "Transfers". Use the e-mail date when the mail has no transaction date. One item per mail, same index i.`;
  const out = await ai.chat({ system, user: JSON.stringify({ mails: items }), json: true, maxTokens: 220 * items.length + 200 });
  const byIndex = new Map((out.items || out.transactions || []).map((t) => [Number(t.i), t]));
  return mails.map((m, i) => {
    const t = byIndex.get(i);
    if (!t || !t.isTransaction || !(Number(t.amount) > 0)) return null;
    const type = t.type === 'credit' ? 'credit' : 'debit';
    const category = CATEGORIES.includes(t.category) ? t.category : guessCategory(`${t.merchant || ''} ${m.subject} ${String(m.text || '').slice(0, 800)}`, type);
    const d = t.date && dayjs(t.date).isValid() ? dayjs(t.date) : dayjs(m.date);
    return {
      date: d.toDate(),
      amount: Math.round(Number(t.amount) * 100) / 100,
      currency: (t.currency || 'INR').toUpperCase().slice(0, 3),
      type,
      merchant: clean(t.merchant).slice(0, 60) || guessMerchant(`${m.subject}\n${m.text}`),
      description: clean(t.description || m.subject).slice(0, 140),
      category,
      account: clean(t.account).slice(0, 40) || guessAccount(m.text || '', `${m.fromName} ${m.from}`),
      method: clean(t.method).slice(0, 20) || guessMethod(m.text || ''),
      confidence: Number(t.confidence) || 0.8,
      ai: true,
    };
  });
}

/** Stable fingerprint so the same transaction alerted twice (SMS-gateway mail + bank mail) is stored once. */
function fingerprint(t) {
  return [t.type, Math.round(Number(t.amount) * 100), dayjs(t.date).format('YYYY-MM-DD'), norm(t.merchant).split(' ').slice(0, 2).join(' ')].join('|');
}

/**
 * Parse a list of mails. Uses OpenAI when a key is configured (batches of 8, falling back to rules on error),
 * else rules only. Returns [{ mail, txn|null, via: 'ai'|'rules' }].
 */
async function parseMails(mails, { useAI } = {}) {
  const wantAI = useAI ?? (await ai.enabled());
  const results = new Array(mails.length).fill(null);
  if (wantAI) {
    for (let i = 0; i < mails.length; i += 8) {
      const batch = mails.slice(i, i + 8);
      try {
        const parsed = await parseWithAI(batch);
        parsed.forEach((t, j) => (results[i + j] = { mail: batch[j], txn: t, via: 'ai' }));
      } catch (e) {
        console.warn('[expenses] AI parse failed, using rules for this batch:', e.message);
        batch.forEach((m, j) => (results[i + j] = { mail: m, txn: parseRules(m), via: 'rules' }));
      }
    }
  } else {
    mails.forEach((m, i) => (results[i] = { mail: m, txn: parseRules(m), via: 'rules' }));
  }
  return results;
}

module.exports = { parseRules, parseWithAI, parseMails, fingerprint, guessCategory, guessMerchant, guessAccount, guessMethod, CATEGORIES };
