import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
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
