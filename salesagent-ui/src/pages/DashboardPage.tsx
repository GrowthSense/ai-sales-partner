import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

interface Agent {
  id: string;
  name: string;
  status: string;
}

interface Summary {
  conversations: { total: number; active: number; ended: number; abandoned: number; avgDurationMinutes: number | null };
  leads: { total: number; avgScore: number | null; conversionRate: number; withEmail: number };
  messages: { total: number; avgPerConversation: number; totalTokens: number };
  knowledge: { totalDocuments: number; readyDocuments: number; failedDocuments: number; totalChunks: number };
  topStages?: { stage: string; count: number }[];
}

interface RecentLead {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string | null;
  score: number | null;
  status: string;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

const LEAD_STATUS_COLOR: Record<string, string> = {
  new: '#6366f1', contacted: '#3b82f6', qualified: '#10b981',
  demo_scheduled: '#06b6d4', converted: '#10b981', lost: '#ef4444',
};

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recentLeads, setRecentLeads] = useState<RecentLead[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 30);

    Promise.all([
      api.get('/analytics/summary', { params: { from: from.toISOString(), to: to.toISOString() } }),
      api.get('/leads', { params: { limit: 5, page: 1 } }),
      api.get('/agents'),
    ]).then(([summaryRes, leadsRes, agentsRes]) => {
      setSummary(summaryRes.data);
      setRecentLeads(leadsRes.data.items ?? leadsRes.data);
      setAgents(agentsRes.data.items ?? agentsRes.data ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: '#94a3b8' }}>Loading…</p>;

  const activeConvs = summary?.conversations.active ?? 0;
  const activeAgent = agents.find((a) => a.status === 'active') ?? agents[0];
  const widgetKey = (activeAgent as any)?.widgetKey ?? 'YOUR_WIDGET_KEY';
  const embedSnippet = `<script>
  window.SalesAgentConfig = { widgetKey: "${widgetKey}" };
</script>
<script src="https://cdn.yourdomain.com/widget.js" async></script>`;

  const copyEmbed = () => {
    navigator.clipboard.writeText(embedSnippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div>
      {/* Hero header */}
      <div style={styles.hero}>
        <div>
          <h2 style={styles.heading}>Overview</h2>
          <p style={styles.subheading}>Last 30 days · your AI sales agent performance</p>
        </div>
        {activeConvs > 0 && (
          <div style={styles.liveBadge} onClick={() => navigate('/conversations')}>
            <span style={styles.liveDot} />
            {activeConvs} live conversation{activeConvs > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div style={styles.grid}>
        <StatCard icon="💬" title="Conversations" value={summary?.conversations.total ?? 0}
          sub={`${summary?.conversations.active ?? 0} active · ${summary?.conversations.ended ?? 0} ended`}
          color="#6366f1" onClick={() => navigate('/conversations')} />
        <StatCard icon="👤" title="Leads Captured" value={summary?.leads.total ?? 0}
          sub={`${summary?.leads.withEmail ?? 0} with email · ${summary?.leads.conversionRate ?? 0}% converted`}
          color="#10b981" onClick={() => navigate('/leads')} />
        <StatCard icon="💬" title="Messages" value={summary?.messages.total ?? 0}
          sub={`~${summary?.messages.avgPerConversation ?? 0} per conversation`}
          color="#f59e0b" />
        <StatCard icon="🎯" title="Avg Lead Score" value={summary?.leads.avgScore ?? 0}
          sub="BANT qualification score 0–100"
          color="#ec4899" onClick={() => navigate('/leads')} />
        <StatCard icon="📚" title="Knowledge Docs" value={summary?.knowledge.totalDocuments ?? 0}
          sub={`${summary?.knowledge.readyDocuments ?? 0} ready · ${summary?.knowledge.totalChunks ?? 0} chunks`}
          color="#3b82f6" onClick={() => navigate('/knowledge')} />
        <StatCard icon="⏱" title="Avg Duration" value={Math.round(summary?.conversations.avgDurationMinutes ?? 0)}
          sub="minutes per conversation"
          color="#8b5cf6" />
      </div>

      <div style={styles.twoCol}>
        {/* Recent leads */}
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>Recent Leads</span>
            <button style={styles.panelLink} onClick={() => navigate('/leads')}>View all →</button>
          </div>
          {recentLeads.length === 0 ? (
            <div style={styles.panelEmpty}>No leads yet. Start a conversation to capture leads.</div>
          ) : (
            recentLeads.map((lead) => {
              const name = lead.firstName
                ? `${lead.firstName} ${lead.lastName ?? ''}`.trim()
                : lead.email ?? 'Anonymous';
              return (
                <div key={lead.id} style={styles.leadRow}>
                  <div style={styles.leadAvatar}>{name[0].toUpperCase()}</div>
                  <div style={{ flex: 1 }}>
                    <div style={styles.leadName}>{name}</div>
                    <div style={styles.leadMeta}>
                      {lead.company && <span>{lead.company} · </span>}
                      {timeAgo(lead.createdAt)}
                    </div>
                  </div>
                  {lead.score != null && (
                    <div style={{ ...styles.scoreChip, color: lead.score >= 70 ? '#10b981' : lead.score >= 40 ? '#f59e0b' : '#64748b', background: lead.score >= 70 ? '#10b98115' : lead.score >= 40 ? '#f59e0b15' : '#64748b15' }}>
                      {lead.score}
                    </div>
                  )}
                  <span style={{ ...styles.statusPill, background: `${LEAD_STATUS_COLOR[lead.status] ?? '#64748b'}20`, color: LEAD_STATUS_COLOR[lead.status] ?? '#64748b' }}>
                    {lead.status}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Quick actions + funnel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={styles.panel}>
            <div style={styles.panelTitle}>Quick Actions</div>
            <div style={styles.actions}>
              <ActionBtn icon="🎯" label="Try Live Demo" onClick={() => navigate('/demo')} primary />
              <ActionBtn icon="🤖" label="Manage Agents" onClick={() => navigate('/agents')} />
              <ActionBtn icon="📚" label="Add Knowledge" onClick={() => navigate('/knowledge')} />
              <ActionBtn icon="📈" label="Full Analytics" onClick={() => navigate('/analytics')} />
            </div>
          </div>

          {summary?.topStages && summary.topStages.length > 0 && (
            <div style={styles.panel}>
              <div style={styles.panelTitle}>Conversation Funnel</div>
              {summary.topStages.slice(0, 5).map((s) => (
                <div key={s.stage} style={styles.funnelRow}>
                  <div style={{ ...styles.funnelLabel }}>{s.stage.replace(/_/g, ' ')}</div>
                  <div style={styles.funnelBar}>
                    <div style={{ ...styles.funnelFill, width: `${Math.min(100, (s.count / summary.topStages![0].count) * 100)}%` }} />
                  </div>
                  <div style={styles.funnelCount}>{s.count}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Client Section ─────────────────────────────────────────────────── */}
      <div style={styles.clientSection}>
        <h3 style={styles.clientHeading}>For Your Clients</h3>
        <p style={styles.clientSub}>Share your AI sales agent with clients — embed it on any website in seconds.</p>
        <div style={styles.clientGrid}>

          {/* Embed code panel */}
          <div style={styles.embedPanel}>
            <div style={styles.embedPanelHeader}>
              <div>
                <div style={styles.embedPanelTitle}>Widget Embed Code</div>
                <div style={styles.embedPanelDesc}>Paste this snippet into your client's website before the closing &lt;/body&gt; tag.</div>
              </div>
              <button style={{ ...styles.copyBtn, ...(copied ? styles.copyBtnDone : {}) }} onClick={copyEmbed}>
                {copied ? '✓ Copied!' : 'Copy Code'}
              </button>
            </div>
            <pre style={styles.codeBlock}>{embedSnippet}</pre>
            <div style={styles.embedTips}>
              <span style={styles.tipChip}>✓ No frameworks needed</span>
              <span style={styles.tipChip}>✓ Loads asynchronously</span>
              <span style={styles.tipChip}>✓ Works on any website</span>
            </div>
          </div>

          {/* Agent status + share links */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Active agents */}
            <div style={styles.panel}>
              <div style={styles.panelTitle}>Active Agents</div>
              {agents.length === 0 ? (
                <div style={styles.panelEmpty}>No agents yet. <button style={styles.inlineLink} onClick={() => navigate('/agents')}>Create one →</button></div>
              ) : (
                agents.slice(0, 4).map((a) => (
                  <div key={a.id} style={styles.agentRow}>
                    <div style={{ ...styles.agentDot, background: a.status === 'active' ? '#10b981' : '#94a3b8' }} />
                    <div style={{ flex: 1, fontSize: 14, color: '#0f172a', fontWeight: 500 }}>{a.name}</div>
                    <span style={{ ...styles.agentBadge, background: a.status === 'active' ? '#d1fae5' : '#f1f5f9', color: a.status === 'active' ? '#059669' : '#64748b' }}>
                      {a.status}
                    </span>
                  </div>
                ))
              )}
              <button style={styles.manageBtn} onClick={() => navigate('/agents')}>Manage Agents →</button>
            </div>

            {/* Share options */}
            <div style={styles.panel}>
              <div style={styles.panelTitle}>Share Options</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ShareOption icon="🌐" title="Website Embed" desc="Add widget to any HTML site" action="Get Code" onClick={copyEmbed} />
                <ShareOption icon="🔗" title="Direct Chat Link" desc="Send a standalone chat URL to clients" action="Copy Link" onClick={() => {}} />
                <ShareOption icon="🎯" title="Live Preview" desc="Test before sending to clients" action="Open Demo" onClick={() => navigate('/demo')} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, title, value, sub, color, onClick }: { icon: string; title: string; value: number; sub: string; color: string; onClick?: () => void }) {
  return (
    <div style={{ ...styles.card, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div style={styles.cardTop}>
        <div style={styles.cardTitle}>{title}</div>
        <div style={{ ...styles.cardIcon, background: `${color}20` }}>{icon}</div>
      </div>
      <div style={{ ...styles.cardValue, color }}>{Number(value || 0).toLocaleString()}</div>
      <div style={styles.cardSub}>{sub}</div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick, primary }: { icon: string; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button style={{ ...styles.actionBtn, ...(primary ? styles.actionBtnPrimary : {}) }} onClick={onClick}>
      <span>{icon}</span> {label}
    </button>
  );
}

function ShareOption({ icon, title, desc, action, onClick }: { icon: string; title: string; desc: string; action: string; onClick: () => void }) {
  return (
    <div style={styles.shareOption}>
      <div style={styles.shareIcon}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{title}</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>{desc}</div>
      </div>
      <button style={styles.shareBtn} onClick={onClick}>{action}</button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  hero: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 },
  heading: { margin: '0 0 4px', color: '#0f172a', fontSize: 24, fontWeight: 700 },
  subheading: { margin: 0, color: '#64748b', fontSize: 14 },
  liveBadge: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 20, color: '#059669', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  liveDot: { width: 8, height: 8, borderRadius: '50%', background: '#10b981', animation: 'pulse 2s infinite' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 28 },
  card: { background: '#ffffff', borderRadius: 12, padding: '20px 24px', border: '1px solid #e0f2fe', transition: 'border-color 0.15s, transform 0.15s', boxShadow: '0 1px 6px rgba(2,132,199,0.06)' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardIcon: { width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 },
  cardTitle: { fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 },
  cardValue: { fontSize: 34, fontWeight: 700, lineHeight: 1, marginBottom: 6 },
  cardSub: { fontSize: 12, color: '#94a3b8' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 },
  panel: { background: '#ffffff', borderRadius: 12, padding: '20px 24px', border: '1px solid #e0f2fe', boxShadow: '0 1px 6px rgba(2,132,199,0.06)' },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  panelTitle: { fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 16 },
  panelLink: { fontSize: 13, color: '#0284c7', background: 'transparent', border: 'none', cursor: 'pointer' },
  panelEmpty: { color: '#94a3b8', fontSize: 13, padding: '16px 0' },
  leadRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f0f9ff' },
  leadAvatar: { width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #0284c7, #0369a1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0 },
  leadName: { fontSize: 14, fontWeight: 600, color: '#0f172a' },
  leadMeta: { fontSize: 12, color: '#94a3b8', marginTop: 1 },
  scoreChip: { padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 700, flexShrink: 0 },
  statusPill: { padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, flexShrink: 0 },
  actions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  actionBtn: { padding: '10px 12px', borderRadius: 8, border: '1px solid #e0f2fe', background: '#f8fafc', color: '#475569', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 },
  actionBtnPrimary: { background: 'linear-gradient(135deg, #0284c7, #0369a1)', border: 'none', color: '#fff', fontWeight: 600 },
  funnelRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  funnelLabel: { width: 130, fontSize: 12, color: '#64748b', textTransform: 'capitalize' },
  funnelBar: { flex: 1, height: 6, background: '#e0f2fe', borderRadius: 3, overflow: 'hidden' },
  funnelFill: { height: '100%', background: 'linear-gradient(90deg, #0284c7, #38bdf8)', borderRadius: 3 },
  funnelCount: { width: 30, textAlign: 'right', fontSize: 12, color: '#94a3b8' },
  // Client section
  clientSection: { marginTop: 28 },
  clientHeading: { margin: '0 0 4px', color: '#0f172a', fontSize: 18, fontWeight: 700 },
  clientSub: { margin: '0 0 20px', color: '#64748b', fontSize: 14 },
  clientGrid: { display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 },
  embedPanel: { background: '#ffffff', borderRadius: 12, padding: '20px 24px', border: '1px solid #e0f2fe', boxShadow: '0 1px 6px rgba(2,132,199,0.06)' },
  embedPanelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  embedPanelTitle: { fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 4 },
  embedPanelDesc: { fontSize: 12, color: '#64748b', maxWidth: 340 },
  codeBlock: { background: '#0f172a', color: '#7dd3fc', borderRadius: 8, padding: '14px 16px', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.7, overflow: 'auto', margin: '0 0 12px', border: '1px solid #1e3a4a' },
  copyBtn: { padding: '8px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #0284c7, #0369a1)', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0 },
  copyBtnDone: { background: 'linear-gradient(135deg, #10b981, #059669)' },
  embedTips: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  tipChip: { padding: '4px 10px', borderRadius: 20, background: '#f0fdf4', color: '#059669', fontSize: 11, fontWeight: 600, border: '1px solid #bbf7d0' },
  agentRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f0f9ff' },
  agentDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  agentBadge: { padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 },
  manageBtn: { marginTop: 12, fontSize: 13, color: '#0284c7', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 },
  inlineLink: { fontSize: 13, color: '#0284c7', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 },
  shareOption: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f0f9ff' },
  shareIcon: { width: 32, height: 32, borderRadius: 8, background: '#f0f9ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 },
  shareBtn: { padding: '5px 12px', borderRadius: 6, border: '1px solid #bae6fd', background: 'transparent', color: '#0284c7', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' },
};
