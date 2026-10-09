import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../ctx';
import { Field } from '../components/ui';

export default function Profile() {
  const { user, meta, toast } = useApp();
  const [v, setV] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState({});
  const save = async (e) => {
    e.preventDefault();
    if (v.next !== v.confirm) return setErr({ confirm: 'Passwords do not match' });
    try { await api.post('/api/auth/change-password', { current: v.current, next: v.next }); toast('Password changed'); setV({ current: '', next: '', confirm: '' }); setErr({}); }
    catch (x) { setErr({ ...x.details, form: x.message }); }
  };
  return (
    <div style={{ maxWidth: 640 }} className="stack">
      <h1>Profile</h1>
      <div className="card card-pad">
        <dl className="kv">
          <dt>Name</dt><dd>{user.name}</dd><dt>Email</dt><dd>{user.email}</dd><dt>Role</dt><dd>{meta.roleLabels[user.role]}</dd>
          {user.department_name && <><dt>Department</dt><dd>{user.department_name}</dd></>}
          {user.dealer_name && <><dt>Dealer</dt><dd>{user.dealer_name}</dd></>}
          {user.designation && <><dt>Designation</dt><dd>{user.designation}</dd></>}
        </dl>
      </div>
      <form className="card card-pad stack" onSubmit={save}>
        <h2>Change password</h2>
        {err.form && <div className="alert alert-error">{err.form}</div>}
        <Field label="Current password" error={err.current}><input type="password" className="input" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="New password" error={err.next} hint="At least 8 characters"><input type="password" className="input" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="Confirm new password" error={err.confirm}><input type="password" className="input" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} autoComplete="new-password" /></Field>
        <div><button className="btn btn-primary">Update password</button></div>
      </form>
    </div>
  );
}
