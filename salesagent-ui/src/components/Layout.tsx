import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { useState, useEffect } from 'react';

// ── GrowthSense brand tokens ──────────────────────────────────────────────────
// Navy  : #2e3191   Bright blue : #29abe2
// Tint  : #f0f8fe   Border      : #cde8f5

const navItems = [
  { to: '/', label: 'Dashboard', icon: '▦', end: true },
  { to: '/agents', label: 'Agents', icon: '◈' },
  { to: '/conversations', label: 'Conversations', icon: '◷' },
  { to: '/leads', label: 'Leads', icon: '◉' },
  { to: '/knowledge', label: 'Knowledge', icon: '◫' },
  { to: '/integrations', label: 'Integrations', icon: '⬡' },
  { to: '/analytics', label: 'Analytics', icon: '◬' },
  { to: '/social', label: 'Social Media', icon: '◈' },
];

const demoItem = { to: '/demo', label: 'Live Demo', icon: '▶' };

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export default function Layout() {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : '??';
  const showSidebar = !isMobile || sidebarOpen;

  return (
    <div style={styles.shell}>
      {/* Mobile top bar */}
      {isMobile && (
        <div style={styles.mobileBar}>
          <button style={styles.hamburger} onClick={() => setSidebarOpen((o) => !o)}>
            {sidebarOpen ? '✕' : '☰'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img
              src="/cropped-growthsense-main-logo.png"
              alt="GrowthSense"
              style={{ height: 26, width: 'auto', objectFit: 'contain' }}
            />
            <span style={{ fontSize: 13, fontWeight: 800, color: '#2e3191' }}>GrowthSense</span>
          </div>
          <div style={styles.avatar}>{initials}</div>
        </div>
      )}

      {/* Sidebar overlay (mobile) */}
      {isMobile && sidebarOpen && (
        <div
          style={styles.overlay}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      {showSidebar && (
        <aside style={{
          ...styles.sidebar,
          ...(isMobile ? styles.sidebarMobile : {}),
        }}>
          {/* Brand (desktop only) */}
          {!isMobile && (
            <div style={styles.brandWrap}>
              <img
                src="/cropped-growthsense-main-logo.png"
                alt="GrowthSense"
                style={{ height: 36, width: 'auto', objectFit: 'contain', flexShrink: 0 }}
              />
              <div style={styles.brandTextWrap}>
                <div style={styles.brandName}>GrowthSense</div>
                <div style={styles.brandSub}>AI SALES PARTNER</div>
              </div>
            </div>
          )}

          {/* Mobile sidebar header */}
          {isMobile && (
            <div style={{ ...styles.brandWrap, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img src="/cropped-growthsense-main-logo.png" alt="" style={{ height: 28 }} />
                <div style={styles.brandName}>GrowthSense</div>
              </div>
              <button style={styles.hamburger} onClick={() => setSidebarOpen(false)}>✕</button>
            </div>
          )}

          {/* Main nav */}
          <nav style={styles.nav}>
            <div style={styles.navSection}>MAIN</div>
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.activeLink : {}) })}
              >
                {({ isActive }) => (
                  <>
                    <span style={{ ...styles.linkIcon, color: isActive ? '#29abe2' : 'rgba(46,49,145,0.45)' }}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                    {isActive && <span style={styles.activeDot} />}
                  </>
                )}
              </NavLink>
            ))}

            <div style={{ ...styles.navSection, marginTop: 20 }}>TOOLS</div>
            <NavLink
              to={demoItem.to}
              style={({ isActive }) => ({
                ...styles.link,
                ...styles.demoLink,
                ...(isActive ? styles.activeDemoLink : {}),
              })}
            >
              {({ isActive }) => (
                <>
                  <span style={{ ...styles.linkIcon, color: isActive ? '#fff' : '#29abe2' }}>
                    {demoItem.icon}
                  </span>
                  <span>Live Demo</span>
                  <span style={styles.livePulse} />
                </>
              )}
            </NavLink>
          </nav>

          {/* User footer */}
          <div style={styles.footer}>
            <div style={styles.userRow}>
              <div style={styles.avatar}>{initials}</div>
              <div style={styles.userDetails}>
                <div style={styles.userEmail}>{user?.email ?? 'Admin'}</div>
                <div style={styles.userRole}>Administrator</div>
              </div>
            </div>
            <button style={styles.logoutBtn} onClick={handleLogout}>↩ Sign out</button>
          </div>
        </aside>
      )}

      <main style={{ ...styles.main, ...(isMobile ? styles.mainMobile : {}) }}>
        <Outlet />
      </main>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex', minHeight: '100vh',
    background: '#f0f8fe', color: '#0f172a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    flexDirection: 'column',
  },

  // ── Mobile top bar ──────────────────────────────────────────────────────────
  mobileBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 16px', height: 56,
    background: '#ffffff', borderBottom: '1px solid #cde8f5',
    position: 'sticky', top: 0, zIndex: 100,
    flexShrink: 0,
  },
  hamburger: {
    background: 'none', border: 'none',
    fontSize: 20, color: '#2e3191', cursor: 'pointer',
    padding: '4px 8px', borderRadius: 6,
  },
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.4)',
    zIndex: 199,
  },

  // ── Sidebar ────────────────────────────────────────────────────────────────
  sidebar: {
    width: 248,
    background: '#ffffff',
    display: 'flex', flexDirection: 'column',
    borderRight: '1px solid #cde8f5',
    flexShrink: 0,
  },
  sidebarMobile: {
    position: 'fixed', top: 56, left: 0, bottom: 0,
    zIndex: 200,
    boxShadow: '4px 0 24px rgba(0,0,0,0.12)',
    overflowY: 'auto',
  },

  brandWrap: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '20px 16px 18px',
    borderBottom: '1px solid #cde8f5',
  },
  brandTextWrap: { display: 'flex', flexDirection: 'column', gap: 1 },
  brandName: { fontSize: 14, fontWeight: 800, color: '#2e3191', letterSpacing: -0.2, lineHeight: 1 },
  brandSub: {
    fontSize: 9, color: '#29abe2', textTransform: 'uppercase' as const,
    letterSpacing: 1.2, fontWeight: 700, marginTop: 2,
  },
  nav: { flex: 1, padding: '16px 10px', display: 'flex', flexDirection: 'column', gap: 2 },
  navSection: {
    fontSize: 10, fontWeight: 700, color: '#b8c4d0',
    letterSpacing: 1, textTransform: 'uppercase' as const,
    padding: '6px 10px 4px',
  },
  link: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px', borderRadius: 10,
    color: '#64748b', textDecoration: 'none',
    fontSize: 13, fontWeight: 500,
    transition: 'background 0.15s, color 0.15s',
    position: 'relative',
  },
  activeLink: {
    background: '#eef6fc',
    color: '#2e3191',
    fontWeight: 600,
  },
  linkIcon: { fontSize: 14, width: 18, textAlign: 'center' as const, flexShrink: 0 },
  activeDot: {
    width: 5, height: 5, borderRadius: '50%',
    background: '#29abe2', marginLeft: 'auto', flexShrink: 0,
  },
  demoLink: {
    background: '#eef6fc',
    border: '1px solid #b8dff5',
    color: '#29abe2',
    fontWeight: 600,
    marginTop: 4,
  },
  activeDemoLink: {
    background: 'linear-gradient(135deg, #29abe2, #2e3191)',
    border: '1px solid transparent',
    color: '#fff',
  },
  livePulse: {
    width: 7, height: 7, borderRadius: '50%',
    background: '#10b981', marginLeft: 'auto', flexShrink: 0,
    animation: 'pulse-dot 2s ease-in-out infinite',
  },
  footer: { padding: '16px 12px', borderTop: '1px solid #cde8f5' },
  userRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: {
    width: 34, height: 34, borderRadius: 10,
    background: 'linear-gradient(135deg, #29abe2, #2e3191)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0,
  },
  userDetails: { flex: 1, overflow: 'hidden' },
  userEmail: { fontSize: 12, color: '#475569', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  userRole: { fontSize: 10, color: '#94a3b8', marginTop: 1 },
  logoutBtn: {
    width: '100%', padding: '8px',
    borderRadius: 8, border: '1px solid #cde8f5',
    background: '#f8fafc', color: '#64748b',
    fontSize: 12, cursor: 'pointer', fontWeight: 500,
  },

  // ── Main content ───────────────────────────────────────────────────────────
  main: {
    flex: 1, overflowY: 'auto', padding: 32,
    background: '#f0f8fe',
    display: 'flex', flexDirection: 'column',
  },
  mainMobile: {
    padding: 16,
    width: '100%',
  },
};
