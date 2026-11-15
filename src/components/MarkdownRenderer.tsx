import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { Check, Copy } from 'lucide-react';

interface Props {
  content: string;
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const raw = String(children ?? '').replace(/\n$/, '');
  const match = /language-([\w+-]+)/.exec(className || '');
  const lang = match?.[1] || '';

  let highlighted = raw;
  try {
    if (lang && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(raw, { language: lang }).value;
    } else if (raw.includes('\n')) {
      highlighted = hljs.highlightAuto(raw).value;
    }
  } catch {
    highlighted = raw;
  }

  if (!className && !raw.includes('\n')) {
    return (
      <code className="rounded bg-slate-200/80 dark:bg-slate-800 px-1.5 py-0.5 text-[0.85em] font-mono text-indigo-700 dark:text-indigo-300">
        {children}
      </code>
    );
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-[#0d1117] text-slate-100" dir="ltr">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-3.5 py-2 text-xs text-slate-400">
        <span className="font-mono">{lang || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-[13px] leading-relaxed font-mono">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content }: Props) {
  return (
    <div className="prose-studio text-[15px] leading-7 break-words space-y-2.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children }) {
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
          p({ children }) {
            return <p className="leading-7">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc ps-5 space-y-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal ps-5 space-y-1">{children}</ol>;
          },
          h1({ children }) {
            return <h1 className="text-xl font-bold mt-4 mb-2">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-lg font-semibold mt-3 mb-1.5">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-base font-semibold mt-2.5 mb-1">{children}</h3>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-900/50 px-4 py-2.5 text-slate-700 dark:text-slate-300">
                {children}
              </blockquote>
            );
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm border-collapse">{children}</table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border-b border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-start font-semibold">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border-b border-slate-100 dark:border-slate-800/60 px-3 py-2">
                {children}
              </td>
            );
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 dark:text-indigo-400 underline underline-offset-2 hover:opacity-80"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
