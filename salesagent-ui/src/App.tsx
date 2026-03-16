import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/auth.store';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AgentsPage from './pages/AgentsPage';
import ConversationsPage from './pages/ConversationsPage';
import LeadsPage from './pages/LeadsPage';
import KnowledgePage from './pages/KnowledgePage';
import IntegrationsPage from './pages/IntegrationsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import DemoChat from './pages/DemoChat';
import SocialMediaPage from './pages/SocialMediaPage';
import { useEffect, useState } from 'react';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" replace />;
}

function SessionExpiredToast() {
  const [visible, setVisible] = useState(false);
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    const handle = () => {
      logout();
      setVisible(true);
      setTimeout(() => {
        setVisible(false);
        navigate('/login', { replace: true });
      }, 4000);
    };
    window.addEventListener('session:expired', handle);
    return () => window.removeEventListener('session:expired', handle);
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
      background: '#1e293b', color: '#fff', borderRadius: 12,
      padding: '14px 24px', zIndex: 9999, display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.28)', fontSize: 14, minWidth: 320,
    }}>
      <span style={{ fontSize: 20 }}>🔒</span>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Session expired</div>
        <div style={{ color: '#94a3b8', fontSize: 13 }}>Your session has timed out. Redirecting you to login…</div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionExpiredToast />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="conversations" element={<ConversationsPage />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="social" element={<SocialMediaPage />} />
          <Route path="demo" element={<DemoChat />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
