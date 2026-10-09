import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { useApp } from '../ctx';
import { api } from '../api';
import { Icon } from '../icons';
import { ago, initials } from '../format';
import { useClickOutside } from './ui';

function navFor(user, can) {
  const items = [
    { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
    { to: '/create', label: 'Create Ticket', icon: 'plus' },
  ];
  if (can.staff || can.dealer) items.push({ to: '/tickets', label: can.dealer ? 'Our Tickets' : 'All Tickets', icon: 'list', end: true });
  items.push({ to: '/my', label: 'My Tickets', icon: 'user' });
  if (['agent', 'manager'].includes(user.role) || (user.role === 'admin' && user.department_id)) items.push({ to: '/queue', label: 'Department Queue', icon: 'inbox' });
  if (can.staff) items.push({ to: '/escalations', label: 'Escalations', icon: 'alert' });
  if (can.reports) items.push({ to: '/reports', label: 'Reports & Analytics', icon: 'chart' });
  if (can.admin) items.push({ to: '/admin', label: 'Administration', icon: 'settings' });
  return items;
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ unread: 0, rows: [] });
  const ref = useRef();
  const nav = useNavigate();
  const load = useCallback(() => api.get('/api/notifications').then(setData).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  useClickOutside(ref, useCallback(() => setOpen(false), []));
  const openItem = async (n) => {
    setOpen(false);
    if (!n.is_read) await api.post(`/api/notifications/${n.id}/read`).catch(() => {});
    load();
    if (n.ticket_no) nav(`/tickets/${n.ticket_no}`);
  };
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="icon-btn" aria-label={`Notifications, ${data.unread} unread`} onClick={() => { setOpen(!open); if (!open) load(); }}>
        <Icon name="bell" />{data.unread > 0 && <span className="dot">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="popover">
          <div className="popover-head"><h3>Notifications</h3><span className="spacer" />
            {data.unread > 0 && <button className="btn btn-sm btn-ghost" onClick={async () => { await api.post('/api/notifications/read-all'); load(); }}>Mark all read</button>}
          </div>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            {data.rows.length === 0 && <div className="empty small">You're all caught up.</div>}
            {data.rows.map((n) => (
              <a key={n.id} href="#" className={`notif ${n.is_read ? '' : 'unread'}`} onClick={(e) => { e.preventDefault(); openItem(n); }}>
                <b>{n.title}</b>{n.body && <span>{n.body}</span>}<span className="muted small">{ago(n.created_at)}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout, meta } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useClickOutside(ref, useCallback(() => setOpen(false), []));
  const roleLabel = meta?.roleLabels?.[user.role] || user.role;
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="user-chip" onClick={() => setOpen(!open)} aria-haspopup="menu">
        <span className="avatar">{initials(user.name)}</span>
        <span className="who"><b>{user.name}</b><span>{roleLabel}{user.department_name ? ` · ${user.department_name}` : user.dealer_name ? ` · ${user.dealer_name}` : ''}</span></span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="popover menu-list" style={{ width: 240 }} role="menu">
          <div className="popover-head small"><div><b>{user.name}</b><div className="muted">{user.email}</div></div></div>
          <Link to="/profile" onClick={() => setOpen(false)}>Profile &amp; password</Link>
          <button onClick={logout}><Icon name="logout" size={15} /> Sign out</button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, can } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => setNavOpen(false), [loc.pathname]);
  const search = (e) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    if (/^oz-\d{4}-\d{1,6}$/i.test(v)) nav(`/tickets/${v.toUpperCase()}`);
    else nav(`/tickets?q=${encodeURIComponent(v)}`);
    setQ('');
  };
  const items = navFor(user, can);
  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar" onClick={(e) => e.target === e.currentTarget && setNavOpen(false)}>
        <div className="brand">
          <span className="brand-mark"><Icon name="window" size={20} /></span>
          <span><div className="brand-name">Ozone Issue Tracker</div><div className="brand-sub">OzoneBlu operations helpdesk</div></span>
        </div>
        <nav className="nav" aria-label="Main">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={i.icon} size={17} />{i.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">Ozone Corp. Pvt. Ltd., Gurgaon<br />Phase 1 · v1.0</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-toggle" aria-label="Open menu" onClick={() => setNavOpen(true)}><Icon name="menu" /></button>
          <form className="search" onSubmit={search} role="search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ticket ID, quote/order no., customer or dealer" aria-label="Search tickets" />
          </form>
          <span className="spacer" />
          <Link className="btn btn-primary btn-sm" to="/create" style={{ display: loc.pathname === '/create' ? 'none' : undefined }}><Icon name="plus" size={15} /><span className="hide-xs">New ticket</span></Link>
          <Notifications />
          <UserMenu />
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
