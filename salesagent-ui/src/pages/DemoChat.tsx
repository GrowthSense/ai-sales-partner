/**
 * DemoChat — Interactive demo of the AI sales agent via WebSocket.
 * Light blue theme — feels like a real embedded chat widget.
 */
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { api } from '../lib/api';

const WIDGET_KEY = '6ee743c9-8872-4e02-9516-117f2838bfd6';
const WS_URL = 'http://localhost:3020';
const VISITOR_ID_KEY = `salesagent_visitor_${WIDGET_KEY}`;

const SUGGESTIONS = [
  'What plans do you offer?',
  'Tell me about your features',
  'I need help with lead qualification',
  'Book me a demo',
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  ts: number;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function DemoChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'ready' | 'typing' | 'error'>('connecting');
  const [statusText, setStatusText] = useState('Connecting…');
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [isReturning, setIsReturning] = useState(false);
  const [stage, setStage] = useState<string>('greeting');
  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let socket: Socket;

    async function connect() {
      const storedVisitorId = localStorage.getItem(VISITOR_ID_KEY);
      if (storedVisitorId) setIsReturning(true);

      const { data } = await api.post('/auth/widget/session', {
        widgetKey: WIDGET_KEY,
        ...(storedVisitorId ? { visitorId: storedVisitorId } : {}),
      });

      localStorage.setItem(VISITOR_ID_KEY, data.visitorId);
      setVisitorId(data.visitorId);

      socket = io(`${WS_URL}/chat`, {
        auth: { token: data.visitorToken },
        transports: ['websocket'],
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setConnected(true);
        socket.emit('conversation.start', { widgetKey: WIDGET_KEY }, (res: any) => {
          if (res?.conversationId) {
            setConversationId(res.conversationId);
            setStatus('ready');
            setStatusText('Online');
            setMessages([{
              role: 'assistant',
              content: storedVisitorId
                ? 'Welcome back! Great to hear from you again — how can I help you today?'
                : 'Hi there! I\'m Alex, your AI sales assistant at GrowthSense. How can I help you today?',
              ts: Date.now(),
            }]);
          } else {
            setStatus('error');
            setStatusText('Failed to connect');
          }
        });
      });

      socket.on('disconnect', () => {
        setConnected(false);
        setStatus('error');
        setStatusText('Disconnected');
      });

      socket.on('message.processing', () => {
        setStatus('typing');
      });

      socket.on('message.chunk', ({ token }: { token: string }) => {
        setStatus('typing');
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            return [...prev.slice(0, -1), { ...last, content: last.content + token }];
          }
          return [...prev, { role: 'assistant', content: token, streaming: true, ts: Date.now() }];
        });
      });

      socket.on('message.complete', () => {
        setStatus('ready');
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.streaming) return [...prev.slice(0, -1), { ...last, streaming: false }];
          return prev;
        });
        inputRef.current?.focus();
      });

      socket.on('stage.changed', ({ stage: s }: { stage: string }) => {
        setStage(s);
      });

      socket.on('error', (err: any) => {
        setStatus('error');
        setStatusText(`Error: ${err?.message ?? 'unknown'}`);
      });
    }

    connect().catch((e) => {
      setStatus('error');
      setStatusText(`Connection failed: ${e.message}`);
    });

    return () => { socket?.disconnect(); };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || !connected || !conversationId) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content, ts: Date.now() }]);
    socketRef.current?.emit('message.send', { conversationId, content });
  };

  const canSend = connected && !!conversationId && !!input.trim() && status !== 'typing';

  return (
    <div style={styles.page}>
      {/* Left panel — info */}
      <div style={styles.infoPanel}>
        <div style={styles.infoBadge}>Live Demo</div>
        <h2 style={styles.infoTitle}>Talk to your AI sales agent</h2>
        <p style={styles.infoDesc}>
          This is exactly what your website visitors experience. The agent qualifies leads,
          answers questions from your knowledge base, and guides prospects toward booking a demo.
        </p>

        <div style={styles.infoStats}>
          {[
            { label: 'Stage', value: stage.replace(/_/g, ' ') },
            { label: 'Status', value: statusText },
            { label: 'Visitor', value: isReturning ? 'Returning' : 'New' },
          ].map(({ label, value }) => (
            <div key={label} style={styles.statRow}>
              <span style={styles.statLabel}>{label}</span>
              <span style={styles.statValue}>{value}</span>
            </div>
          ))}
        </div>

        <div style={styles.features}>
          {[
            { icon: '🧠', text: 'Answers from your knowledge base' },
            { icon: '📋', text: 'BANT lead qualification' },
            { icon: '📅', text: 'Books demos automatically' },
            { icon: '🔄', text: 'Remembers returning visitors' },
          ].map(({ icon, text }) => (
            <div key={text} style={styles.featureRow}>
              <span style={styles.featureIcon}>{icon}</span>
              <span style={styles.featureText}>{text}</span>
            </div>
          ))}
        </div>

        {visitorId && (
          <button style={styles.resetBtn} onClick={() => {
            localStorage.removeItem(VISITOR_ID_KEY);
            window.location.reload();
          }}>
            ↩ Reset as new visitor
          </button>
        )}
      </div>

      {/* Chat widget */}
      <div style={styles.widget}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <div style={styles.agentAvatar}>
              <img src="/cropped-growthsense-main-logo.png" alt="GrowthSense" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
            </div>
            <div>
              <div style={styles.agentName}>Alex · GrowthSense</div>
              <div style={styles.agentStatus}>
                <span style={{
                  ...styles.statusDot,
                  background: status === 'error' ? '#ef4444' : status === 'typing' ? '#f59e0b' : '#22c55e',
                }} />
                {status === 'typing' ? 'Typing…' : statusText}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={styles.aiBadge}>AI Agent</div>
            {isReturning && <div style={styles.returningBadge}>↩ Returning</div>}
          </div>
        </div>

        {/* Messages */}
        <div style={styles.messages}>
          {messages.length === 0 && status === 'connecting' && (
            <div style={styles.connectingState}>
              <div style={styles.typingDots}>
                <span /><span /><span />
              </div>
              <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 8 }}>Connecting to agent…</p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{ ...styles.msgWrap, justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {m.role === 'assistant' && (
                <div style={styles.agentAvatarSm}>A</div>
              )}
              <div style={{ maxWidth: '72%' }}>
                <div style={{
                  ...styles.bubble,
                  ...(m.role === 'user' ? styles.userBubble : styles.aiBubble),
                }}>
                  {m.content}
                  {m.streaming && <span style={styles.cursor} />}
                </div>
                <div style={{ ...styles.msgTime, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                  {formatTime(m.ts)}
                </div>
              </div>
              {m.role === 'user' && (
                <div style={styles.userAvatarSm}>U</div>
              )}
            </div>
          ))}

          {status === 'typing' && messages[messages.length - 1]?.role !== 'assistant' && (
            <div style={{ ...styles.msgWrap, justifyContent: 'flex-start' }}>
              <div style={styles.agentAvatarSm}>A</div>
              <div style={{ ...styles.bubble, ...styles.aiBubble, padding: '12px 16px' }}>
                <div style={styles.typingDots}>
                  <span /><span /><span />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Suggestions */}
        {messages.length <= 1 && status === 'ready' && (
          <div style={styles.suggestions}>
            {SUGGESTIONS.map((s) => (
              <button key={s} style={styles.chip} onClick={() => send(s)} disabled={!connected || !conversationId || status === 'typing'}>
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={styles.inputArea}>
          <input
            ref={inputRef}
            style={styles.input}
            placeholder={connected && conversationId ? 'Message Alex…' : 'Connecting…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            disabled={!connected || !conversationId || status === 'typing'}
          />
          <button style={{ ...styles.sendBtn, opacity: canSend ? 1 : 0.4 }} onClick={() => send()} disabled={!canSend}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <div style={styles.poweredBy}>Powered by GrowthSense</div>
      </div>

      <style>{`
        @keyframes blink-cursor { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        .typing-dot:nth-child(1){animation-delay:0s}
        .typing-dot:nth-child(2){animation-delay:0.15s}
        .typing-dot:nth-child(3){animation-delay:0.3s}
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    gap: 32,
    alignItems: 'flex-start',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },

  // ── Left info panel ────────────────────────────────────────
  infoPanel: {
    width: 280,
    flexShrink: 0,
    paddingTop: 8,
  },
  infoBadge: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: 20,
    background: 'rgba(41,171,226,0.15)',
    border: '1px solid rgba(41,171,226,0.35)',
    color: '#29abe2',
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  infoTitle: {
    margin: '0 0 10px',
    fontSize: 20,
    fontWeight: 700,
    color: '#2e3191',
    lineHeight: 1.3,
  },
  infoDesc: {
    margin: '0 0 24px',
    fontSize: 13,
    color: '#64748b',
    lineHeight: 1.6,
  },
  infoStats: {
    background: '#eef6fc',
    borderRadius: 10,
    padding: '12px 16px',
    marginBottom: 20,
    border: '1px solid #cde8f5',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
  },
  statLabel: { color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: 0.5, fontSize: 10, fontWeight: 600 },
  statValue: { color: '#2e3191', fontWeight: 700, fontSize: 12, textTransform: 'capitalize' as const },
  features: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 },
  featureRow: { display: 'flex', alignItems: 'center', gap: 10 },
  featureIcon: { fontSize: 16, width: 24, textAlign: 'center' as const },
  featureText: { fontSize: 13, color: '#475569' },
  resetBtn: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #cde8f5',
    background: '#fff',
    color: '#64748b',
    fontSize: 12,
    cursor: 'pointer',
    width: '100%',
  },

  // ── Chat widget ────────────────────────────────────────────
  widget: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    background: '#f8fafc',
    boxShadow: '0 8px 32px rgba(46,49,145,0.12), 0 2px 8px rgba(41,171,226,0.1)',
    border: '1px solid #cde8f5',
  },

  // Header
  header: {
    background: 'linear-gradient(135deg, #29abe2 0%, #2e3191 100%)',
    padding: '16px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  agentAvatar: {
    width: 44, height: 44, borderRadius: 10,
    background: 'rgba(255,255,255,0.18)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '2px solid rgba(255,255,255,0.35)',
    flexShrink: 0,
    overflow: 'hidden',
  },
  agentName: { fontSize: 15, fontWeight: 700, color: '#fff' },
  agentStatus: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  statusDot: { width: 7, height: 7, borderRadius: '50%', display: 'inline-block', flexShrink: 0 },
  aiBadge: {
    fontSize: 10, padding: '3px 8px', borderRadius: 20,
    background: 'rgba(255,255,255,0.2)',
    color: '#fff', fontWeight: 600, letterSpacing: 0.3,
  },
  returningBadge: {
    fontSize: 10, padding: '2px 8px', borderRadius: 20,
    background: 'rgba(34,197,94,0.25)',
    color: '#bbf7d0', fontWeight: 500,
  },

  // Messages
  messages: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minHeight: 420,
    maxHeight: 600,
    background: '#f0f8fe',
  },
  connectingState: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', padding: '40px 0',
  },
  msgWrap: { display: 'flex', alignItems: 'flex-end', gap: 8 },
  agentAvatarSm: {
    width: 28, height: 28, borderRadius: '50%',
    background: 'linear-gradient(135deg, #29abe2, #2e3191)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0,
  },
  userAvatarSm: {
    width: 28, height: 28, borderRadius: '50%',
    background: '#e2e8f0',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#64748b', fontWeight: 700, fontSize: 11, flexShrink: 0,
  },
  bubble: {
    padding: '10px 14px',
    borderRadius: 16,
    fontSize: 14,
    lineHeight: 1.55,
    wordBreak: 'break-word' as const,
    whiteSpace: 'pre-wrap' as const,
  },
  aiBubble: {
    background: '#fff',
    color: '#1e293b',
    borderBottomLeftRadius: 4,
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  userBubble: {
    background: 'linear-gradient(135deg, #29abe2, #2e3191)',
    color: '#fff',
    borderBottomRightRadius: 4,
  },
  cursor: {
    display: 'inline-block',
    width: 2, height: 14,
    background: '#29abe2',
    marginLeft: 2,
    verticalAlign: 'middle',
    animation: 'blink-cursor 1s step-end infinite',
  },
  msgTime: { fontSize: 10, color: '#94a3b8', marginTop: 3, paddingLeft: 4, paddingRight: 4 },
  typingDots: {
    display: 'flex', gap: 4, alignItems: 'center', height: 16,
  },

  // Suggestions
  suggestions: {
    display: 'flex', flexWrap: 'wrap' as const, gap: 6,
    padding: '10px 16px',
    background: '#f0f8fe',
    borderTop: '1px solid #cde8f5',
  },
  chip: {
    padding: '5px 12px',
    borderRadius: 20,
    border: '1px solid #b8dff5',
    background: '#fff',
    color: '#2e3191',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    transition: 'all 0.15s',
    whiteSpace: 'nowrap' as const,
  },

  // Input
  inputArea: {
    display: 'flex',
    gap: 8,
    padding: '12px 16px',
    borderTop: '1px solid #cde8f5',
    background: '#fff',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    padding: '10px 16px',
    borderRadius: 24,
    border: '1.5px solid #b8dff5',
    background: '#f0f8fe',
    color: '#1e293b',
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  sendBtn: {
    width: 40, height: 40,
    borderRadius: '50%',
    border: 'none',
    background: 'linear-gradient(135deg, #29abe2, #2e3191)',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    boxShadow: '0 2px 8px rgba(41,171,226,0.4)',
    transition: 'opacity 0.2s',
  },
  poweredBy: {
    textAlign: 'center' as const,
    fontSize: 11,
    color: '#94a3b8',
    padding: '6px 0 10px',
    background: '#fff',
  },
};
