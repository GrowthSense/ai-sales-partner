import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Conversation {
  id: string;
  currentStage: string;
  status: string;
  visitorId: string;
  messageCount: number;
  totalTokens: number;
  createdAt: string;
  endedAt: string | null;
  lastMessageAt: string | null;
  lead?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    score: number | null;
    status: string;
  } | null;
}

const STAGE_COLORS: Record<string, string> = {
  greeting: '#64748b',
  discovery: '#6366f1',
  qualification: '#8b5cf6',
  recommendation: '#3b82f6',
  objection_handling: '#f59e0b',
  conversion: '#10b981',
  scheduling: '#06b6d4',
  follow_up: '#ec4899',
};

const STATUS_COLORS: Record<string, string> = {
  active: '#10b981',
  ended: '#6366f1',
  abandoned: '#f59e0b',
  paused: '#64748b',
};

function duration(start: string, end: string | null): string {
  if (!end) return '—';
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (mins < 1) return '<1 min';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const limit = 15;

  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    const params: any = { page, limit };
    if (statusFilter) params.status = statusFilter;
    if (stageFilter) params.stage = stageFilter;
    api.get('/conversations', { params })
      .then((r) => { setConversations(r.data.items ?? r.data); setTotal(r.data.total ?? 0); })
      .catch((e) => setError(e.response?.data?.message ?? 'Failed to load conversations'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page, statusFilter, stageFilter]);

  const expandConversation = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    setMessagesLoading(true);
    try {
      const r = await api.get(`/conversations/${id}/messages`);
      setMessages(r.data.items ?? r.data);
    } finally {
      setMessagesLoading(false);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div style={styles.topbar}>
        <div>
          <h2 style={styles.heading}>Conversations</h2>
          <p style={styles.subheading}>{total} total conversations</p>
        </div>
        <div style={styles.filters}>
          <select style={styles.select} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="ended">Ended</option>
            <option value="abandoned">Abandoned</option>
          </select>
          <select style={styles.select} value={stageFilter} onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}>
            <option value="">All Stages</option>
            {Object.keys(STAGE_COLORS).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={styles.empty}>Loading…</div>
      ) : error ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>⚠️</div>
          <div style={styles.emptyTitle}>Could not load conversations</div>
          <div style={styles.emptySub}>{error}</div>
          <button onClick={load} style={{ marginTop: 12, padding: '8px 20px', borderRadius: 8, border: '1px solid #e0f2fe', background: '#f8fafc', color: '#0284c7', cursor: 'pointer', fontSize: 13 }}>Retry</button>
        </div>
      ) : conversations.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>💬</div>
          <div style={styles.emptyTitle}>No conversations yet</div>
          <div style={styles.emptySub}>Conversations will appear here when visitors interact with your agent widget.</div>
        </div>
      ) : (
        <>
          {/* Column headers */}
          <div style={styles.colHeader}>
            <div style={{ flex: 1, minWidth: 200 }}>Visitor / Lead</div>
            <div style={{ minWidth: 120 }}>Stage</div>
            <div style={{ minWidth: 90 }}>Status</div>
            <div style={{ minWidth: 80, textAlign: 'center' }}>Messages</div>
            <div style={{ minWidth: 80, textAlign: 'center' }}>Score</div>
            <div style={{ minWidth: 100, textAlign: 'right' }}>Duration / When</div>
          </div>

          <div style={styles.list}>
            {conversations.map((c) => {
              const name = c.lead?.firstName
                ? `${c.lead.firstName} ${c.lead.lastName ?? ''}`.trim()
                : c.lead?.email ?? null;
              const isOpen = expanded === c.id;
              return (
                <div key={c.id} style={{ ...styles.card, borderColor: isOpen ? '#0284c7' : '#e0f2fe' }}>
                  <div style={styles.cardMain} onClick={() => expandConversation(c.id)}>
                    <div style={styles.visitorCol}>
                      <div style={{ ...styles.visitorAvatar, background: name ? 'linear-gradient(135deg, #0284c7, #0369a1)' : '#cbd5e1' }}>
                        {name ? name[0].toUpperCase() : '?'}
                      </div>
                      <div>
                        <div style={styles.visitorName}>{name ?? 'Anonymous visitor'}</div>
                        {c.lead?.email && <div style={styles.visitorEmail}>{c.lead.email}</div>}
                        <div style={styles.visitorId}>ID: {c.visitorId.slice(0, 8)}…</div>
                      </div>
                    </div>

                    <div style={{ minWidth: 120 }}>
                      <span style={{ ...styles.stagePill, background: `${STAGE_COLORS[c.currentStage] ?? '#64748b'}22`, color: STAGE_COLORS[c.currentStage] ?? '#64748b' }}>
                        {c.currentStage.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div style={{ minWidth: 90 }}>
                      <span style={{ ...styles.pill, background: `${STATUS_COLORS[c.status] ?? '#64748b'}22`, color: STATUS_COLORS[c.status] ?? '#64748b' }}>
                        {c.status}
                      </span>
                    </div>

                    <div style={{ minWidth: 80, textAlign: 'center' }}>
                      <div style={styles.metricVal}>{c.messageCount ?? 0}</div>
                    </div>

                    <div style={{ minWidth: 80, textAlign: 'center' }}>
                      {c.lead?.score != null ? (
                        <div style={{ ...styles.scoreChip, background: c.lead.score >= 70 ? '#10b98122' : c.lead.score >= 40 ? '#f59e0b22' : '#64748b22', color: c.lead.score >= 70 ? '#10b981' : c.lead.score >= 40 ? '#f59e0b' : '#64748b' }}>
                          {c.lead.score}
                        </div>
                      ) : <div style={{ color: '#334155', fontSize: 14 }}>—</div>}
                    </div>

                    <div style={{ minWidth: 100, textAlign: 'right' }}>
                      <div style={styles.metricVal}>{duration(c.createdAt, c.endedAt)}</div>
                      <div style={styles.metricLabel}>{timeAgo(c.lastMessageAt ?? c.createdAt)}</div>
                    </div>

                    <div style={{ color: '#64748b', fontSize: 11, marginLeft: 8, flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</div>
                  </div>

                  {isOpen && (
                    <div style={styles.messagePanel}>
                      <div style={styles.messagePanelHeader}>Conversation transcript</div>
                      {messagesLoading ? (
                        <div style={{ color: '#64748b', fontSize: 13 }}>Loading…</div>
                      ) : messages.length === 0 ? (
                        <div style={{ color: '#64748b', fontSize: 13 }}>No messages yet</div>
                      ) : (
                        messages.slice(0, 20).map((m: any) => (
                          <div key={m.id} style={{ ...styles.msgRow, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                            <div style={{ ...styles.msgAvatar, background: m.role === 'assistant' ? 'linear-gradient(135deg, #0284c7, #0369a1)' : '#cbd5e1' }}>
                              {m.role === 'assistant' ? 'A' : 'V'}
                            </div>
                            <div style={{ ...styles.msgBubble, background: m.role === 'user' ? '#e0f2fe' : '#ffffff', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3, textTransform: 'uppercase', fontWeight: 600 }}>
                                {m.role === 'assistant' ? 'Agent' : 'Visitor'}
                              </div>
                              {m.content}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button style={styles.pageBtn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
          <span style={{ color: '#64748b', fontSize: 13 }}>Page {page} of {totalPages}</span>
          <button style={styles.pageBtn} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next →</button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  heading: { margin: '0 0 4px', color: '#0f172a', fontSize: 22 },
  subheading: { margin: 0, color: '#64748b', fontSize: 13 },
  filters: { display: 'flex', gap: 8 },
  select: { padding: '8px 12px', borderRadius: 8, border: '1px solid #e0f2fe', background: '#f8fafc', color: '#475569', fontSize: 13, cursor: 'pointer' },
  colHeader: { display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px 8px', fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  card: { background: '#ffffff', borderRadius: 10, overflow: 'hidden', border: '1px solid #e0f2fe', transition: 'border-color 0.15s', boxShadow: '0 1px 4px rgba(2,132,199,0.06)' },
  cardMain: { display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', cursor: 'pointer' },
  visitorCol: { display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 200 },
  visitorAvatar: { width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 },
  visitorName: { fontWeight: 600, color: '#0f172a', fontSize: 14 },
  visitorEmail: { fontSize: 12, color: '#64748b', marginTop: 1 },
  visitorId: { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  stagePill: { padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, textTransform: 'capitalize', whiteSpace: 'nowrap' },
  pill: { padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 },
  scoreChip: { display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontWeight: 700, fontSize: 13 },
  metricVal: { fontSize: 14, fontWeight: 700, color: '#0f172a' },
  metricLabel: { fontSize: 11, color: '#94a3b8' },
  messagePanel: { borderTop: '1px solid #e0f2fe', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflowY: 'auto', background: '#f0f9ff' },
  messagePanelHeader: { fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  msgRow: { display: 'flex', gap: 8, alignItems: 'flex-start' },
  msgAvatar: { width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 11, flexShrink: 0, marginTop: 2 },
  msgBubble: { maxWidth: '75%', padding: '8px 12px', borderRadius: 10, fontSize: 13, color: '#334155', lineHeight: 1.5 },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: 600, color: '#64748b' },
  emptySub: { fontSize: 14, color: '#94a3b8', maxWidth: 400, textAlign: 'center' },
  empty: { color: '#94a3b8', padding: '40px 0', textAlign: 'center' },
  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 24 },
  pageBtn: { padding: '8px 20px', borderRadius: 8, border: '1px solid #e0f2fe', background: '#f8fafc', color: '#64748b', cursor: 'pointer', fontSize: 13 },
};
