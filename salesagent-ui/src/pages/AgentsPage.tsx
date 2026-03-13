import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Agent {
  id: string;
  name: string;
  status: string;
  persona: string;
  fallbackMessage?: string;
  enabledSkills: string[];
  templateVars?: Record<string, string>;
  llmConfig?: { model?: string; temperature?: number; maxTokens?: number };
  createdAt: string;
}

const ALL_SKILLS = [
  { name: 'AnswerQuestion', desc: 'Answer questions using knowledge base' },
  { name: 'CaptureContact', desc: 'Collect name, email, phone, company' },
  { name: 'QualifyLead', desc: 'Record BANT qualification signals' },
  { name: 'RecommendService', desc: 'Match visitor needs to your services' },
  { name: 'ScheduleDemo', desc: 'Book demos via calendar integration' },
  { name: 'PushToCRM', desc: 'Sync lead to HubSpot / Salesforce' },
  { name: 'SendFollowUpEmail', desc: 'Queue follow-up email sequences' },
  { name: 'HandoffToHuman', desc: 'Pause AI and alert a human sales rep' },
  { name: 'TransitionStage', desc: 'Advance conversation through sales stages' },
];

const STATUS_COLOR: Record<string, string> = { active: '#10b981', draft: '#f59e0b', inactive: '#94a3b8' };

type AgentForm = Partial<Agent> & { templateVars: Record<string, string> };
const BLANK_FORM: AgentForm = { name: '', persona: '', fallbackMessage: '', enabledSkills: [], templateVars: {} };

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createForm, setCreateForm] = useState<AgentForm>({ ...BLANK_FORM });
  const [editForm, setEditForm] = useState<AgentForm>({ ...BLANK_FORM });

  const load = () => {
    api.get('/agents').then((r) => setAgents(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/agents', {
        name: createForm.name,
        persona: createForm.persona,
        fallbackMessage: createForm.fallbackMessage,
        enabledSkills: createForm.enabledSkills,
        templateVars: createForm.templateVars,
      });
      setCreateForm({ ...BLANK_FORM });
      setShowCreate(false);
      load();
    } finally { setSaving(false); }
  };

  const toggleCreateSkill = (skill: string) => {
    setCreateForm((f) => ({
      ...f,
      enabledSkills: f.enabledSkills?.includes(skill)
        ? f.enabledSkills.filter((s) => s !== skill)
        : [...(f.enabledSkills ?? []), skill],
    }));
  };
  const setCreateTplVar = (key: string, val: string) => {
    setCreateForm((f) => ({ ...f, templateVars: { ...f.templateVars, [key]: val } }));
  };

  const startEdit = (a: Agent) => {
    setEditing(a.id);
    setEditForm({
      name: a.name,
      persona: a.persona ?? '',
      fallbackMessage: a.fallbackMessage ?? '',
      enabledSkills: [...(a.enabledSkills ?? [])],
      templateVars: { ...(a.templateVars ?? {}) },
      llmConfig: { ...(a.llmConfig ?? {}) },
    });
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    try {
      await api.patch(`/agents/${id}`, {
        name: editForm.name,
        persona: editForm.persona,
        fallbackMessage: editForm.fallbackMessage,
        enabledSkills: editForm.enabledSkills,
        templateVars: editForm.templateVars,
        ...(editForm.llmConfig ? { llmConfig: editForm.llmConfig } : {}),
      });
      setEditing(null);
      load();
    } finally { setSaving(false); }
  };

  const deploy = async (id: string) => {
    await api.post(`/agents/${id}/deploy`);
    load();
  };

  const toggleSkill = (skill: string) => {
    setEditForm((f) => ({
      ...f,
      enabledSkills: f.enabledSkills?.includes(skill)
        ? f.enabledSkills.filter((s) => s !== skill)
        : [...(f.enabledSkills ?? []), skill],
    }));
  };

  const setTplVar = (key: string, val: string) => {
    setEditForm((f) => ({ ...f, templateVars: { ...f.templateVars, [key]: val } }));
  };

  return (
    <div>
      <div style={styles.topbar}>
        <div>
          <h2 style={styles.heading}>Agents</h2>
          <p style={styles.subheading}>Configure your AI sales agents — persona, skills, and behaviour</p>
        </div>
        <button style={styles.primaryBtn} onClick={() => setShowCreate(!showCreate)}>+ New Agent</button>
      </div>

      {showCreate && (
        <form onSubmit={create} style={{ ...styles.card, marginBottom: 20, overflow: 'visible' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f9ff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 15 }}>New Agent</div>
            <button type="button" style={styles.editBtn} onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
          <div style={styles.editPanel}>
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Identity</div>
              <div style={styles.fieldRow}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Agent Name *</label>
                  <input style={styles.input} value={createForm.name ?? ''} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="e.g. Alex" required />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Company Name</label>
                  <input style={styles.input} value={createForm.templateVars?.companyName ?? ''} onChange={(e) => setCreateTplVar('companyName', e.target.value)} placeholder="e.g. Acme Corp" />
                </div>
              </div>
              <div style={styles.fieldRow}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Product / Service Name</label>
                  <input style={styles.input} value={createForm.templateVars?.productName ?? ''} onChange={(e) => setCreateTplVar('productName', e.target.value)} placeholder="e.g. Acme Analytics Platform" />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Industry</label>
                  <input style={styles.input} value={createForm.templateVars?.industry ?? ''} onChange={(e) => setCreateTplVar('industry', e.target.value)} placeholder="e.g. B2B SaaS, E-commerce" />
                </div>
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Tone</label>
                <input style={styles.input} value={createForm.templateVars?.tone ?? ''} onChange={(e) => setCreateTplVar('tone', e.target.value)} placeholder="e.g. professional and friendly, direct and concise" />
              </div>
            </div>
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Persona & Behaviour</div>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>System Persona</label>
                <p style={{ margin: '0 0 6px', fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>Describe your company, what you sell, who your ideal customer is, and how the agent should behave.</p>
                <textarea style={{ ...styles.input, height: 140, resize: 'vertical', lineHeight: 1.5 }} value={createForm.persona ?? ''} onChange={(e) => setCreateForm({ ...createForm, persona: e.target.value })} placeholder={`Example:\nYou are Alex, a sales consultant at Acme Corp. We help B2B companies automate reporting. Our ideal customer is a data team of 5-50 people. Key differentiators: 5-minute setup, native CRM integrations, 99.9% uptime SLA.`} />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Fallback Message</label>
                <input style={styles.input} value={createForm.fallbackMessage ?? ''} onChange={(e) => setCreateForm({ ...createForm, fallbackMessage: e.target.value })} placeholder="e.g. I don't have that information — let me connect you with our team." />
              </div>
            </div>
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Skills</div>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: '#94a3b8' }}>Enable the capabilities this agent can use.</p>
              <div style={styles.skillsGrid}>
                {ALL_SKILLS.map((skill) => {
                  const enabled = createForm.enabledSkills?.includes(skill.name) ?? false;
                  return (
                    <div key={skill.name} style={{ ...styles.skillToggle, borderColor: enabled ? '#0284c7' : '#e0f2fe', background: enabled ? '#eff6ff' : '#f8fafc' }} onClick={() => toggleCreateSkill(skill.name)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ ...styles.skillDot, background: enabled ? '#0284c7' : '#cbd5e1' }} />
                        <div style={{ fontSize: 13, fontWeight: 600, color: enabled ? '#0284c7' : '#475569' }}>{skill.name}</div>
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{skill.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '0 24px 24px' }}>
              <button style={styles.primaryBtn} type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create Agent'}</button>
              <button style={styles.secondaryBtn} type="button" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: '#94a3b8' }}>Loading…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {agents.length === 0 && <p style={{ color: '#94a3b8' }}>No agents yet — create one above.</p>}
          {agents.map((a) => (
            <div key={a.id} style={styles.card}>
              {/* Card header */}
              <div style={styles.cardHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={styles.agentAvatar}>{a.name?.[0]?.toUpperCase() ?? 'A'}</div>
                  <div>
                    <div style={styles.agentName}>{a.name}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>
                      {(a.enabledSkills ?? []).length} skills enabled
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ ...styles.pill, background: `${STATUS_COLOR[a.status] ?? '#64748b'}22`, color: STATUS_COLOR[a.status] ?? '#94a3b8' }}>
                    {a.status}
                  </span>
                  {a.status === 'draft' && (
                    <button style={styles.deployBtn} onClick={() => deploy(a.id)}>Deploy →</button>
                  )}
                  <button style={styles.editBtn} onClick={() => editing === a.id ? setEditing(null) : startEdit(a)}>
                    {editing === a.id ? 'Close' : '✏ Edit'}
                  </button>
                </div>
              </div>

              {/* Collapsed preview */}
              {editing !== a.id && (
                <div style={{ padding: '0 20px 16px' }}>
                  <p style={styles.personaPreview}>
                    {a.persona?.slice(0, 160) || 'No persona set — click Edit to configure this agent.'}
                    {(a.persona?.length ?? 0) > 160 ? '…' : ''}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(a.enabledSkills ?? []).map((s) => (
                      <span key={s} style={styles.skillTag}>{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Edit form */}
              {editing === a.id && (
                <div style={styles.editPanel}>
                  {/* Identity section */}
                  <div style={styles.section}>
                    <div style={styles.sectionTitle}>Identity</div>
                    <div style={styles.fieldRow}>
                      <div style={styles.fieldGroup}>
                        <label style={styles.label}>Agent Name</label>
                        <input style={styles.input} value={editForm.name ?? ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="e.g. Alex" />
                      </div>
                      <div style={styles.fieldGroup}>
                        <label style={styles.label}>Company Name</label>
                        <input style={styles.input} value={editForm.templateVars?.companyName ?? ''} onChange={(e) => setTplVar('companyName', e.target.value)} placeholder="e.g. Acme Corp" />
                      </div>
                    </div>
                    <div style={styles.fieldRow}>
                      <div style={styles.fieldGroup}>
                        <label style={styles.label}>Product / Service Name</label>
                        <input style={styles.input} value={editForm.templateVars?.productName ?? ''} onChange={(e) => setTplVar('productName', e.target.value)} placeholder="e.g. Acme Analytics Platform" />
                      </div>
                      <div style={styles.fieldGroup}>
                        <label style={styles.label}>Industry</label>
                        <input style={styles.input} value={editForm.templateVars?.industry ?? ''} onChange={(e) => setTplVar('industry', e.target.value)} placeholder="e.g. B2B SaaS, E-commerce" />
                      </div>
                    </div>
                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>Tone</label>
                      <input style={styles.input} value={editForm.templateVars?.tone ?? ''} onChange={(e) => setTplVar('tone', e.target.value)} placeholder="e.g. professional and friendly, direct and concise" />
                    </div>
                  </div>

                  {/* Persona section */}
                  <div style={styles.section}>
                    <div style={styles.sectionTitle}>Persona & Behaviour</div>
                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>System Persona</label>
                      <p style={{ margin: '0 0 6px', fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>
                        Describe your company, what you sell, who your ideal customer is, what makes you different, and how the agent should behave. The more detail, the better.
                      </p>
                      <textarea
                        style={{ ...styles.input, height: 160, resize: 'vertical', lineHeight: 1.5 }}
                        value={editForm.persona ?? ''}
                        onChange={(e) => setEditForm({ ...editForm, persona: e.target.value })}
                        placeholder={`Example:\nYou are Alex, a senior sales consultant at Acme Corp. We help B2B companies automate their reporting workflows. Our ideal customer is a data team of 5-50 people at a mid-market company spending 10+ hours per week on manual reports.\n\nOur key differentiators:\n- 5-minute setup, no code required\n- Native integration with Salesforce, HubSpot, and Snowflake\n- 99.9% uptime SLA\n\nYour goal is to understand the visitor's current reporting pain, qualify them on BANT, and book a demo.`}
                      />
                    </div>
                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>Fallback Message</label>
                      <input
                        style={styles.input}
                        value={editForm.fallbackMessage ?? ''}
                        onChange={(e) => setEditForm({ ...editForm, fallbackMessage: e.target.value })}
                        placeholder="e.g. I don't have that information — let me connect you with our team."
                      />
                    </div>
                  </div>

                  {/* Skills section */}
                  <div style={styles.section}>
                    <div style={styles.sectionTitle}>Skills</div>
                    <p style={{ margin: '0 0 12px', fontSize: 12, color: '#94a3b8' }}>Enable the capabilities this agent can use. Tip: enable all for a full sales agent.</p>
                    <div style={styles.skillsGrid}>
                      {ALL_SKILLS.map((skill) => {
                        const enabled = editForm.enabledSkills?.includes(skill.name) ?? false;
                        return (
                          <div key={skill.name} style={{ ...styles.skillToggle, borderColor: enabled ? '#0284c7' : '#e0f2fe', background: enabled ? '#eff6ff' : '#f8fafc' }}
                            onClick={() => toggleSkill(skill.name)}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ ...styles.skillDot, background: enabled ? '#0284c7' : '#cbd5e1' }} />
                              <div style={{ fontSize: 13, fontWeight: 600, color: enabled ? '#0284c7' : '#475569' }}>{skill.name}</div>
                            </div>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{skill.desc}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Save / cancel */}
                  <div style={{ display: 'flex', gap: 8, padding: '0 24px 24px' }}>
                    <button style={styles.primaryBtn} onClick={() => saveEdit(a.id)} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
                    <button style={styles.secondaryBtn} onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  heading: { margin: '0 0 4px', color: '#0f172a', fontSize: 22 },
  subheading: { margin: 0, color: '#64748b', fontSize: 13 },
  card: { background: '#ffffff', borderRadius: 12, border: '1px solid #e0f2fe', overflow: 'hidden', boxShadow: '0 1px 6px rgba(2,132,199,0.06)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #f0f9ff' },
  agentAvatar: { width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #0284c7, #0369a1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 18, flexShrink: 0 },
  agentName: { fontWeight: 700, color: '#0f172a', fontSize: 15 },
  pill: { padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 },
  editBtn: { padding: '6px 14px', borderRadius: 8, border: '1px solid #e0f2fe', background: '#f8fafc', color: '#475569', cursor: 'pointer', fontSize: 13, fontWeight: 500 },
  deployBtn: { padding: '6px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #0284c7, #0369a1)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  personaPreview: { fontSize: 13, color: '#64748b', margin: '0 0 10px', lineHeight: 1.5 },
  skillTag: { fontSize: 11, padding: '2px 8px', borderRadius: 12, background: '#eff6ff', color: '#0284c7', fontWeight: 500 },
  editPanel: { borderTop: '1px solid #e0f2fe' },
  section: { padding: '20px 24px', borderBottom: '1px solid #f0f9ff' },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: '#0284c7', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 14 },
  fieldRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { padding: '10px 14px', borderRadius: 8, border: '1px solid #bae6fd', background: '#f8fafc', color: '#0f172a', fontSize: 14, fontFamily: 'inherit', outline: 'none' },
  skillsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 },
  skillToggle: { padding: '10px 12px', borderRadius: 8, border: '1px solid', cursor: 'pointer', transition: 'all 0.15s' },
  skillDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  formCard: { background: '#ffffff', borderRadius: 10, padding: 24, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480, border: '1px solid #e0f2fe' },
  primaryBtn: { padding: '9px 18px', borderRadius: 8, border: 'none', background: '#0284c7', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  secondaryBtn: { padding: '9px 18px', borderRadius: 8, border: '1px solid #bae6fd', background: 'transparent', color: '#475569', cursor: 'pointer', fontSize: 14 },
};
