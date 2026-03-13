import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Lead {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  status: string;
  score: number | null;
  createdAt: string;
  qualificationData?: {
    budget?: string;
    hasBudget?: boolean;
    authority?: string;
    isDecisionMaker?: boolean;
    need?: string;
    needStrength?: string;
    timeline?: string;
    hasTimeline?: boolean;
    notes?: string;
  };
}

const STATUS_COLORS: Record<string, string> = {
  new: '#6366f1', contacted: '#f59e0b', qualified: '#10b981',
  demo_scheduled: '#06b6d4', converted: '#22c55e', lost: '#ef4444',
};

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const limit = 20;

  useEffect(() => {
    setLoading(true);
    const params: any = { page, limit };
    if (statusFilter) params.status = statusFilter;
    api.get('/leads', { params })
      .then((r) => { setLeads(r.data.items ?? r.data); setTotal(r.data.total ?? 0); })
      .finally(() => setLoading(false));
  }, [page, statusFilter]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div style={styles.topbar}>
        <div>
          <h2 style={styles.heading}>Leads</h2>
          <p style={styles.subheading}>{total} total leads captured by your agent</p>
        </div>
        <select style={styles.select} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      {loading ? <p style={{ color: '#94a3b8' }}>Loading…</p> : leads.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>👤</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>No leads yet</div>
          <div style={{ fontSize: 14, color: '#64748b' }}>Your AI agent will capture lead information automatically during conversations.</div>
        </div>
      ) : (
        <div style={styles.list}>
          {leads.map((lead) => {
            const name = lead.firstName
              ? `${lead.firstName} ${lead.lastName ?? ''}`.trim()
              : lead.email ?? 'Anonymous';
            const isOpen = expanded === lead.id;
            const bant = lead.qualificationData;
            const bantFilled = [bant?.budget, bant?.need, bant?.authority, bant?.timeline].filter(Boolean).length;

            return (
              <div key={lead.id} style={{ ...styles.card, borderColor: isOpen ? '#0284c7' : '#e0f2fe' }}>
                <div style={styles.cardMain} onClick={() => setExpanded(isOpen ? null : lead.id)}>
                  {/* Avatar + name */}
                  <div style={styles.leadInfo}>
                    <div style={{ ...styles.avatar, background: lead.score && lead.score >= 70 ? 'linear-gradient(135deg, #10b981, #06b6d4)' : 'linear-gradient(135deg, #0284c7, #0369a1)' }}>
                      {name[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={styles.leadName}>{name}</div>
                      <div style={styles.leadMeta}>
                        {lead.jobTitle && <span>{lead.jobTitle}</span>}
                        {lead.jobTitle && lead.company && <span> at </span>}
                        {lead.company && <span style={{ color: '#94a3b8' }}>{lead.company}</span>}
                        {!lead.jobTitle && !lead.company && <span style={{ color: '#475569' }}>No company info yet</span>}
                      </div>
                    </div>
                  </div>

                  {/* Contact */}
                  <div style={styles.contactCol}>
                    {lead.email && <div style={styles.contactItem}>✉ {lead.email}</div>}
                    {lead.phone && <div style={styles.contactItem}>📞 {lead.phone}</div>}
                    {!lead.email && !lead.phone && <div style={{ color: '#475569', fontSize: 12 }}>No contact info</div>}
                  </div>

                  {/* BANT progress */}
                  <div style={styles.bantCol}>
                    <div style={styles.bantLabel}>BANT {bantFilled}/4</div>
                    <div style={styles.bantBar}>
                      {['B', 'A', 'N', 'T'].map((letter, i) => {
                        const filled = i === 0 ? !!bant?.budget || bant?.hasBudget
                          : i === 1 ? !!bant?.authority || bant?.isDecisionMaker
                          : i === 2 ? !!bant?.need
                          : !!bant?.timeline || bant?.hasTimeline;
                        return (
                          <div key={letter} title={['Budget', 'Authority', 'Need', 'Timeline'][i]}
                            style={{ ...styles.bantSegment, background: filled ? '#0284c7' : '#bae6fd', color: filled ? '#fff' : '#64748b' }}>
                            {letter}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Score */}
                  <div style={styles.scoreCol}>
                    {lead.score != null ? (
                      <div style={{ ...styles.scoreBig, color: lead.score >= 70 ? '#059669' : lead.score >= 40 ? '#d97706' : '#94a3b8' }}>
                        {lead.score}
                      </div>
                    ) : <div style={{ color: '#94a3b8', fontSize: 20, fontWeight: 700 }}>—</div>}
                    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>score</div>
                  </div>

                  {/* Status + time */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ ...styles.pill, background: `${STATUS_COLORS[lead.status] ?? '#64748b'}22`, color: STATUS_COLORS[lead.status] ?? '#64748b' }}>
                      {lead.status.replace(/_/g, ' ')}
                    </span>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{timeAgo(lead.createdAt)}</div>
                  </div>

                  <div style={{ color: '#64748b', fontSize: 11, marginLeft: 4 }}>{isOpen ? '▲' : '▼'}</div>
                </div>

                {/* Expanded BANT details */}
                {isOpen && bant && (
                  <div style={styles.bantPanel}>
                    <div style={styles.bantPanelTitle}>Lead Intelligence (captured by AI agent)</div>
                    <div style={styles.bantGrid}>
                      <BantField label="Budget" value={bant.budget} flag={bant.hasBudget ? 'Has budget confirmed' : undefined} />
                      <BantField label="Authority" value={bant.authority} flag={bant.isDecisionMaker ? 'Decision maker' : 'Not decision maker'} />
                      <BantField label="Need / Pain" value={bant.need} flag={bant.needStrength ? `Strength: ${bant.needStrength}` : undefined} />
                      <BantField label="Timeline" value={bant.timeline} flag={bant.hasTimeline ? 'Has clear timeline' : undefined} />
                    </div>
                    {bant.notes && (
                      <div style={styles.bantNotes}>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase' }}>Agent Notes</div>
                        <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>{bant.notes}</div>
                      </div>
                    )}
                  </div>
                )}
                {isOpen && !bant && (
                  <div style={{ ...styles.bantPanel, color: '#64748b', fontSize: 13 }}>
                    No qualification data captured yet. The agent will fill this in during conversation.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button style={styles.pageBtn} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>Page {page} of {totalPages}</span>
          <button style={styles.pageBtn} disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}

function BantField({ label, value, flag }: { label: string; value?: string; flag?: string }) {
  return (
    <div style={{ background: '#ffffff', borderRadius: 8, padding: '10px 14px', border: '1px solid #e0f2fe' }}>
      <div style={{ fontSize: 10, color: '#0284c7', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? '#0f172a' : '#94a3b8' }}>{value ?? 'Not captured yet'}</div>
      {flag && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>→ {flag}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  heading: { margin: '0 0 4px', color: '#0f172a', fontSize: 22 },
  subheading: { margin: 0, color: '#64748b', fontSize: 13 },
  select: { padding: '8px 12px', borderRadius: 8, border: '1px solid #e0f2fe', background: '#f8fafc', color: '#475569', fontSize: 13, cursor: 'pointer' },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  card: { background: '#ffffff', borderRadius: 10, overflow: 'hidden', border: '1px solid #e0f2fe', transition: 'border-color 0.15s', boxShadow: '0 1px 4px rgba(2,132,199,0.06)' },
  cardMain: { display: 'flex', alignItems: 'center', gap: 20, padding: '16px 20px', cursor: 'pointer' },
  leadInfo: { display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200 },
  avatar: { width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0 },
  leadName: { fontSize: 15, fontWeight: 600, color: '#0f172a' },
  leadMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  contactCol: { minWidth: 200 },
  contactItem: { fontSize: 12, color: '#64748b', marginBottom: 2 },
  bantCol: { minWidth: 100 },
  bantLabel: { fontSize: 11, color: '#94a3b8', marginBottom: 4 },
  bantBar: { display: 'flex', gap: 3 },
  bantSegment: { width: 22, height: 22, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff' },
  scoreCol: { textAlign: 'center', minWidth: 60 },
  scoreBig: { fontSize: 26, fontWeight: 700, lineHeight: 1 },
  pill: { padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 },
  bantPanel: { borderTop: '1px solid #e0f2fe', padding: '16px 20px', background: '#f0f9ff' },
  bantPanelTitle: { fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  bantGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 },
  bantNotes: { marginTop: 12, background: '#ffffff', borderRadius: 8, padding: '10px 14px', border: '1px solid #e0f2fe' },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', textAlign: 'center' },
  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 24 },
  pageBtn: { padding: '8px 20px', borderRadius: 8, border: '1px solid #e0f2fe', background: '#f8fafc', color: '#64748b', cursor: 'pointer', fontSize: 13 },
};
