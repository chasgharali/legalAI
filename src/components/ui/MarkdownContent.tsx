import { ReactNode } from 'react';

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0, m: RegExpExecArray | null, key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={key++} className="font-semibold">{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={key++}>{m[3]}</em>);
    else if (m[4]) parts.push(<code key={key++} className="bg-slate-200 text-slate-800 rounded px-1 text-xs font-mono">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function MarkdownContent({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      nodes.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      nodes.push(
        <p key={i} className="font-semibold text-slate-900 mt-4 mb-1 text-sm">
          {renderInline(trimmed.slice(4))}
        </p>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      nodes.push(
        <p key={i} className="font-bold text-slate-900 mt-5 mb-1.5 text-sm uppercase tracking-wide border-b border-slate-200 pb-1">
          {renderInline(trimmed.slice(3))}
        </p>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      nodes.push(
        <p key={i} className="font-bold text-slate-900 mt-4 mb-1.5 text-base">
          {renderInline(trimmed.slice(2))}
        </p>
      );
      i++;
      continue;
    }

    // Collect consecutive list items
    if (/^[-*•]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      const isOrdered = /^\d+\.\s/.test(trimmed);
      const items: ReactNode[] = [];
      while (
        i < lines.length &&
        (/^[-*•]\s/.test(lines[i].trim()) || /^\d+\.\s/.test(lines[i].trim()))
      ) {
        const li = lines[i].trim().replace(/^[-*•]\s/, '').replace(/^\d+\.\s/, '');
        items.push(
          <li key={i} className="leading-relaxed">
            {renderInline(li)}
          </li>
        );
        i++;
      }
      nodes.push(
        isOrdered ? (
          <ol key={`list-${i}`} className="list-decimal list-outside ml-5 space-y-1 my-2 text-sm text-slate-700">
            {items}
          </ol>
        ) : (
          <ul key={`list-${i}`} className="list-disc list-outside ml-5 space-y-1 my-2 text-sm text-slate-700">
            {items}
          </ul>
        )
      );
      continue;
    }

    nodes.push(
      <p key={i} className="text-sm leading-relaxed text-slate-700">
        {renderInline(trimmed)}
      </p>
    );
    i++;
  }

  return <div className={className ?? 'space-y-1'}>{nodes}</div>;
}
