import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './ctx';
import Layout from './components/Layout';
import { Spinner, Empty } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CreateTicket from './pages/CreateTicket';
import TicketList from './pages/TicketList';
import TicketDetail from './pages/TicketDetail';
import Reports from './pages/Reports';
import Admin from './pages/Admin';
import Profile from './pages/Profile';

const VIEWS = {
  all: { title: 'All Tickets', sub: 'Every ticket you are authorised to see', tabs: [['', 'All'], ['unassigned', 'Unassigned'], ['overdue', 'Overdue'], ['escalated', 'Escalated'], ['recently_resolved', 'Recently resolved']] },
  my: { title: 'My Tickets', sub: 'Tickets you raised or are working on', tabs: [['mine', 'Raised by me'], ['assigned', 'Assigned to me'], ['awaiting_me', 'Awaiting my response']] },
  queue: { title: 'Department Queue', sub: 'Tickets owned by your department', tabs: [['department', 'All department'], ['unassigned', 'Unassigned'], ['overdue', 'Overdue']], deptScoped: true },
  esc: { title: 'Escalations', sub: 'Escalated and SLA-breached tickets that need attention', tabs: [['escalated', 'Escalated'], ['overdue', 'Overdue']] },
};

function Guard({ ok, children }) {
  return ok ? children : <Empty icon="lock" title="You don't have access to this page">Ask your administrator if you need access.</Empty>;
}

export default function App() {
  const { user, meta, can } = useApp();
  if (user === undefined) return <Spinner />;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;
  if (!meta) return <Spinner />;
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="create" element={<CreateTicket />} />
        <Route path="tickets" element={<TicketList key="all" cfg={can.dealer ? { ...VIEWS.all, title: 'Our Tickets', sub: 'All tickets raised for your dealership' } : VIEWS.all} />} />
        <Route path="tickets/:id" element={<TicketDetail />} />
        <Route path="my" element={<TicketList key="my" cfg={VIEWS.my} />} />
        <Route path="queue" element={<TicketList key="queue" cfg={VIEWS.queue} />} />
        <Route path="escalations" element={<Guard ok={can.staff}><TicketList key="esc" cfg={VIEWS.esc} /></Guard>} />
        <Route path="reports" element={<Guard ok={can.reports}><Reports /></Guard>} />
        <Route path="admin/*" element={<Guard ok={can.admin}><Admin /></Guard>} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<Empty icon="info" title="Page not found" />} />
      </Route>
    </Routes>
  );
}
