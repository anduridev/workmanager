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
      onLogin({ username: res.username, displayName: res.displayName });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card col" onSubmit={submit}>
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="brand-logo" style={{ color: '#fff' }}>✓</div>
          <div>
            <h1>WorkPA</h1>
            <p className="muted small">Your personal work assistant</p>
          </div>
        </div>
        {hasUser === false && (
          <div className="small" style={{ background: 'var(--warn-soft)', color: 'var(--warn)', padding: '8px 10px', borderRadius: 8 }}>
            No user exists yet. Create one from the terminal:
            <code style={{ display: 'block', marginTop: 4 }}>npm run create-user -- &lt;username&gt; &lt;password&gt;</code>
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
        {error && <div className="err">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !password || !username}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
