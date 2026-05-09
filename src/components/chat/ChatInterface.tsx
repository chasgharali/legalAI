'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';
import { Send, Loader2, MessageSquare, AlertTriangle, Bot, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import MarkdownContent from '@/components/ui/MarkdownContent';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  matterId: string;
  entryCount: number;
}

const STARTER_QUESTIONS = [
  'What was the claimant\'s pre-existing medical history before the incident?',
  'Were there any treatment gaps in the records?',
  'What is the first mention of the injury following the incident?',
  'Are there any inconsistencies in the records?',
  'What specialist referrals were made?',
];

export default function ChatInterface({ matterId, entryCount }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(content: string) {
    if (!content.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: content.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matterId, messages: newMessages }),
      });

      if (!res.ok) throw new Error('Request failed');

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      const decoder = new TextDecoder();
      let accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.replace('data: ', '');
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data) as { text: string };
            accumulated = accumulated + parsed.text;
            const snapshot = accumulated;
            setMessages((prev) => [
              ...prev.slice(0, -1),
              { role: 'assistant', content: snapshot },
            ]);
          } catch {
            // skip malformed chunks
          }
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, there was an error processing your request. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-260px)] min-h-[500px]">
      {/* Chat area */}
      <div className="flex-1 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-medium text-slate-900">Query Medical Records</span>
          {entryCount > 0 ? (
            <span className="text-xs text-slate-400 ml-auto">{entryCount} chronology entries loaded</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-amber-600 ml-auto">
              <AlertTriangle className="w-3 h-3" /> No chronology yet
            </span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-8">
              <Bot className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-600 mb-1">Ask questions about this matter</p>
              <p className="text-xs text-slate-400 mb-5">The AI has access to the full medical chronology and can cite specific entries.</p>

              <div className="space-y-2 text-left max-w-lg mx-auto">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">Suggested questions</p>
                {STARTER_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="w-full text-left text-sm text-slate-700 bg-slate-50 hover:bg-blue-50 hover:text-blue-700 border border-slate-200 hover:border-blue-200 rounded-lg px-3 py-2 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-blue-600" />
                  </div>
                )}
                <div className={cn(
                  'rounded-xl px-4 py-3',
                  msg.role === 'user'
                    ? 'max-w-[75%] bg-blue-600 text-white text-sm'
                    : 'max-w-[88%] bg-slate-50 border border-slate-200 text-slate-900'
                )}>
                  {msg.role === 'user' ? (
                    msg.content
                  ) : msg.content ? (
                    <MarkdownContent text={msg.content} />
                  ) : (
                    <span className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="w-3 h-3 animate-spin" /> Thinking…
                    </span>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="w-7 h-7 bg-slate-200 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <User className="w-4 h-4 text-slate-600" />
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-slate-100">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Ask a question about this matter… (Enter to send, Shift+Enter for newline)"
              disabled={loading}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
              style={{ minHeight: '40px', maxHeight: '120px' }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg transition-colors flex-shrink-0"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
          <p className="text-xs text-slate-400 mt-1.5">
            AI responses cite source documents. Not legal advice — verify all outputs with the source records.
          </p>
        </div>
      </div>
    </div>
  );
}
