import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Auth, getToken, setToken } from './lib/api';
import Layout from './components/Layout';
import { ToastProvider } from './components/Toast';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import Projects from './pages/Projects';
import Zendesk from './pages/Zendesk';
import Today from './pages/Today';
import Notes from './pages/Notes';
import Team from './pages/Team';
import Reminders from './pages/Reminders';
import Expenses from './pages/Expenses';

export default function App() {
  const [auth, setAuth] = useState({ loading: true, loggedIn: false, hasUser: true, user: null });

  useEffect(() => {
    const boot = async () => {
      // Run both requests in parallel — one round trip instead of two before the first render
      const [statusRes, meRes] = await Promise.allSettled([Auth.status(), getToken() ? Auth.me() : Promise.reject(new Error('no token'))]);
      const hasUser = statusRes.status === 'fulfilled' ? statusRes.value.hasUser : true;
      if (meRes.status === 'fulfilled') {
        setAuth({ loading: false, loggedIn: true, hasUser, user: meRes.value });
        return;
      }
      if (getToken()) setToken(null);
      setAuth({ loading: false, loggedIn: false, hasUser, user: null });
    };
    boot();
    const onUnauthorized = () => setAuth((a) => ({ ...a, loggedIn: false, user: null }));
    window.addEventListener('workpa:unauthorized', onUnauthorized);
    return () => window.removeEventListener('workpa:unauthorized', onUnauthorized);
  }, []);

  const logout = () => {
    setToken(null);
    setAuth((a) => ({ ...a, loggedIn: false, user: null }));
  };

  const zdOnly = auth.user?.role === 'zendesk'; // restricted account: Zendesk screen only

  if (auth.loading) return <div className="splash">Loading…</div>;
  if (!auth.loggedIn) return <Login hasUser={auth.hasUser} onLogin={(user) => setAuth((a) => ({ ...a, loggedIn: true, user }))} />;

  return (
    <ToastProvider>
      <Layout user={auth.user} onLogout={logout}>
        <Routes>
          {zdOnly && (
            <>
              <Route path="/zendesk" element={<Zendesk />} />
              <Route path="*" element={<Navigate to="/zendesk" replace />} />
            </>
          )}
          {!zdOnly && (
            <>
          <Route path="/" element={<Dashboard />} />
          <Route path="/today" element={<Today />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/zendesk" element={<Zendesk />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tasks/:id" element={<Tasks />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/team" element={<Team />} />
          <Route path="/team/:id" element={<Team />} />
          <Route path="/reminders" element={<Reminders />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
      </Layout>
    </ToastProvider>
  );
}
