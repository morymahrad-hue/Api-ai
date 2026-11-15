import { useMemo, useRef, useState } from 'react';
import { Code2, Download, FileCode, FolderArchive, Play, Square } from 'lucide-react';
import { api } from '../api';
import type { Lang } from '../i18n';
import { translations } from '../i18n';
import type { ActiveView, ModelDTO } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface Props {
  lang: Lang;
  models: ModelDTO[];
  onNavigate: (view: ActiveView) => void;
}

interface ParsedFile {
  path: string;
  content: string;
}

function parseProjectFiles(markdown: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const regex = /(?:###?\s*FILE:\s*([^\n]+)\n+)?```[\w+-]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let idx = 1;
  while ((match = regex.exec(markdown)) !== null) {
    const rawPath = match[1]?.trim() || `snippet_${idx}.txt`;
    files.push({ path: rawPath, content: match[2] });
    idx++;
  }
  return files;
}

export function CodeStudio({ lang, models, onNavigate }: Props) {
  const t = translations[lang];
  const enabledModels = useMemo(() => models.filter((m) => m.isEnabled), [models]);
  const [modelKey, setModelKey] = useState(
    () => enabledModels.find((m) => m.isDefault)?.id || enabledModels[0]?.id || ''
  );
  const [language, setLanguage] = useState('TypeScript / React');
  const [task, setTask] = useState<'generate' | 'fix' | 'explain' | 'analyze' | 'project'>(
    'generate'
  );
  const [prompt, setPrompt] = useState('');
  const [sourceCode, setSourceCode] = useState('');
  const [output, setOutput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const parsedFiles = useMemo(() => parseProjectFiles(output), [output]);

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    const targetModel = modelKey || enabledModels[0]?.id;
    if (!targetModel || !prompt.trim()) return;

    setStreaming(true);
    setOutput('');
    setSelectedFileIdx(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const conv = await api.createConversation({
        title: `Code: ${prompt.trim().slice(0, 36)}`,
        mode: 'code',
        activeModelKeys: [targetModel],
      });

      const taskInstruction =
        task === 'project'
          ? `Build a complete, clean multi-file project in ${language}. Format EVERY file strictly using:\n### FILE: path/to/filename.ext\n\`\`\`lang\n...\n\`\`\``
          : `Perform coding task "${task}" in ${language}. Provide production-quality code with clear explanations.`;

      const fullPrompt = sourceCode.trim()
        ? `${prompt.trim()}\n\nInput Code:\n\`\`\`\n${sourceCode.trim()}\n\`\`\``
        : prompt.trim();

      await api.streamChat(
        {
          conversationId: conv.conversation.id,
          modelKey: targetModel,
          userText: fullPrompt,
          systemPrompt: taskInstruction,
          temperature: 0.2,
          maxTokens: 8192,
        },
        {
          signal: ctrl.signal,
          onDelta: (chunk) => setOutput((prev) => prev + chunk),
          onDone: () => {},
          onError: (err) => setOutput((prev) => prev + `\n\nError: ${err}`),
        }
      );
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setOutput(err instanceof Error ? err.message : 'Execution failed');
      }
    } finally {
      setStreaming(false);
    }
  }

  async function handleExportZip() {
    if (parsedFiles.length === 0) return;
    const blob = await api.exportCodeZip('mahrad-code-project', parsedFiles);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mahrad-code-project.zip';
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadSingleFile(file: ParsedFile) {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.path.split('/').pop() || 'code.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{t.code.title}</h1>
          {enabledModels.length === 0 && (
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white"
            >
              {t.common.goToGateway}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Input Panel */}
          <form
            onSubmit={handleRun}
            className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-5 space-y-4"
          >
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {t.common.selectModel}
              </label>
              <select
                value={modelKey || enabledModels[0]?.id || ''}
                onChange={(e) => setModelKey(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm"
              >
                {enabledModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.providerName})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.code.language}
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
                >
                  {[
                    'TypeScript / React',
                    'Python',
                    'Node.js / Express',
                    'Go',
                    'Rust',
                    'Java / Kotlin',
                    'C# / .NET',
                    'SQL / PostgreSQL',
                    'HTML / CSS / JS',
                    'Bash / DevOps',
                  ].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.code.task}
                </label>
                <select
                  value={task}
                  onChange={(e) => setTask(e.target.value as typeof task)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
                >
                  {Object.entries(t.code.tasks).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Prompt</label>
              <textarea
                required
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t.code.promptPlaceholder}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-sm outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Code Input ({t.common.optional})
              </label>
              <textarea
                rows={6}
                dir="ltr"
                value={sourceCode}
                onChange={(e) => setSourceCode(e.target.value)}
                placeholder="// Paste existing code to fix, explain, or refactor..."
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-xs font-mono outline-none focus:border-indigo-500"
              />
            </div>

            {streaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-medium text-white min-h-[44px]"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>{t.common.stop}</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={enabledModels.length === 0 || !prompt.trim()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 min-h-[44px]"
              >
                <Play className="w-4 h-4" />
                <span>{t.code.run}</span>
              </button>
            )}
          </form>

          {/* Output & Extracted Project Tree */}
          <div className="lg:col-span-7 space-y-4">
            {parsedFiles.length > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold flex items-center gap-1.5">
                    <Code2 className="w-4 h-4 text-indigo-500" />
                    {t.code.projectFiles} ({parsedFiles.length})
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => downloadSingleFile(parsedFiles[selectedFileIdx] || parsedFiles[0])}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 px-2.5 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{t.common.download}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportZip}
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                    >
                      <FolderArchive className="w-3.5 h-3.5" />
                      <span>{t.code.exportZip}</span>
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5" dir="ltr">
                  {parsedFiles.map((f, i) => (
                    <button
                      key={`${f.path}-${i}`}
                      type="button"
                      onClick={() => setSelectedFileIdx(i)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-mono ${
                        selectedFileIdx === i
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200'
                          : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <FileCode className="w-3.5 h-3.5" />
                      <span>{f.path}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-5 min-h-[420px]">
              {output ? (
                <MarkdownRenderer content={output} />
              ) : (
                <div className="h-full min-h-[360px] flex items-center justify-center text-sm text-slate-400">
                  {t.common.noData}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
