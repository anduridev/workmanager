import { useState } from 'react';
import { Auth, setToken } from '../lib/api';

export default function Login({ onLogin, hasUser }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await Auth.login(username, password);
      setToken(res.token);
      onLogin({ username: res.username, displayName: res.displayName, role: res.role });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-[100dvh] place-items-center bg-slate-50 bg-[radial-gradient(900px_500px_at_10%_-10%,#e0e7ff_0%,transparent_60%),radial-gradient(800px_500px_at_110%_110%,#ede9fe_0%,transparent_60%)] p-4">
      <form className="flex w-full max-w-[380px] flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-pop max-md:p-6" onSubmit={submit}>
        <div className="mb-2 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand text-xl font-extrabold text-white shadow-glow">✓</div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">WorkPA</h1>
            <p className="text-[13px] text-slate-500">Your personal work assistant</p>
          </div>
        </div>
        {hasUser === false && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            No user exists yet. Create one from the terminal:
            <code className="mt-1 block font-mono text-xs">npm run create-user -- &lt;username&gt; &lt;password&gt;</code>
          </div>
        )}
        <label className="field">
          Username
          <input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          Password
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="text-[13px] text-red-600">{error}</div>}
        <button className="btn btn-primary mt-1 !h-11" disabled={busy || !password || !username}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
