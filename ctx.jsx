import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { setTimezone } from './format';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [meta, setMeta] = useState(null);
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const loadMeta = useCallback(async () => {
    const m = await api.get('/api/meta');
    setTimezone(m.settings.timezone);
    setMeta(m);
  }, []);

  useEffect(() => {
    api.get('/api/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
    const onUnauth = () => setUser(null);
    window.addEventListener('oz:unauthorized', onUnauth);
    return () => window.removeEventListener('oz:unauthorized', onUnauth);
  }, []);
  useEffect(() => { if (user) loadMeta().catch(() => {}); else setMeta(null); }, [user, loadMeta]);

  const login = async (email, password) => { const r = await api.post('/api/auth/login', { email, password }); setUser(r.user); };
  const logout = async () => { await api.post('/api/auth/logout').catch(() => {}); setUser(null); };

  const role = user?.role;
  const can = {
    staff: ['agent', 'manager', 'admin'].includes(role),
    reports: ['manager', 'admin'].includes(role),
    admin: role === 'admin',
    dealer: role === 'dealer',
  };

  return (
    <AppCtx.Provider value={{ user, meta, login, logout, toast, can, reloadMeta: loadMeta }}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>{t.msg}</div>)}
      </div>
    </AppCtx.Provider>
  );
}
