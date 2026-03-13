import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Integration {
  type: string;
  status: string;
  connectedAt: string | null;
  config?: Record<string, unknown>;
}

// ── Integration definitions ────────────────────────────────────────────────

const INTEGRATIONS = [
  {
    type: 'crm_hubspot',
    label: 'HubSpot CRM',
    category: 'CRM',
    icon: '🟠',
    description: 'Automatically push qualified leads to your HubSpot account as contacts.',
    docsUrl: 'https://developers.hubspot.com/docs/api/private-apps',
    fields: [
      { key: 'accessToken', label: 'Private App Access Token', placeholder: 'pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', type: 'password', required: true, hint: 'Create a Private App in HubSpot → Settings → Integrations → Private Apps' },
    ],
    configFields: [],
  },
  {
    type: 'crm_salesforce',
    label: 'Salesforce CRM',
    category: 'CRM',
    icon: '☁️',
    description: 'Sync leads to Salesforce as Leads or Contacts with custom field mapping.',
    docsUrl: 'https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm',
    fields: [
      { key: 'instanceUrl', label: 'Instance URL', placeholder: 'https://yourcompany.my.salesforce.com', type: 'text', required: true, hint: 'Your Salesforce org URL' },
      { key: 'accessToken', label: 'Access Token', placeholder: '00Dxx0000000000!...', type: 'password', required: true, hint: 'OAuth access token from your connected app' },
      { key: 'clientId', label: 'Client ID', placeholder: 'Connected App Consumer Key', type: 'text', required: false },
      { key: 'clientSecret', label: 'Client Secret', placeholder: 'Connected App Consumer Secret', type: 'password', required: false },
    ],
    configFields: [],
  },
  {
    type: 'calendar_calendly',
    label: 'Calendly',
    category: 'Calendar',
    icon: '📅',
    description: 'Let the AI agent book demos directly using your Calendly event types.',
    docsUrl: 'https://developer.calendly.com/api-docs',
    fields: [
      { key: 'apiKey', label: 'Personal Access Token', placeholder: 'eyJraWQiOi...', type: 'password', required: true, hint: 'Found in Calendly → Integrations → API & Webhooks' },
    ],
    configFields: [
      { key: 'eventTypeUri', label: 'Event Type URI', placeholder: 'https://api.calendly.com/event_types/xxxxxxxx', type: 'text', hint: 'The specific event type URI for demos (optional — defaults to first available)' },
    ],
  },
  {
    type: 'calendar_calcom',
    label: 'Cal.com',
    category: 'Calendar',
    icon: '📆',
    description: 'Use Cal.com for open-source scheduling directly from the AI agent.',
    docsUrl: 'https://cal.com/docs/enterprise-features/api/api-keys',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'cal_live_xxxxxxxxxx', type: 'password', required: true, hint: 'Settings → Developer → API Keys in your Cal.com account' },
    ],
    configFields: [
      { key: 'eventTypeId', label: 'Event Type ID', placeholder: '12345', type: 'text', hint: 'Numeric ID of your demo event type (optional)' },
    ],
  },
  {
    type: 'email_smtp',
    label: 'SMTP Email',
    category: 'Email',
    icon: '✉️',
    description: 'Send follow-up emails after conversations using your own mail server.',
    docsUrl: '',
    fields: [
      { key: 'host', label: 'SMTP Host', placeholder: 'smtp.gmail.com', type: 'text', required: true },
      { key: 'port', label: 'Port', placeholder: '587', type: 'text', required: true },
      { key: 'user', label: 'Username / Email', placeholder: 'you@company.com', type: 'text', required: true },
      { key: 'password', label: 'Password / App Password', placeholder: '••••••••••••', type: 'password', required: true },
      { key: 'secure', label: 'Use TLS (port 465)', placeholder: '', type: 'checkbox', required: false },
    ],
    configFields: [
      { key: 'fromName', label: 'From Name', placeholder: 'Alex at Acme Corp', type: 'text' },
    ],
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  CRM: '#f59e0b',
  Calendar: '#10b981',
  Email: '#3b82f6',
};

// ── Component ──────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, Record<string, string | boolean>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  useEffect(() => {
    api.get('/integrations')
      .then((r) => setIntegrations(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const getIntegration = (type: string) => integrations.find((i) => i.type === type);

  const setField = (type: string, key: string, value: string | boolean) => {
    setFormValues((prev) => ({
      ...prev,
      [type]: { ...(prev[type] ?? {}), [key]: value },
    }));
  };

  const save = async (intDef: typeof INTEGRATIONS[0]) => {
    const vals = formValues[intDef.type] ?? {};
    const credentials: Record<string, unknown> = {};
    const config: Record<string, unknown> = {};

    for (const f of intDef.fields) {
      if (f.type === 'checkbox') credentials[f.key] = vals[f.key] ?? false;
      else if (vals[f.key]) credentials[f.key] = f.type === 'text' && f.key === 'port' ? Number(vals[f.key]) : vals[f.key];
    }
    for (const f of intDef.configFields) {
      if (vals[f.key]) config[f.key] = vals[f.key];
    }

    setSaving(intDef.type);
    try {
      const { data } = await api.put(`/integrations/${intDef.type}`, {
        type: intDef.type,
        credentials,
        ...(Object.keys(config).length > 0 ? { config } : {}),
      });
      setIntegrations((prev) => {
        const exists = prev.find((i) => i.type === intDef.type);
        if (exists) return prev.map((i) => i.type === intDef.type ? data : i);
        return [...prev, data];
      });
      setFormValues((prev) => ({ ...prev, [intDef.type]: {} }));
    } catch (err: any) {
      alert(`Save failed: ${err?.response?.data?.message ?? err.message}`);
    } finally {
      setSaving(null);
    }
  };

  const test = async (type: string) => {
    setTesting(type);
    setTestResult((prev) => ({ ...prev, [type]: { ok: false, message: 'Testing…' } }));
    try {
      const { data } = await api.post(`/integrations/${type}/test`);
      setTestResult((prev) => ({ ...prev, [type]: data }));
      if (data.ok) {
        setIntegrations((prev) =>
          prev.map((i) => i.type === type ? { ...i, status: 'connected' } : i),
        );
      }
    } catch (err: any) {
      setTestResult((prev) => ({ ...prev, [type]: { ok: false, message: err?.response?.data?.message ?? 'Test failed' } }));
    } finally {
      setTesting(null);
    }
  };

  const disconnect = async (type: string) => {
    if (!confirm(`Disconnect ${type.replace(/_/g, ' ')}? This cannot be undone.`)) return;
    setDisconnecting(type);
    try {
      await api.delete(`/integrations/${type}`);
      setIntegrations((prev) => prev.filter((i) => i.type !== type));
      setTestResult((prev) => { const n = { ...prev }; delete n[type]; return n; });
    } catch (err: any) {
      alert(`Disconnect failed: ${err?.response?.data?.message ?? err.message}`);
    } finally {
      setDisconnecting(null);
    }
  };

  if (loading) return <p style={{ color: '#94a3b8' }}>Loading…</p>;

  const categories = Array.from(new Set(INTEGRATIONS.map((i) => i.category)));

  return (
    <div>
      <div style={styles.topbar}>
        <div>
          <h2 style={styles.heading}>Integrations</h2>
          <p style={styles.sub}>Connect your CRM, calendar, and email tools. Credentials are encrypted at rest.</p>
        </div>
        <div style={styles.connectedCount}>
          <span style={styles.connectedDot} />
          {integrations.filter((i) => i.status === 'connected').length} connected
        </div>
      </div>

      {categories.map((category) => (
        <div key={category} style={{ marginBottom: 32 }}>
          <div style={styles.categoryHeader}>
            <span style={{ ...styles.categoryDot, background: CATEGORY_COLORS[category] ?? '#6366f1' }} />
            <span style={styles.categoryLabel}>{category}</span>
          </div>

          <div style={styles.grid}>
            {INTEGRATIONS.filter((i) => i.category === category).map((intDef) => {
              const saved = getIntegration(intDef.type);
              const connected = saved?.status === 'connected';
              const isOpen = expanded === intDef.type;
              const vals = formValues[intDef.type] ?? {};
              const tr = testResult[intDef.type];

              return (
                <div key={intDef.type} style={{ ...styles.card, borderColor: isOpen ? '#38bdf8' : connected ? '#10b98140' : '#334155' }}>
                  {/* Card header */}
                  <div style={styles.cardTop} onClick={() => setExpanded(isOpen ? null : intDef.type)}>
                    <div style={styles.iconWrap}>
                      <span style={{ fontSize: 22 }}>{intDef.icon}</span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={styles.cardLabel}>{intDef.label}</div>
                      <div style={styles.cardDesc}>{intDef.description}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      <span style={{ ...styles.statusPill, background: connected ? '#10b98115' : '#64748b15', color: connected ? '#10b981' : '#64748b' }}>
                        {connected ? '● Connected' : '○ Not connected'}
                      </span>
                      <span style={{ fontSize: 11, color: '#475569' }}>{isOpen ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* Config panel */}
                  {isOpen && (
                    <div style={styles.configPanel}>
                      {connected && (
                        <div style={styles.connectedBanner}>
                          <span style={{ color: '#10b981', marginRight: 8 }}>✓</span>
                          Connected{saved?.connectedAt ? ` · since ${new Date(saved.connectedAt).toLocaleDateString()}` : ''}
                          <span style={{ flex: 1 }} />
                          {intDef.docsUrl && (
                            <a href={intDef.docsUrl} target="_blank" rel="noopener noreferrer" style={styles.docsLink}>
                              Docs ↗
                            </a>
                          )}
                        </div>
                      )}

                      {!connected && intDef.docsUrl && (
                        <div style={styles.docsRow}>
                          <span style={{ color: '#64748b', fontSize: 12 }}>Need help? </span>
                          <a href={intDef.docsUrl} target="_blank" rel="noopener noreferrer" style={styles.docsLink}>
                            View API docs ↗
                          </a>
                        </div>
                      )}

                      {/* Credential fields */}
                      {intDef.fields.length > 0 && (
                        <div style={styles.fieldsSection}>
                          <div style={styles.sectionTitle}>
                            {connected ? 'Update Credentials' : 'Credentials'}
                          </div>
                          {intDef.fields.map((f) => (
                            <div key={f.key} style={styles.fieldGroup}>
                              <label style={styles.fieldLabel}>
                                {f.label}
                                {f.required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
                              </label>
                              {f.type === 'checkbox' ? (
                                <label style={styles.checkboxRow}>
                                  <input
                                    type="checkbox"
                                    checked={!!(vals[f.key] ?? false)}
                                    onChange={(e) => setField(intDef.type, f.key, e.target.checked)}
                                    style={{ accentColor: '#0284c7' }}
                                  />
                                  <span style={{ fontSize: 13, color: '#94a3b8' }}>Enable TLS / SSL</span>
                                </label>
                              ) : (
                                <input
                                  style={styles.fieldInput}
                                  type={f.type}
                                  placeholder={f.placeholder}
                                  value={(vals[f.key] as string) ?? ''}
                                  onChange={(e) => setField(intDef.type, f.key, e.target.value)}
                                  autoComplete="off"
                                />
                              )}
                              {f.hint && <div style={styles.fieldHint}>{f.hint}</div>}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Config fields */}
                      {intDef.configFields.length > 0 && (
                        <div style={styles.fieldsSection}>
                          <div style={styles.sectionTitle}>Configuration (optional)</div>
                          {intDef.configFields.map((f) => (
                            <div key={f.key} style={styles.fieldGroup}>
                              <label style={styles.fieldLabel}>{f.label}</label>
                              <input
                                style={styles.fieldInput}
                                type={f.type}
                                placeholder={f.placeholder}
                                value={(vals[f.key] as string) ?? ''}
                                onChange={(e) => setField(intDef.type, f.key, e.target.value)}
                                autoComplete="off"
                              />
                              {f.hint && <div style={styles.fieldHint}>{f.hint}</div>}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Test result */}
                      {tr && (
                        <div style={{ ...styles.testResult, background: tr.ok ? '#10b98110' : '#ef444410', borderColor: tr.ok ? '#10b98140' : '#ef444440' }}>
                          <span style={{ color: tr.ok ? '#10b981' : '#ef4444', marginRight: 6 }}>
                            {tr.ok ? '✓' : '✗'}
                          </span>
                          {tr.message}
                        </div>
                      )}

                      {/* Actions */}
                      <div style={styles.actions}>
                        <button
                          style={{ ...styles.saveBtn, opacity: saving === intDef.type ? 0.6 : 1 }}
                          onClick={() => save(intDef)}
                          disabled={saving === intDef.type}
                        >
                          {saving === intDef.type ? 'Saving…' : connected ? 'Update credentials' : 'Save & connect'}
                        </button>

                        {connected && (
                          <>
                            <button
                              style={{ ...styles.testBtn, opacity: testing === intDef.type ? 0.6 : 1 }}
                              onClick={() => test(intDef.type)}
                              disabled={testing === intDef.type}
                            >
                              {testing === intDef.type ? 'Testing…' : 'Test connection'}
                            </button>
                            <button
                              style={{ ...styles.disconnectBtn, opacity: disconnecting === intDef.type ? 0.6 : 1 }}
                              onClick={() => disconnect(intDef.type)}
                              disabled={disconnecting === intDef.type}
                            >
                              Disconnect
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 },
  heading: { margin: '0 0 4px', color: '#f8fafc', fontSize: 22 },
  sub: { margin: 0, color: '#64748b', fontSize: 13 },
  connectedCount: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#10b98110', border: '1px solid #10b98130', borderRadius: 20, color: '#10b981', fontSize: 13, fontWeight: 600 },
  connectedDot: { width: 8, height: 8, borderRadius: '50%', background: '#10b981' },

  categoryHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  categoryDot: { width: 8, height: 8, borderRadius: '50%' },
  categoryLabel: { fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 },

  grid: { display: 'flex', flexDirection: 'column', gap: 8 },
  card: {
    background: '#1e293b',
    borderRadius: 12,
    border: '1px solid #334155',
    overflow: 'hidden',
    transition: 'border-color 0.2s',
  },
  cardTop: {
    display: 'flex', alignItems: 'flex-start', gap: 14,
    padding: '16px 20px', cursor: 'pointer',
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: 10,
    background: '#0f172a',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    border: '1px solid #334155',
  },
  cardLabel: { fontSize: 15, fontWeight: 600, color: '#f8fafc', marginBottom: 3 },
  cardDesc: { fontSize: 12, color: '#64748b', lineHeight: 1.5 },
  statusPill: { padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 },

  // Config panel
  configPanel: { borderTop: '1px solid #334155', padding: '20px', background: '#0f172a', display: 'flex', flexDirection: 'column', gap: 16 },
  connectedBanner: { display: 'flex', alignItems: 'center', padding: '10px 14px', borderRadius: 8, background: '#10b98110', border: '1px solid #10b98130', fontSize: 13, color: '#10b981' },
  docsRow: { display: 'flex', gap: 4, alignItems: 'center' },
  docsLink: { fontSize: 12, color: '#38bdf8', textDecoration: 'none', fontWeight: 500 },

  fieldsSection: { display: 'flex', flexDirection: 'column', gap: 12 },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 5 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: '#94a3b8' },
  fieldInput: {
    padding: '9px 12px',
    borderRadius: 8,
    border: '1px solid #334155',
    background: '#1e293b',
    color: '#f8fafc',
    fontSize: 13,
    outline: 'none',
  },
  fieldHint: { fontSize: 11, color: '#475569', lineHeight: 1.4 },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
  testResult: { padding: '10px 14px', borderRadius: 8, border: '1px solid', fontSize: 13, color: '#cbd5e1' },

  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  saveBtn: {
    padding: '9px 18px', borderRadius: 8, border: 'none',
    background: 'linear-gradient(135deg, #0284c7, #0369a1)',
    color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  testBtn: {
    padding: '9px 18px', borderRadius: 8,
    border: '1px solid #334155',
    background: 'transparent', color: '#94a3b8', fontSize: 13, cursor: 'pointer',
  },
  disconnectBtn: {
    padding: '9px 18px', borderRadius: 8,
    border: '1px solid #ef444440',
    background: 'transparent', color: '#ef4444', fontSize: 13, cursor: 'pointer', marginLeft: 'auto',
  },
};
