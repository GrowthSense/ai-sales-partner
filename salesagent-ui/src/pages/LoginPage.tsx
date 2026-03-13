import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';

const BG_IMAGE = '/empty-white-interior-with-table-chair-brick-wall-2026-01-11-08-33-54-utc.jpg';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      {/* Full-bleed background photo */}
      <div style={{ ...styles.bgPhoto, backgroundImage: `url(${BG_IMAGE})` }} />

      {/* Subtle dark veil so text is readable */}
      <div style={styles.veil} />

      {/* Glass card */}
      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logoWrap}>
          <img
            src="/cropped-growthsense-main-logo.png"
            alt="GrowthSense"
            style={{ height: 68, width: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.18))' }}
          />
        </div>

        <h1 style={styles.heading}>Welcome back</h1>
        <p style={styles.tagline}>Sign in to your AI Sales Partner dashboard</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Email address</label>
            <input
              style={{
                ...styles.input,
                borderColor: focusedField === 'email'
                  ? 'rgba(41,171,226,0.9)'
                  : error
                  ? 'rgba(239,68,68,0.7)'
                  : 'rgba(255,255,255,0.35)',
                boxShadow: focusedField === 'email'
                  ? '0 0 0 3px rgba(41,171,226,0.25)'
                  : 'none',
              }}
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField(null)}
              required
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Password</label>
            <input
              style={{
                ...styles.input,
                borderColor: focusedField === 'password'
                  ? 'rgba(41,171,226,0.9)'
                  : error
                  ? 'rgba(239,68,68,0.7)'
                  : 'rgba(255,255,255,0.35)',
                boxShadow: focusedField === 'password'
                  ? '0 0 0 3px rgba(41,171,226,0.25)'
                  : 'none',
              }}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              required
            />
          </div>

          {error && (
            <div style={styles.errorBox}>
              <span style={{ marginRight: 6 }}>⚠</span>{error}
            </div>
          )}

          <button
            style={{ ...styles.btn, opacity: loading ? 0.75 : 1 }}
            type="submit"
            disabled={loading}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={styles.spinner} />Signing in…
              </span>
            ) : 'Sign in →'}
          </button>
        </form>

        <div style={styles.divider}>
          <span style={styles.dividerLine} />
          <span style={styles.dividerText}>🔒 Secure</span>
          <span style={styles.dividerLine} />
        </div>

        <div style={styles.features}>
          {['AI Lead Qualification', 'Real-time Conversations', 'CRM Sync'].map((f) => (
            <div key={f} style={styles.featureChip}>
              <span style={{ color: '#29abe2', marginRight: 5 }}>✓</span>{f}
            </div>
          ))}
        </div>

        <p style={styles.footerNote}>Powered by GrowthSense · AI Sales Partner</p>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }

        input::placeholder { color: rgba(255,255,255,0.45); }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },

  /* Background photo — covers full viewport */
  bgPhoto: {
    position: 'absolute', inset: 0,
    backgroundSize: 'cover', backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  },

  /* Very light dark veil for legibility */
  veil: {
    position: 'absolute', inset: 0,
    background: 'linear-gradient(135deg, rgba(20,24,65,0.55) 0%, rgba(10,14,40,0.40) 60%, rgba(41,171,226,0.25) 100%)',
  },

  /* ── Glass card ── */
  card: {
    position: 'relative', zIndex: 1,
    width: 460,
    padding: '44px 48px 36px',
    borderRadius: 24,
    /* frosted glass */
    background: 'rgba(255,255,255,0.12)',
    backdropFilter: 'blur(28px) saturate(160%)',
    WebkitBackdropFilter: 'blur(28px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.30)',
    boxShadow: '0 8px 48px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.25)',
  },

  logoWrap: {
    display: 'flex', justifyContent: 'center',
    marginBottom: 18,
  },

  heading: {
    margin: '0 0 6px',
    fontSize: 26, fontWeight: 800,
    color: '#ffffff',
    textAlign: 'center' as const,
    letterSpacing: -0.4,
    textShadow: '0 2px 12px rgba(0,0,0,0.25)',
  },

  tagline: {
    margin: '0 0 28px',
    fontSize: 13, color: 'rgba(255,255,255,0.72)',
    lineHeight: 1.5, textAlign: 'center' as const,
  },

  form: { display: 'flex', flexDirection: 'column', gap: 16 },

  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 6 },

  label: {
    fontSize: 11, fontWeight: 700,
    color: 'rgba(255,255,255,0.75)',
    textTransform: 'uppercase' as const, letterSpacing: 0.8,
  },

  input: {
    padding: '13px 16px', borderRadius: 10,
    border: '1.5px solid rgba(255,255,255,0.30)',
    background: 'rgba(255,255,255,0.14)',
    color: '#ffffff',
    fontSize: 14, outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    backdropFilter: 'blur(8px)',
  },

  errorBox: {
    padding: '10px 14px', borderRadius: 8,
    background: 'rgba(239,68,68,0.20)',
    border: '1px solid rgba(239,68,68,0.50)',
    color: '#fca5a5', fontSize: 13,
    display: 'flex', alignItems: 'center',
  },

  btn: {
    marginTop: 4, padding: '14px', borderRadius: 10, border: 'none',
    background: 'linear-gradient(135deg, #29abe2 0%, #2e3191 100%)',
    color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
    boxShadow: '0 6px 24px rgba(41,171,226,0.45)', letterSpacing: 0.2,
    transition: 'opacity 0.2s',
  },

  spinner: {
    width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff', borderRadius: '50%',
    display: 'inline-block', animation: 'spin 0.7s linear infinite',
  },

  divider: { display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 16px' },
  dividerLine: { flex: 1, height: 1, background: 'rgba(255,255,255,0.20)', display: 'block' },
  dividerText: {
    fontSize: 11, color: 'rgba(255,255,255,0.55)',
    whiteSpace: 'nowrap' as const, fontWeight: 600, letterSpacing: 0.4,
  },

  features: { display: 'flex', flexWrap: 'wrap' as const, gap: 7 },
  featureChip: {
    padding: '5px 12px', borderRadius: 20,
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.25)',
    color: 'rgba(255,255,255,0.80)', fontSize: 11, fontWeight: 500,
    display: 'flex', alignItems: 'center',
    backdropFilter: 'blur(6px)',
  },

  footerNote: {
    margin: '20px 0 0', textAlign: 'center' as const,
    fontSize: 11, color: 'rgba(255,255,255,0.40)', letterSpacing: 0.3,
  },
};
