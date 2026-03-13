import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';

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
      <div style={styles.blob1} />
      <div style={styles.blob2} />
      <div style={styles.blob3} />

      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logoWrap}>
          <img
            src="/cropped-growthsense-main-logo.png"
            alt="GrowthSense"
            style={{ height: 64, width: 'auto', objectFit: 'contain' }}
          />
        </div>

        <p style={styles.tagline}>Sign in to your AI Sales Partner dashboard</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Email address</label>
            <input
              style={{
                ...styles.input,
                borderColor: focusedField === 'email' ? '#29abe2' : error ? '#ef4444' : '#b8dff5',
                boxShadow: focusedField === 'email' ? '0 0 0 3px rgba(41,171,226,0.14)' : 'none',
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
                borderColor: focusedField === 'password' ? '#29abe2' : error ? '#ef4444' : '#b8dff5',
                boxShadow: focusedField === 'password' ? '0 0 0 3px rgba(41,171,226,0.14)' : 'none',
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

          <button style={{ ...styles.btn, opacity: loading ? 0.7 : 1 }} type="submit" disabled={loading}>
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
              <span style={{ color: '#29abe2', marginRight: 4 }}>✓</span>{f}
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes float1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(40px,-30px) scale(1.1); } }
        @keyframes float2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-30px,40px) scale(1.05); } }
        @keyframes float3 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(20px,20px) scale(1.08); } }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(135deg, #eef6fc 0%, #f0f8fe 50%, #e8f4fc 100%)',
    position: 'relative', overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  blob1: {
    position: 'absolute', top: '10%', left: '15%',
    width: 400, height: 400, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(41,171,226,0.14) 0%, transparent 70%)',
    animation: 'float1 8s ease-in-out infinite', pointerEvents: 'none',
  },
  blob2: {
    position: 'absolute', bottom: '15%', right: '10%',
    width: 350, height: 350, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(46,49,145,0.1) 0%, transparent 70%)',
    animation: 'float2 10s ease-in-out infinite', pointerEvents: 'none',
  },
  blob3: {
    position: 'absolute', top: '50%', right: '30%',
    width: 250, height: 250, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(41,171,226,0.08) 0%, transparent 70%)',
    animation: 'float3 7s ease-in-out infinite', pointerEvents: 'none',
  },
  card: {
    position: 'relative', zIndex: 1,
    background: 'rgba(255,255,255,0.94)',
    backdropFilter: 'blur(20px)',
    borderRadius: 20, padding: '44px 48px', width: 420,
    boxShadow: '0 8px 48px rgba(46,49,145,0.12), 0 2px 12px rgba(41,171,226,0.1)',
    border: '1px solid #cde8f5',
  },
  logoWrap: {
    display: 'flex', justifyContent: 'center',
    marginBottom: 20,
  },
  tagline: { margin: '0 0 28px', fontSize: 13, color: '#64748b', lineHeight: 1.5, textAlign: 'center' as const },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  input: {
    padding: '12px 16px', borderRadius: 10,
    border: '1.5px solid #b8dff5',
    background: '#f8fafc', color: '#0f172a',
    fontSize: 14, outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  errorBox: {
    padding: '10px 14px', borderRadius: 8,
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.25)',
    color: '#dc2626', fontSize: 13,
    display: 'flex', alignItems: 'center',
  },
  btn: {
    marginTop: 4, padding: '13px', borderRadius: 10, border: 'none',
    background: 'linear-gradient(135deg, #29abe2 0%, #2e3191 100%)',
    color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(41,171,226,0.35)', letterSpacing: 0.2,
  },
  spinner: {
    width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff', borderRadius: '50%',
    display: 'inline-block', animation: 'spin 0.7s linear infinite',
  },
  divider: { display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 16px' },
  dividerLine: { flex: 1, height: 1, background: '#cde8f5', display: 'block' },
  dividerText: { fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' as const, fontWeight: 600, letterSpacing: 0.3 },
  features: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  featureChip: {
    padding: '4px 10px', borderRadius: 20,
    background: '#eef6fc', border: '1px solid #b8dff5',
    color: '#475569', fontSize: 11, fontWeight: 500,
    display: 'flex', alignItems: 'center',
  },
};
