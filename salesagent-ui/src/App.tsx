import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
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
import { useEffect, useState, useCallback } from 'react';
import { api } from './lib/api';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" replace />;
}

/** Decode the exp claim from a JWT without verifying the signature */
function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function SessionToasts() {
  const [expiredVisible, setExpiredVisible] = useState(false);
  const [warningVisible, setWarningVisible] = useState(false);
  const [countdown, setCountdown] = useState(120);
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const doLogout = useCallback(() => {
    logout();
    setExpiredVisible(true);
    setWarningVisible(false);
    setTimeout(() => {
      setExpiredVisible(false);
      navigate('/login', { replace: true });
    }, 4000);
  }, [logout, navigate]);

  const staySignedIn = useCallback(async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) { doLogout(); return; }
      const { data } = await api.post('/auth/refresh', { refreshToken });
      localStorage.setItem('accessToken', data.accessToken);
      setWarningVisible(false);
      setCountdown(120);
    } catch {
      doLogout();
    }
  }, [doLogout]);

  // Listen for session:expired events (from 401 interceptor)
  useEffect(() => {
    const handle = () => {
      if (window.location.pathname === '/login') return;
      doLogout();
    };
    window.addEventListener('session:expired', handle);
    return () => window.removeEventListener('session:expired', handle);
  }, [doLogout]);

  // Proactive warning: check token expiry every 30 seconds
  useEffect(() => {
    const check = () => {
      if (!isAuthenticated()) return;
      const token = localStorage.getItem('accessToken');
      if (!token) return;
      const expiry = getTokenExpiry(token);
      if (!expiry) return;
      const remaining = expiry - Date.now();
      if (remaining > 0 && remaining <= 2 * 60 * 1000) {
        setCountdown(Math.floor(remaining / 1000));
        setWarningVisible(true);
      } else if (remaining <= 0) {
        setWarningVisible(false);
      } else {
        setWarningVisible(false);
      }
    };
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Countdown ticker when warning is visible
  useEffect(() => {
    if (!warningVisible) return;
    const tick = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(tick); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [warningVisible]);

  const onLogin = location.pathname === '/login';

  return (
    <>
      {/* Session expired toast */}
      {expiredVisible && !onLogin && (
        <div style={toastStyle('#1e293b')}>
          <span style={{ fontSize: 20 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Session expired</div>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>Your session has timed out. Redirecting to login…</div>
          </div>
        </div>
      )}

      {/* Proactive warning toast */}
      {warningVisible && !onLogin && (
        <div style={toastStyle('#1e3a2e')}>
          <span style={{ fontSize: 20 }}>⏱️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              Session expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
            </div>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>You will be logged out soon.</div>
          </div>
          <button
            onClick={staySignedIn}
            style={{
              background: '#10b981', border: 'none', color: '#fff',
              borderRadius: 8, padding: '6px 14px', fontSize: 13,
              fontWeight: 600, cursor: 'pointer', flexShrink: 0,
            }}
          >
            Stay signed in
          </button>
        </div>
      )}
    </>
  );
}

function toastStyle(bg: string): React.CSSProperties {
  return {
    position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
    background: bg, color: '#fff', borderRadius: 12,
    padding: '14px 20px', zIndex: 9999, display: 'flex', alignItems: 'center', gap: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,0.28)', fontSize: 14,
    minWidth: 320, maxWidth: '90vw',
    border: '1px solid rgba(255,255,255,0.08)',
  };
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionToasts />
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
