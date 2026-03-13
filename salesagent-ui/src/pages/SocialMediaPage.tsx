import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth.store';

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = 'facebook' | 'instagram' | 'twitter' | 'linkedin';
type Sentiment = 'positive' | 'neutral' | 'negative' | 'critical';
type AlertStatus = 'open' | 'resolved';

interface SocialAccount {
  id: string;
  platform: Platform;
  handle: string;
  status: 'active' | 'inactive' | 'error';
  lastSyncedAt: string | null;
  errorMessage: string | null;
}

interface SocialAlert {
  id: string;
  commentId: string;
  sentiment: Sentiment;
  alertReason: string;
  status: AlertStatus;
  emailSent: boolean;
  createdAt: string;
  resolvedAt: string | null;
  comment: {
    platform: Platform;
    text: string;
    authorName: string;
    authorUsername: string | null;
    postUrl: string | null;
    publishedAt: string;
  };
}

interface Stats {
  totalComments: number;
  negative: number;
  critical: number;
  openAlerts: number;
  leadsGenerated: number;
}

interface RealtimeAlert {
  alertId: string;
  platform: Platform;
  authorName: string;
  text: string;
  sentiment: Sentiment;
  reason: string;
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

interface PlatformGuide {
  requirement: string;
  requirementNote?: string;
  convertUrl?: string;
  convertLabel?: string;
  steps: string[];
  docsUrl: string;
  toolUrl: string;
  toolLabel: string;
}

const PLATFORM_GUIDE: Record<Platform, PlatformGuide> = {
  facebook: {
    requirement: 'Requires a Facebook Page (not a personal profile).',
    requirementNote: 'Facebook Pages are free — create one at facebook.com/pages/create if you don\'t have one yet.',
    convertUrl: 'https://www.facebook.com/pages/create',
    convertLabel: 'Create a Facebook Page',
    steps: [
      '1. Go to developers.facebook.com and create a free developer account.',
      '2. Create an App → choose "Business" type.',
      '3. Add the "Pages API" product to your app.',
      '4. Under Tools → Graph API Explorer, select your app and page, then click "Generate Access Token".',
      '5. Extend it to a long-lived token (60 days) via the Access Token Debugger.',
    ],
    docsUrl: 'https://developers.facebook.com/docs/pages/access-tokens',
    toolUrl: 'https://developers.facebook.com/tools/explorer/',
    toolLabel: 'Graph API Explorer',
  },
  instagram: {
    requirement: 'Requires an Instagram Professional account (Business or Creator).',
    requirementNote: 'Personal Instagram accounts cannot access the API. You must switch to a Professional account first — it\'s free and takes 30 seconds.',
    convertUrl: 'https://help.instagram.com/502981923235522',
    convertLabel: 'How to switch to a Professional account',
    steps: [
      '1. In Instagram → Settings → Account → Switch to Professional Account → choose Business or Creator.',
      '2. Link your Instagram to a Facebook Page (required by Meta\'s API).',
      '3. Go to developers.facebook.com, create an App, add the "Instagram Graph API" product.',
      '4. Use Graph API Explorer to generate a Page access token — this covers Instagram too.',
      '5. Your Instagram Business Account ID appears in the API response.',
    ],
    docsUrl: 'https://developers.facebook.com/docs/instagram-api/getting-started',
    toolUrl: 'https://developers.facebook.com/tools/explorer/',
    toolLabel: 'Graph API Explorer',
  },
  twitter: {
    requirement: 'Requires a Twitter/X developer account (free Basic tier is enough).',
    requirementNote: 'Any Twitter/X account can apply for a free developer account at developer.twitter.com.',
    convertUrl: 'https://developer.twitter.com/en/portal/petition/essential/basic-info',
    convertLabel: 'Apply for a developer account',
    steps: [
      '1. Go to developer.twitter.com → apply for a developer account (free Basic tier works).',
      '2. Create a Project and App inside the Developer Portal.',
      '3. Under your App → Keys and Tokens, generate a "Bearer Token".',
      '4. Your Twitter User ID is the numeric ID in your profile URL (or look it up at tweeterid.com).',
    ],
    docsUrl: 'https://developer.twitter.com/en/docs/authentication/oauth-2-0/bearer-tokens',
    toolUrl: 'https://developer.twitter.com/en/portal/dashboard',
    toolLabel: 'Twitter Developer Portal',
  },
  linkedin: {
    requirement: 'Requires a LinkedIn Company Page and a developer app.',
    requirementNote: 'LinkedIn\'s API only works with Company Pages, not personal profiles. The Community Management API requires manual approval from LinkedIn.',
    convertUrl: 'https://www.linkedin.com/company/setup/new/',
    convertLabel: 'Create a LinkedIn Company Page',
    steps: [
      '1. Create a LinkedIn Company Page at linkedin.com/company/setup/new if you don\'t have one.',
      '2. Go to linkedin.com/developers and create an App linked to your Company Page.',
      '3. Under your App → Products, request "Community Management API" (requires LinkedIn approval).',
      '4. Use OAuth 2.0 Authorization Code flow to get a token with r_organization_social + w_organization_social scopes.',
      '5. Your Organisation URN looks like urn:li:organization:123456 — the number is in your Company Page URL.',
    ],
    docsUrl: 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/overview',
    toolUrl: 'https://www.linkedin.com/developers/apps',
    toolLabel: 'LinkedIn Developer Apps',
  },
};

const PLATFORM_META: Record<Platform, { label: string; color: string; abbr: string }> = {
  facebook:  { label: 'Facebook',  color: '#1877f2', abbr: 'FB' },
  instagram: { label: 'Instagram', color: '#e1306c', abbr: 'IG' },
  twitter:   { label: 'Twitter / X', color: '#1da1f2', abbr: 'X' },
  linkedin:  { label: 'LinkedIn',  color: '#0077b5', abbr: 'LI' },
};

const SENTIMENT_COLOR: Record<Sentiment, string> = {
  positive: '#10b981',
  neutral:  '#64748b',
  negative: '#f59e0b',
  critical: '#ef4444',
};

const SENTIMENT_BG: Record<Sentiment, string> = {
  positive: '#f0fdf4',
  neutral:  '#f8fafc',
  negative: '#fffbeb',
  critical: '#fef2f2',
};

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, delta, accent }: {
  label: string; value: string | number; delta?: string; accent: string;
}) {
  return (
    <div style={{ ...s.statCard, borderTop: `3px solid ${accent}` }}>
      <div style={{ ...s.statValue, color: accent }}>{value}</div>
      <div style={s.statLabel}>{label}</div>
      {delta && <div style={{ ...s.statDelta, color: accent + 'aa' }}>{delta}</div>}
    </div>
  );
}

function PlatformChip({ platform }: { platform: Platform }) {
  const m = PLATFORM_META[platform];
  return (
    <span style={{ ...s.chip, color: m.color, background: m.color + '12', border: `1px solid ${m.color}28` }}>
      {m.abbr} · {m.label}
    </span>
  );
}

function SentimentChip({ sentiment }: { sentiment: Sentiment }) {
  const label = sentiment.charAt(0).toUpperCase() + sentiment.slice(1);
  return (
    <span style={{
      ...s.chip,
      color: SENTIMENT_COLOR[sentiment],
      background: SENTIMENT_BG[sentiment],
      border: `1px solid ${SENTIMENT_COLOR[sentiment]}30`,
      fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SocialMediaPage() {
  const accessToken = useAuthStore((s) => s.accessToken);

  const [stats, setStats] = useState<Stats | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [alerts, setAlerts] = useState<SocialAlert[]>([]);
  const [alertFilter, setAlertFilter] = useState<AlertStatus | 'all'>('open');
  const [syncing, setSyncing] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [toast, setToast] = useState<RealtimeAlert | null>(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    platform: 'facebook' as Platform,
    externalId: '', handle: '', accessToken: '',
    pageId: '', organizationUrn: '', twitterUserId: '',
  });
  const [showGuide, setShowGuide] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const status = alertFilter === 'all' ? undefined : alertFilter;
      const [statsRes, accountsRes, alertsRes] = await Promise.all([
        api.get('/social-media/stats'),
        api.get('/social-media/accounts'),
        api.get('/social-media/alerts', { params: { status, limit: 40 } }),
      ]);
      setStats(statsRes.data);
      setAccounts(accountsRes.data);
      setAlerts(alertsRes.data.alerts ?? []);
    } finally {
      setLoading(false);
    }
  }, [alertFilter]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // ── Real-time WebSocket ────────────────────────────────────────────────────
  useEffect(() => {
    if (!accessToken) return;
    const socket: Socket = io('http://localhost:3020', {
      path: '/socket.io',
      auth: { token: accessToken },
      transports: ['websocket'],
    });
    socket.on('social.negative_comment', (data: RealtimeAlert) => {
      setToast(data);
      setTimeout(() => setToast(null), 7000);
      void fetchAll();
    });
    return () => { socket.disconnect(); };
  }, [accessToken, fetchAll]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleSync = async () => {
    setSyncing(true);
    try { await api.post('/social-media/sync'); await fetchAll(); }
    finally { setSyncing(false); }
  };

  const handleConnect = async () => {
    const platformConfig: Record<string, string> = {};
    if (form.platform === 'facebook' || form.platform === 'instagram') {
      if (form.pageId) platformConfig.pageId = form.pageId;
    } else if (form.platform === 'linkedin') {
      if (form.organizationUrn) platformConfig.organizationUrn = form.organizationUrn;
    } else if (form.platform === 'twitter') {
      if (form.twitterUserId) platformConfig.twitterUserId = form.twitterUserId;
    }
    await api.post('/social-media/accounts', {
      platform: form.platform, externalId: form.externalId,
      handle: form.handle, accessToken: form.accessToken, platformConfig,
    });
    setShowConnect(false);
    setShowGuide(false);
    setForm({ platform: 'facebook', externalId: '', handle: '', accessToken: '', pageId: '', organizationUrn: '', twitterUserId: '' });
    await fetchAll();
  };

  const handleDisconnect = async (accountId: string) => {
    if (!confirm('Disconnect this account?')) return;
    await api.delete(`/social-media/accounts/${accountId}`);
    await fetchAll();
  };

  const handleResolve = async (alertId: string) => {
    setResolving(alertId);
    try {
      await api.post(`/social-media/alerts/${alertId}/resolve`, { notes: '' });
      setAlerts((prev) => prev.map((a) =>
        a.id === alertId ? { ...a, status: 'resolved' as AlertStatus, resolvedAt: new Date().toISOString() } : a,
      ));
    } finally { setResolving(null); }
  };

  const openAlertCount = stats?.openAlerts ?? 0;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>

      {/* ── Toast notification ──────────────────────────────────────────────── */}
      {toast && (
        <div style={{ ...s.toast, borderLeft: `3px solid ${SENTIMENT_COLOR[toast.sentiment]}` }}>
          <div style={s.toastMeta}>
            <span style={{ ...s.chip, color: SENTIMENT_COLOR[toast.sentiment], background: SENTIMENT_BG[toast.sentiment], fontWeight: 700 }}>
              {toast.sentiment === 'critical' ? 'Critical' : 'Negative'}
            </span>
            <span style={{ color: '#94a3b8', fontSize: 11 }}>{PLATFORM_META[toast.platform].label}</span>
          </div>
          <div style={s.toastAuthor}>{toast.authorName}</div>
          <div style={s.toastText}>"{toast.text.slice(0, 120)}{toast.text.length > 120 ? '…' : ''}"</div>
          <button style={s.toastClose} onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>Social Monitor</h1>
          <p style={s.pageSubtitle}>Comments · sentiment · leads across all connected platforms</p>
        </div>
        <div style={s.headerActions}>
          <button style={s.btnOutline} onClick={() => setShowConnect(true)}>
            + Connect
          </button>
          <button style={{ ...s.btnPrimary, opacity: syncing ? 0.7 : 1 }} onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing…' : '↻ Sync now'}
          </button>
        </div>
      </div>

      {/* ── Stat strip ──────────────────────────────────────────────────────── */}
      <div style={s.statStrip}>
        <StatCard label="Comments fetched" value={stats?.totalComments ?? '—'} accent="#29abe2" />
        <StatCard label="Negative flagged" value={stats?.negative ?? '—'} delta="Flagged for review" accent="#f59e0b" />
        <StatCard label="Critical issues" value={stats?.critical ?? '—'} delta="Needs attention" accent="#ef4444" />
        <StatCard
          label="Open alerts"
          value={stats?.openAlerts ?? '—'}
          delta={openAlertCount > 0 ? 'Unresolved' : 'All clear'}
          accent="#6366f1"
        />
        <StatCard label="Leads generated" value={stats?.leadsGenerated ?? '—'} delta="Via AI signals" accent="#10b981" />
      </div>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <div style={s.layout}>

        {/* Left: Alerts panel ───────────────────────────────────────────────── */}
        <div style={s.panel}>
          {/* Panel header with tab filters */}
          <div style={s.panelHead}>
            <span style={s.panelTitle}>
              Alerts
              {openAlertCount > 0 && (
                <span style={s.countBadge}>{openAlertCount}</span>
              )}
            </span>
            <div style={s.tabs}>
              {(['open', 'resolved', 'all'] as const).map((tab) => (
                <button
                  key={tab}
                  style={{ ...s.tab, ...(alertFilter === tab ? s.tabActive : {}) }}
                  onClick={() => setAlertFilter(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Alert list */}
          {loading ? (
            <div style={s.empty}>
              <div style={s.emptyDot} />
              <div style={s.emptyDot} />
              <div style={s.emptyDot} />
            </div>
          ) : alerts.length === 0 ? (
            <div style={s.empty}>
              <div style={{ fontSize: 28, marginBottom: 8, color: '#10b981' }}>✓</div>
              <div style={{ color: '#64748b', fontSize: 13 }}>No {alertFilter !== 'all' ? alertFilter : ''} alerts</div>
            </div>
          ) : (
            <div style={s.alertList}>
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  style={{
                    ...s.alertItem,
                    borderLeft: `3px solid ${SENTIMENT_COLOR[alert.sentiment]}`,
                    opacity: alert.status === 'resolved' ? 0.55 : 1,
                  }}
                >
                  {/* Top row: chips + time */}
                  <div style={s.alertRow}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, alignItems: 'center' }}>
                      <PlatformChip platform={alert.comment.platform} />
                      <SentimentChip sentiment={alert.sentiment} />
                      {alert.status === 'resolved' && (
                        <span style={{ ...s.chip, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                          Resolved
                        </span>
                      )}
                    </div>
                    <span style={s.timeLabel}>{timeAgo(alert.createdAt)}</span>
                  </div>

                  {/* Author */}
                  <div style={s.alertAuthor}>
                    {alert.comment.authorName}
                    {alert.comment.authorUsername && (
                      <span style={s.username}> @{alert.comment.authorUsername}</span>
                    )}
                  </div>

                  {/* Comment text */}
                  <div style={s.alertQuote}>
                    <div style={{ ...s.quoteMark, color: SENTIMENT_COLOR[alert.sentiment] + '60' }}>"</div>
                    {alert.comment.text}
                  </div>

                  {/* AI reason */}
                  <div style={s.alertReason}>{alert.alertReason}</div>

                  {/* Actions */}
                  <div style={s.alertActions}>
                    {alert.comment.postUrl && (
                      <a href={alert.comment.postUrl} target="_blank" rel="noopener noreferrer" style={s.textLink}>
                        View post ↗
                      </a>
                    )}
                    {alert.emailSent && (
                      <span style={{ fontSize: 11, color: '#10b981' }}>Email sent</span>
                    )}
                    {alert.status === 'open' && (
                      <button
                        style={{ ...s.resolveBtn, opacity: resolving === alert.id ? 0.6 : 1 }}
                        onClick={() => handleResolve(alert.id)}
                        disabled={resolving === alert.id}
                      >
                        {resolving === alert.id ? 'Saving…' : 'Mark resolved'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right sidebar ──────────────────────────────────────────────────── */}
        <div style={s.sidebar}>

          {/* Connected accounts */}
          <div style={s.panel}>
            <div style={s.panelHead}>
              <span style={s.panelTitle}>Accounts</span>
              <button style={s.iconBtn} onClick={() => setShowConnect(true)} title="Connect account">+</button>
            </div>

            {accounts.length === 0 ? (
              <div style={{ textAlign: 'center' as const, padding: '20px 0' }}>
                <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
                  No accounts connected
                </div>
                <button style={s.btnOutline} onClick={() => setShowConnect(true)}>
                  + Connect account
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {accounts.map((acct) => {
                  const meta = PLATFORM_META[acct.platform];
                  const isActive = acct.status === 'active';
                  const isError = acct.status === 'error';
                  return (
                    <div key={acct.id} style={s.accountRow}>
                      <div style={{ ...s.platformDot, background: meta.color + '20', color: meta.color }}>
                        {meta.abbr}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={s.accountHandle}>{acct.handle}</div>
                        <div style={s.accountMeta}>
                          {isError
                            ? <span style={{ color: '#ef4444' }}>{acct.errorMessage}</span>
                            : acct.lastSyncedAt
                              ? `Synced ${timeAgo(acct.lastSyncedAt)}`
                              : 'Never synced'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          ...s.statusDot,
                          background: isActive ? '#10b981' : isError ? '#ef4444' : '#cbd5e1',
                        }} />
                        <button style={s.disconnectBtn} onClick={() => handleDisconnect(acct.id)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Platform coverage */}
          <div style={s.panel}>
            <div style={{ ...s.panelHead, marginBottom: 12 }}>
              <span style={s.panelTitle}>Coverage</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(Object.entries(PLATFORM_META) as [Platform, typeof PLATFORM_META[Platform]][]).map(([key, meta]) => {
                const connected = accounts.some((a) => a.platform === key && a.status === 'active');
                return (
                  <div key={key} style={s.coverageRow}>
                    <div style={{ ...s.platformDot, background: meta.color + '15', color: meta.color, fontSize: 10 }}>
                      {meta.abbr}
                    </div>
                    <span style={{ flex: 1, fontSize: 13, color: '#334155' }}>{meta.label}</span>
                    {connected
                      ? <span style={s.connectedLabel}>Connected</span>
                      : <button style={s.connectSmallBtn} onClick={() => { setForm((f) => ({ ...f, platform: key })); setShowConnect(true); }}>Connect</button>}
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>

      {/* ── Connect account modal ──────────────────────────────────────────────── */}
      {showConnect && (
        <div style={s.overlay} onClick={() => { setShowConnect(false); setShowGuide(false); }}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>Connect account</h2>
              <button style={s.closeBtn} onClick={() => { setShowConnect(false); setShowGuide(false); }}>✕</button>
            </div>

            {/* Platform tabs */}
            <div style={s.platformTabs}>
              {(Object.entries(PLATFORM_META) as [Platform, typeof PLATFORM_META[Platform]][]).map(([key, meta]) => (
                <button
                  key={key}
                  style={{
                    ...s.platformTab,
                    ...(form.platform === key ? {
                      background: meta.color,
                      color: '#fff',
                      border: `1px solid ${meta.color}`,
                    } : {}),
                  }}
                  onClick={() => { setForm((f) => ({ ...f, platform: key })); setShowGuide(false); }}
                >
                  {meta.abbr}
                </button>
              ))}
            </div>
            {/* Requirement notice — always visible */}
            {(() => {
              const guide = PLATFORM_GUIDE[form.platform];
              return (
                <div style={s.requirementBox}>
                  <div style={s.requirementIcon}>ℹ</div>
                  <div style={{ flex: 1 }}>
                    <div style={s.requirementText}>{guide.requirement}</div>
                    {guide.requirementNote && (
                      <div style={s.requirementNote}>{guide.requirementNote}</div>
                    )}
                    {guide.convertUrl && (
                      <a href={guide.convertUrl} target="_blank" rel="noopener noreferrer" style={s.requirementLink}>
                        ↗ {guide.convertLabel}
                      </a>
                    )}
                  </div>
                </div>
              );
            })()}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                Connecting to <strong>{PLATFORM_META[form.platform].label}</strong>
              </span>
              <button
                style={s.guideToggle}
                onClick={() => setShowGuide((v) => !v)}
              >
                {showGuide ? '▲ Hide guide' : '? How to get a token'}
              </button>
            </div>

            {showGuide && (() => {
              const guide = PLATFORM_GUIDE[form.platform];
              return (
                <div style={s.guideBox}>
                  <div style={s.guideTitle}>How to get your {PLATFORM_META[form.platform].label} access token</div>
                  {guide.steps.map((step, i) => (
                    <div key={i} style={s.guideStep}>{step}</div>
                  ))}
                  <div style={s.guideLinks}>
                    <a href={guide.toolUrl} target="_blank" rel="noopener noreferrer" style={s.guideLink}>
                      ↗ {guide.toolLabel}
                    </a>
                    <a href={guide.docsUrl} target="_blank" rel="noopener noreferrer" style={s.guideLink}>
                      ↗ Official docs
                    </a>
                  </div>
                </div>
              );
            })()}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={s.field}>
                <label style={s.fieldLabel}>Handle / page name</label>
                <input style={s.input} placeholder="e.g. MyBrand or @mybrand" value={form.handle}
                  onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))} />
              </div>
              <div style={s.field}>
                <label style={s.fieldLabel}>Page / user ID</label>
                <input style={s.input} placeholder="Platform-assigned numeric ID" value={form.externalId}
                  onChange={(e) => setForm((f) => ({ ...f, externalId: e.target.value }))} />
              </div>
              <div style={s.field}>
                <label style={s.fieldLabel}>Access token</label>
                <input style={s.input} type="password" placeholder="OAuth access token" value={form.accessToken}
                  onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))} />
              </div>

              {(form.platform === 'facebook' || form.platform === 'instagram') && (
                <div style={s.field}>
                  <label style={s.fieldLabel}>Page ID</label>
                  <input style={s.input} placeholder="Facebook / Instagram page ID" value={form.pageId}
                    onChange={(e) => setForm((f) => ({ ...f, pageId: e.target.value }))} />
                </div>
              )}
              {form.platform === 'linkedin' && (
                <div style={s.field}>
                  <label style={s.fieldLabel}>Organisation URN</label>
                  <input style={s.input} placeholder="urn:li:organization:123456" value={form.organizationUrn}
                    onChange={(e) => setForm((f) => ({ ...f, organizationUrn: e.target.value }))} />
                </div>
              )}
              {form.platform === 'twitter' && (
                <div style={s.field}>
                  <label style={s.fieldLabel}>Twitter user ID</label>
                  <input style={s.input} placeholder="Numeric Twitter user ID" value={form.twitterUserId}
                    onChange={(e) => setForm((f) => ({ ...f, twitterUserId: e.target.value }))} />
                </div>
              )}
            </div>

            <div style={s.modalFooter}>
              <button style={s.btnOutline} onClick={() => { setShowConnect(false); setShowGuide(false); }}>Cancel</button>
              <button
                style={{ ...s.btnPrimary, opacity: (!form.handle || !form.externalId || !form.accessToken) ? 0.5 : 1 }}
                onClick={handleConnect}
                disabled={!form.handle || !form.externalId || !form.accessToken}
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex', flexDirection: 'column', gap: 24,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },

  // Header
  pageHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 },
  pageTitle: { margin: 0, fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: -0.4 },
  pageSubtitle: { margin: '4px 0 0', fontSize: 13, color: '#94a3b8' },
  headerActions: { display: 'flex', gap: 8, alignItems: 'center' },

  // Buttons
  btnPrimary: {
    padding: '8px 16px', borderRadius: 7, border: 'none',
    background: '#29abe2', color: '#fff',
    fontWeight: 600, fontSize: 13, cursor: 'pointer',
    letterSpacing: -0.2,
  },
  btnOutline: {
    padding: '8px 16px', borderRadius: 7,
    border: '1px solid #e2e8f0', background: '#fff',
    color: '#475569', fontWeight: 500, fontSize: 13, cursor: 'pointer',
  },
  resolveBtn: {
    padding: '5px 10px', borderRadius: 6,
    border: '1px solid #e2e8f0', background: '#fff',
    color: '#29abe2', fontWeight: 600, fontSize: 11, cursor: 'pointer',
    marginLeft: 'auto',
  },
  disconnectBtn: {
    padding: '4px 9px', borderRadius: 5,
    border: '1px solid #fee2e2', background: '#fff',
    color: '#ef4444', fontWeight: 500, fontSize: 11, cursor: 'pointer',
  },
  iconBtn: {
    width: 26, height: 26, borderRadius: 6,
    border: '1px solid #e2e8f0', background: '#fff',
    color: '#475569', fontWeight: 600, fontSize: 16,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  textLink: { fontSize: 11, color: '#29abe2', textDecoration: 'none', fontWeight: 500 },
  connectSmallBtn: {
    padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer',
    border: '1px solid #b8dff5', background: '#f0f8fe', color: '#29abe2',
  },

  // Stat strip
  statStrip: {
    display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12,
  },
  statCard: {
    background: '#fff', borderRadius: 10,
    border: '1px solid #f1f5f9',
    padding: '16px 18px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  statValue: { fontSize: 28, fontWeight: 800, letterSpacing: -1, lineHeight: 1 },
  statLabel: { fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 6 },
  statDelta: { fontSize: 11, marginTop: 3 },

  // Layout
  layout: { display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, alignItems: 'start' },

  // Panel
  panel: {
    background: '#fff', borderRadius: 10,
    border: '1px solid #f1f5f9',
    padding: '18px 20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  panelHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16, gap: 10,
  },
  panelTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 },

  // Count badge
  countBadge: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: '#ef4444', color: '#fff',
    borderRadius: 10, fontSize: 10, fontWeight: 700,
    minWidth: 18, height: 18, padding: '0 4px',
  },

  // Tabs
  tabs: { display: 'flex', gap: 2, background: '#f8fafc', borderRadius: 7, padding: 3 },
  tab: {
    padding: '4px 12px', borderRadius: 5, border: 'none',
    background: 'transparent', color: '#64748b',
    fontSize: 12, fontWeight: 500, cursor: 'pointer',
  },
  tabActive: { background: '#fff', color: '#0f172a', fontWeight: 600, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },

  // Alert list
  alertList: { display: 'flex', flexDirection: 'column', gap: 10 },
  alertItem: {
    borderRadius: 8, border: '1px solid #f1f5f9',
    padding: '14px 16px', background: '#fafafa',
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  alertRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  alertAuthor: { fontSize: 13, fontWeight: 600, color: '#1e293b' },
  username: { color: '#94a3b8', fontWeight: 400 },
  alertQuote: {
    fontSize: 13, color: '#475569', lineHeight: 1.55,
    position: 'relative', paddingLeft: 16,
  },
  quoteMark: { position: 'absolute', left: 0, top: -2, fontSize: 22, lineHeight: 1, fontFamily: 'Georgia, serif' },
  alertReason: { fontSize: 11, color: '#94a3b8', lineHeight: 1.4 },
  alertActions: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 2 },
  timeLabel: { fontSize: 11, color: '#94a3b8', flexShrink: 0 },

  // Chips
  chip: {
    display: 'inline-flex', alignItems: 'center',
    padding: '2px 8px', borderRadius: 20,
    fontSize: 11, fontWeight: 500,
  },

  // Empty state
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 8 },
  emptyDot: { width: 8, height: 8, borderRadius: '50%', background: '#e2e8f0', display: 'inline-block' },

  // Sidebar
  sidebar: { display: 'flex', flexDirection: 'column', gap: 12 },
  accountRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 10px', borderRadius: 8,
    border: '1px solid #f1f5f9',
    background: '#fafafa',
  },
  platformDot: {
    width: 30, height: 30, borderRadius: 7,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 800, fontSize: 11, flexShrink: 0,
  },
  accountHandle: { fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  accountMeta: { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  statusDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },

  // Coverage
  coverageRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' },
  connectedLabel: { fontSize: 11, color: '#10b981', fontWeight: 600 },

  // Modal
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(15,23,42,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: {
    background: '#fff', borderRadius: 12, padding: '28px 28px 24px',
    width: 440, maxWidth: '95vw',
    boxShadow: '0 20px 50px rgba(0,0,0,0.15)',
    maxHeight: '90vh', overflowY: 'auto' as const,
  },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' },
  closeBtn: { border: 'none', background: 'none', color: '#94a3b8', fontSize: 16, cursor: 'pointer', padding: 4 },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24, paddingTop: 20, borderTop: '1px solid #f1f5f9' },

  // Requirement notice
  requirementBox: {
    display: 'flex', gap: 10, alignItems: 'flex-start',
    background: '#fffbeb', border: '1px solid #fde68a',
    borderRadius: 8, padding: '10px 12px', marginBottom: 14,
  },
  requirementIcon: { fontSize: 14, color: '#d97706', flexShrink: 0, marginTop: 1 },
  requirementText: { fontSize: 12, fontWeight: 600, color: '#92400e', lineHeight: 1.4 },
  requirementNote: { fontSize: 11, color: '#b45309', lineHeight: 1.45, marginTop: 3 },
  requirementLink: { display: 'inline-block', marginTop: 6, fontSize: 11, color: '#29abe2', fontWeight: 600, textDecoration: 'none' },

  // Guide
  guideToggle: {
    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
    border: '1px solid #b8dff5', background: '#f0f8fe', color: '#29abe2',
  },
  guideBox: {
    background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0',
    padding: '14px 16px', marginBottom: 16,
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  guideTitle: { fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 4 },
  guideStep: { fontSize: 12, color: '#475569', lineHeight: 1.5 },
  guideLinks: { display: 'flex', gap: 12, marginTop: 6 },
  guideLink: { fontSize: 12, color: '#29abe2', fontWeight: 500, textDecoration: 'none' },

  platformTabs: { display: 'flex', gap: 6, marginBottom: 8 },
  platformTab: {
    padding: '6px 14px', borderRadius: 6,
    border: '1px solid #e2e8f0', background: '#f8fafc',
    color: '#64748b', fontWeight: 700, fontSize: 12, cursor: 'pointer',
  },

  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: '#475569' },
  input: {
    padding: '9px 12px', borderRadius: 7,
    border: '1px solid #e2e8f0', fontSize: 13,
    color: '#0f172a', outline: 'none',
    background: '#fff', width: '100%', boxSizing: 'border-box' as const,
  },

  // Toast
  toast: {
    position: 'fixed' as const, bottom: 20, right: 20, zIndex: 2000,
    background: '#fff', borderRadius: 10,
    border: '1px solid #f1f5f9',
    padding: '14px 36px 14px 16px',
    width: 340, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  toastMeta: { display: 'flex', gap: 8, alignItems: 'center' },
  toastAuthor: { fontSize: 13, fontWeight: 600, color: '#0f172a' },
  toastText: { fontSize: 12, color: '#64748b', lineHeight: 1.45 },
  toastClose: {
    position: 'absolute' as const, top: 10, right: 12,
    border: 'none', background: 'none', color: '#94a3b8',
    fontSize: 13, cursor: 'pointer',
  },
};
