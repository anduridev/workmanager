import { useEffect, useState } from 'react';
import { Expenses as Api } from '../lib/api';
import Modal from './Modal';
import { useToast } from './Toast';
import { MailIcon } from './icons';

const PROVIDERS = [
  { key: 'gmail', label: 'Gmail', host: 'imap.gmail.com', port: 993, help: 'Google Account → Security → 2-Step Verification → App passwords → create one for "Mail". Paste the 16-character password here.' },
  { key: 'outlook', label: 'Outlook / M365', host: 'outlook.office365.com', port: 993, help: 'Microsoft account → Security → Advanced security options → App passwords. Work accounts need IMAP enabled by the admin.' },
  { key: 'yahoo', label: 'Yahoo', host: 'imap.mail.yahoo.com', port: 993, help: 'Yahoo Account Security → Generate app password.' },
  { key: 'zoho', label: 'Zoho', host: 'imap.zoho.in', port: 993, help: 'Zoho Mail → Settings → Mail accounts → IMAP access (enable) and Security → App passwords.' },
  { key: 'icloud', label: 'iCloud', host: 'imap.mail.me.com', port: 993, help: 'appleid.apple.com → Sign-In and Security → App-Specific Passwords.' },
  { key: 'other', label: 'Other', host: '', port: 993, help: 'Any IMAP server. Use the app password / IMAP password your provider gives you.' },
];

const Section = ({ title, hint, children }) => (
  <div className="mb-5 rounded-xl border border-slate-200 p-4">
    <div className="mb-3">
      <div className="text-[15px] font-semibold text-slate-900">{title}</div>
      {hint && <div className="mt-0.5 text-[13px] text-slate-500">{hint}</div>}
    </div>
    {children}
  </div>
);

/** Mailbox (IMAP), OpenAI and alert preferences for the Expense Manager. Secrets are write-only. */
export default function ExpenseSettings({ settings, onClose, onSaved }) {
  const toast = useToast();
  const s = settings || {};
  const [mail, setMail] = useState({ host: '', port: 993, secure: true, user: '', pass: '', folder: 'INBOX', senders: '', lookbackDays: 30, ...s.mail, senders: (s.mail?.senders || []).join(', '), pass: '' });
  const [ai, setAi] = useState({ key: '', model: s.ai?.model || 'gpt-4o-mini' });
  const [prefs, setPrefs] = useState({ currency: 'INR', largeTxn: 10000, alertRatio: 1.3, autoSync: true, syncHours: 6, weeklyReview: true, ...s.prefs });
  const [provider, setProvider] = useState(() => PROVIDERS.find((p) => p.host && s.mail?.host === p.host)?.key || (s.mail?.host ? 'other' : 'gmail'));
  const [mailTest, setMailTest] = useState(null);
  const [aiTest, setAiTest] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    const p = PROVIDERS.find((x) => x.key === provider);
    if (p && p.host && !mail.host) setMail((m) => ({ ...m, host: p.host, port: p.port, secure: true }));
  }, [provider]);

  const pickProvider = (p) => {
    setProvider(p.key);
    if (p.host) setMail((m) => ({ ...m, host: p.host, port: p.port, secure: true }));
    else setMail((m) => ({ ...m, host: '' }));
  };

  const testMail = async () => {
    setBusy('mail');
    setMailTest(null);
    try {
      const r = await Api.testMail({ ...mail, senders: mail.senders.split(',').map((x) => x.trim()).filter(Boolean) });
      setMailTest(r);
    } catch (e) {
      setMailTest({ ok: false, error: e.message });
    } finally {
      setBusy('');
    }
  };
  const testAi = async () => {
    setBusy('ai');
    setAiTest(null);
    try {
      setAiTest(await Api.testAI({ key: ai.key, model: ai.model }));
    } catch (e) {
      setAiTest({ ok: false, error: e.message });
    } finally {
      setBusy('');
    }
  };
  const save = async () => {
    setBusy('save');
    try {
      const r = await Api.saveSettings({
        mail: { ...mail, senders: mail.senders.split(',').map((x) => x.trim()).filter(Boolean), pass: mail.pass || undefined },
        ai: { key: ai.key || undefined, model: ai.model },
        prefs,
      });
      toast.success('Settings saved');
      onSaved?.(r);
      onClose();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy('');
    }
  };

  const g = s.gmail || { configured: false, connected: false, redirectUri: `${window.location.origin}/api/expenses/gmail/callback` };
  const [gmailTest, setGmailTest] = useState(null);
  const connectGmail = async () => {
    setBusy('gmail');
    try {
      const { url } = await Api.gmailAuthUrl();
      window.location.href = url; // Google consent screen -> /api/expenses/gmail/callback -> back to /expenses
    } catch (e) {
      toast.error(e.message);
      setBusy('');
    }
  };
  const testGmail = async () => {
    setBusy('gmailtest');
    setGmailTest(null);
    try {
      setGmailTest(await Api.gmailTest());
    } catch (e) {
      setGmailTest({ ok: false, error: e.message });
    } finally {
      setBusy('');
    }
  };
  const disconnectGmail = async () => {
    if (!window.confirm('Disconnect Gmail? Already imported transactions are kept.')) return;
    try {
      const r = await Api.gmailDisconnect();
      toast.success('Gmail disconnected');
      onSaved?.(r);
      onClose();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const prov = PROVIDERS.find((p) => p.key === provider);
  const mailReady = mail.host && mail.user && (mail.pass || s.mail?.hasPassword);

  return (
    <Modal
      title="Expense settings"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy === 'save'}>
            {busy === 'save' ? 'Saving…' : 'Save settings'}
          </button>
        </>
      }
    >
      <Section title="Gmail (Google sign-in)" hint="Click Connect Gmail, approve on Google's consent screen and WorkPA reads your bank / card / UPI alerts through the Gmail API — read-only, nothing is moved or deleted. Access can be revoked here or at myaccount.google.com/permissions.">
        {!g.configured && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            Not enabled on the server yet. In Google Cloud Console create an OAuth client (Web application) with the Gmail API enabled and this redirect URI:
            <code className="mt-1 block break-all font-mono text-xs">{g.redirectUri}</code>
            then set <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code> and <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code> on the server and reload.
          </div>
        )}
        {g.configured && !g.connected && (
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" onClick={connectGmail} disabled={busy === 'gmail'}>
              <MailIcon size={16} /> {busy === 'gmail' ? 'Opening Google…' : 'Connect Gmail'}
            </button>
            <span className="text-[13px] text-slate-500">Scope requested: read-only mail access (gmail.readonly).</span>
          </div>
        )}
        {g.connected && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="badge badge-done">Connected</span>
            <span className="text-sm">
              <b className="text-slate-900">{g.email}</b>
              {g.connectedAt && <span className="text-slate-500"> · since {new Date(g.connectedAt).toLocaleDateString()}</span>}
            </span>
            <button className="btn btn-sm" onClick={testGmail} disabled={busy === 'gmailtest'}>
              {busy === 'gmailtest' ? 'Checking…' : 'Test'}
            </button>
            <button className="btn btn-sm btn-ghost btn-danger" onClick={disconnectGmail}>
              Disconnect
            </button>
            {gmailTest?.ok && (
              <span className="text-[13px] text-emerald-700">
                ✓ {gmailTest.recent} mails in the last 14 days, <b>{gmailTest.matched}</b> look like transaction alerts
              </span>
            )}
            {gmailTest && !gmailTest.ok && <span className="text-[13px] text-red-600">✕ {gmailTest.error}</span>}
          </div>
        )}
        {g.configured && (
          <div className="mt-2 text-xs text-slate-400">
            If your Google Cloud app is in "Testing" status, Google expires the access after 7 days — publish the app (OAuth consent screen → Publish) to keep it connected.
          </div>
        )}
      </Section>


      <Section title="AI (OpenAI)" hint="Used to read the mails accurately (merchant, category) and for the weekly spending review with alerts and tips. Your key is stored encrypted on the server.">
        <div className="form-grid">
          <label className="field">
            API key {s.ai?.hasKey && !ai.key && <span className="text-xs font-normal text-emerald-600">· saved {s.ai.keyMasked}{s.ai.fromEnv ? ' (from server env)' : ''}</span>}
            <input className="input" type="password" value={ai.key} onChange={(e) => setAi({ ...ai, key: e.target.value })} placeholder={s.ai?.hasKey ? '•••••••• (leave blank to keep)' : 'sk-…'} autoComplete="new-password" />
          </label>
          <label className="field">
            Model
            <select className="select" value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })}>
              {(s.ai?.models || ['gpt-4o-mini']).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn btn-sm" onClick={testAi} disabled={busy === 'ai' || (!ai.key && !s.ai?.hasKey)}>
            {busy === 'ai' ? 'Testing…' : 'Test key'}
          </button>
          {aiTest?.ok && <span className="text-[13px] text-emerald-700">✓ {aiTest.model} replied "{aiTest.reply}"</span>}
          {aiTest && !aiTest.ok && <span className="text-[13px] text-red-600">✕ {aiTest.error}</span>}
        </div>
      </Section>

      <Section title="Alerts & sync" hint="Rule-based alerts work without AI: a category running well above your 3-month average, a month on track to overspend, and large single payments.">
        <div className="form-grid">
          <label className="field">
            Currency
            <input className="input" value={prefs.currency} onChange={(e) => setPrefs({ ...prefs, currency: e.target.value.toUpperCase() })} maxLength={3} />
          </label>
          <label className="field">
            Large payment alert (≥ amount, 0 = off)
            <input className="input" type="number" min={0} value={prefs.largeTxn} onChange={(e) => setPrefs({ ...prefs, largeTxn: Number(e.target.value) })} />
          </label>
          <label className="field">
            Category alert when above average by
            <select className="select" value={String(prefs.alertRatio)} onChange={(e) => setPrefs({ ...prefs, alertRatio: Number(e.target.value) })}>
              {[1.15, 1.3, 1.5, 2].map((r) => (
                <option key={r} value={String(r)}>
                  {Math.round((r - 1) * 100)}%
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Check mailbox every
            <select className="select" value={String(prefs.syncHours)} onChange={(e) => setPrefs({ ...prefs, syncHours: Number(e.target.value) })}>
              {[1, 3, 6, 12, 24].map((h) => (
                <option key={h} value={String(h)}>
                  {h} hour{h > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-5">
          <label className="checkbox text-sm">
            <input type="checkbox" checked={prefs.autoSync !== false} onChange={(e) => setPrefs({ ...prefs, autoSync: e.target.checked })} /> Sync the mailbox automatically
          </label>
          <label className="checkbox text-sm">
            <input type="checkbox" checked={prefs.weeklyReview !== false} onChange={(e) => setPrefs({ ...prefs, weeklyReview: e.target.checked })} /> Weekly AI review every Monday (notification)
          </label>
        </div>
      </Section>
    </Modal>
  );
}
