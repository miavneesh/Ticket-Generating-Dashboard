import { useEffect, useState } from 'react';
import { useApp } from '../ctx';
import { api } from '../api';
import { Field } from '../components/ui';
import { Icon } from '../icons';

const DEMO = [
  ['Employee (Sales Executive)', 'nikhil.jain@ozone.demo'],
  ['Dealer – Skyline Fenestration', 'rakesh@skyline.demo'],
  ['Dealer – Urban Windows', 'sameer@urbanwindows.demo'],
  ['Support Team – Costing', 'megha.arora@ozone.demo'],
  ['Department Head – Production', 'harpreet.singh@ozone.demo'],
  ['Helpdesk / Triage Lead', 'neha.kapoor@ozone.demo'],
  ['Management (all departments)', 'alok.mehra@ozone.demo'],
  ['System Administrator', 'admin@ozone.demo'],
];

export default function Login() {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  useEffect(() => { api.get('/api/health').then((h) => setDemo(!!h.demo)).catch(() => {}); }, []);

  const submit = async (e, creds) => {
    e?.preventDefault();
    setBusy(true); setErr('');
    try { await login(creds?.email || email, creds?.password || password); }
    catch (x) { setErr(x.message); setBusy(false); }
  };

  return (
    <div className="login">
      <section className="login-art">
        <div className="row"><span className="brand-mark"><Icon name="window" size={20} /></span><b style={{ color: '#fff' }}>Ozone Corp. Pvt. Ltd.</b></div>
        <div>
          <h1>One place for every OzoneBlu issue — from quotation to installation.</h1>
          <p>Raise a ticket, route it to the right team, and track it to closure with a complete audit trail.</p>
        </div>
        <p className="small">Sales · Dealers · Costing · Survey · Commercial · Planning · Production · Dispatch · Installation · Service</p>
        <div className="frame" aria-hidden="true" />
      </section>
      <section className="login-form">
        <form onSubmit={submit} className="stack" noValidate>
          <div><h1>Sign in</h1><p className="muted">Ozone Issue Tracker</p></div>
          {err && <div className="alert alert-error" role="alert">{err}</div>}
          <Field label="Email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {demo && (
            <div className="demo-users">
              <div className="small muted">Demo accounts (password <b>Ozone@123</b>) — click to sign in:</div>
              {DEMO.map(([label, em]) => (
                <button type="button" key={em} onClick={(e) => submit(e, { email: em, password: 'Ozone@123' })} disabled={busy}>
                  <span><b className="small">{label}</b><div className="small muted">{em}</div></span><Icon name="arrowRight" size={16} />
                </button>
              ))}
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
