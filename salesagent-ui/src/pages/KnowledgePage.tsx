import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface Doc {
  id: string;
  title: string;
  status: string;
  sourceType: string;
  sourceUrl: string | null;
  chunkCount: number;
  createdAt: string;
}

export default function KnowledgePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [textTitle, setTextTitle] = useState('');
  const [textContent, setTextContent] = useState('');
  const [showText, setShowText] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [showCrawl, setShowCrawl] = useState(false);
  const [crawlUrl, setCrawlUrl] = useState('');
  const [crawlResult, setCrawlResult] = useState<{ queued: number; urls: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    api.get('/knowledge/documents').then((r) => setDocs(r.data.items ?? r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('title', file.name);
    try {
      await api.post('/knowledge/documents/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      load();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submitText = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);
    try {
      await api.post('/knowledge/documents/text', { title: textTitle, content: textContent });
      setTextTitle(''); setTextContent(''); setShowText(false);
      load();
    } finally {
      setUploading(false);
    }
  };

  const submitUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);
    try {
      await api.post('/knowledge/documents/url', { url: urlInput, title: urlTitle || undefined });
      setUrlInput(''); setUrlTitle(''); setShowUrl(false);
      load();
    } finally {
      setUploading(false);
    }
  };

  const submitCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);
    setCrawlResult(null);
    try {
      const r = await api.post('/knowledge/documents/crawl', { url: crawlUrl, maxPages: 20 });
      setCrawlResult(r.data);
      load();
    } finally {
      setUploading(false);
    }
  };

  const deleteDoc = async (id: string) => {
    if (!confirm('Delete this document?')) return;
    await api.delete(`/knowledge/documents/${id}`);
    load();
  };

  const statusColor: Record<string, string> = { ready: '#10b981', processing: '#f59e0b', pending: '#6366f1', failed: '#ef4444' };

  return (
    <div>
      <div style={styles.topbar}>
        <h2 style={styles.heading}>Knowledge Base</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={styles.primaryBtn} onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : '↑ Upload File'}
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.docx,.md,.html" style={{ display: 'none' }} onChange={uploadFile} />
          <button style={styles.secondaryBtn} onClick={() => { setShowCrawl(!showCrawl); setShowUrl(false); setShowText(false); }}>🌐 Crawl Site</button>
          <button style={styles.secondaryBtn} onClick={() => { setShowUrl(!showUrl); setShowText(false); setShowCrawl(false); }}>🔗 URL / Link</button>
          <button style={styles.secondaryBtn} onClick={() => { setShowText(!showText); setShowUrl(false); setShowCrawl(false); }}>+ Text</button>
        </div>
      </div>

      {showCrawl && (
        <form onSubmit={submitCrawl} style={styles.formCard}>
          <h3 style={{ margin: '0 0 4px', color: '#0f172a', fontSize: 16 }}>Crawl Entire Website</h3>
          <p style={{ margin: '0 0 12px', color: '#64748b', fontSize: 13 }}>
            Enter your homepage URL. The agent will discover up to 20 pages automatically via your sitemap or internal links, and index all of them at once.
          </p>
          <input
            style={styles.input}
            placeholder="https://yourwebsite.com"
            value={crawlUrl}
            onChange={(e) => setCrawlUrl(e.target.value)}
            type="url"
            required
          />
          {crawlResult && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 13, color: '#059669' }}>
              ✓ Queued {crawlResult.queued} pages for indexing. They will appear in the table below as they are processed.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={styles.primaryBtn} type="submit" disabled={uploading}>{uploading ? 'Discovering pages…' : 'Crawl & Index Site'}</button>
            <button style={styles.secondaryBtn} type="button" onClick={() => { setShowCrawl(false); setCrawlResult(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {showUrl && (
        <form onSubmit={submitUrl} style={styles.formCard}>
          <h3 style={{ margin: '0 0 4px', color: '#0f172a', fontSize: 16 }}>Add Website or Link</h3>
          <p style={{ margin: '0 0 12px', color: '#64748b', fontSize: 13 }}>
            Paste any webpage URL — your website, docs, pricing page, LinkedIn, social profiles, blog posts, etc.
            The agent will read and learn from the page content.
          </p>
          <input
            style={styles.input}
            placeholder="https://yourwebsite.com/pricing"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            type="url"
            required
          />
          <input
            style={styles.input}
            placeholder="Title (optional — auto-detected from page)"
            value={urlTitle}
            onChange={(e) => setUrlTitle(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={styles.primaryBtn} type="submit" disabled={uploading}>{uploading ? 'Indexing…' : 'Index Page'}</button>
            <button style={styles.secondaryBtn} type="button" onClick={() => setShowUrl(false)}>Cancel</button>
          </div>
        </form>
      )}

      {showText && (
        <form onSubmit={submitText} style={styles.formCard}>
          <h3 style={{ margin: '0 0 12px', color: '#0f172a' }}>Add Text Document</h3>
          <input style={styles.input} placeholder="Title" value={textTitle} onChange={(e) => setTextTitle(e.target.value)} required />
          <textarea style={{ ...styles.input, height: 120, resize: 'vertical' }} placeholder="Content…" value={textContent} onChange={(e) => setTextContent(e.target.value)} required />
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={styles.primaryBtn} type="submit" disabled={uploading}>{uploading ? 'Saving…' : 'Save'}</button>
            <button style={styles.secondaryBtn} type="button" onClick={() => setShowText(false)}>Cancel</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: '#94a3b8' }}>Loading…</p> : (
        <table style={styles.table}>
          <thead>
            <tr>{['Title', 'Source', 'Status', 'Chunks', 'Added', ''].map((h) => (
              <th key={h} style={styles.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr><td colSpan={6} style={{ ...styles.td, color: '#94a3b8', textAlign: 'center' }}>No documents yet</td></tr>
            )}
            {docs.map((d) => (
              <tr key={d.id}>
                <td style={styles.td}>
                  <div style={{ fontWeight: 500, color: '#0f172a' }}>{d.title}</div>
                  {d.sourceUrl && (
                    <a href={d.sourceUrl} target="_blank" rel="noreferrer"
                      style={{ fontSize: 11, color: '#0284c7', textDecoration: 'none', display: 'block', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                      {d.sourceUrl}
                    </a>
                  )}
                </td>
                <td style={{ ...styles.td, color: '#64748b' }}>
                  <span style={{ ...styles.sourceChip, background: d.sourceType === 'url' ? '#eff6ff' : d.sourceType === 'upload' ? '#f0fdf4' : '#faf5ff', color: d.sourceType === 'url' ? '#0284c7' : d.sourceType === 'upload' ? '#059669' : '#7c3aed', border: `1px solid ${d.sourceType === 'url' ? '#bae6fd' : d.sourceType === 'upload' ? '#bbf7d0' : '#ddd6fe'}` }}>
                    {d.sourceType === 'url' ? '🔗 URL' : d.sourceType === 'upload' ? '📄 File' : '✏ Text'}
                  </span>
                </td>
                <td style={styles.td}>
                  <span style={{ ...styles.pill, background: `${statusColor[d.status] ?? '#64748b'}26`, color: statusColor[d.status] ?? '#94a3b8' }}>
                    {d.status}
                  </span>
                </td>
                <td style={{ ...styles.td, color: '#64748b', textAlign: 'center' }}>{d.chunkCount ?? '—'}</td>
                <td style={{ ...styles.td, color: '#94a3b8' }}>{new Date(d.createdAt).toLocaleDateString()}</td>
                <td style={styles.td}>
                  <button style={styles.deleteBtn} onClick={() => deleteDoc(d.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  heading: { margin: 0, color: '#0f172a' },
  table: { width: '100%', borderCollapse: 'collapse', background: '#ffffff', borderRadius: 10, overflow: 'hidden', border: '1px solid #e0f2fe' },
  th: { padding: '12px 16px', textAlign: 'left', fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #e0f2fe', background: '#f0f9ff' },
  td: { padding: '12px 16px', fontSize: 14, color: '#0f172a', borderBottom: '1px solid #e0f2fe' },
  pill: { padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 },
  sourceChip: { padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' },
  formCard: { background: '#ffffff', borderRadius: 10, padding: 24, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520, border: '1px solid #e0f2fe' },
  input: { padding: '10px 14px', borderRadius: 8, border: '1px solid #bae6fd', background: '#f8fafc', color: '#0f172a', fontSize: 14, fontFamily: 'inherit' },
  primaryBtn: { padding: '9px 18px', borderRadius: 8, border: 'none', background: '#0284c7', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  secondaryBtn: { padding: '9px 18px', borderRadius: 8, border: '1px solid #bae6fd', background: 'transparent', color: '#475569', cursor: 'pointer', fontSize: 14 },
  deleteBtn: { padding: '5px 12px', borderRadius: 6, border: '1px solid #e0f2fe', background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 12 },
};
