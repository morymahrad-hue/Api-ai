import { useMemo, useState } from 'react';
import {
  BarChart3,
  Calculator,
  FileCode2,
  FileText,
  Globe,
  Image as ImageIcon,
  Languages,
  Link2,
  PenLine,
  ScanText,
  Sparkles,
  Subtitles,
  Wand2,
} from 'lucide-react';
import { api } from '../api';
import type { Lang } from '../i18n';
import { translations } from '../i18n';
import type { ModelDTO } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface Props {
  lang: Lang;
  models: ModelDTO[];
}

type ToolId =
  | 'webSearch'
  | 'translate'
  | 'summarize'
  | 'rewrite'
  | 'promptBuilder'
  | 'ocr'
  | 'converter'
  | 'calculator'
  | 'dataAnalysis'
  | 'extractInfo'
  | 'subtitles'
  | 'linkAnalyzer'
  | 'quickImage';

function safeEvaluateMath(expr: string): string {
  const cleaned = expr.replace(/[^0-9+\-*/().%\s^]/g, '').replace(/\^/g, '**');
  if (!cleaned.trim()) throw new Error('Empty mathematical expression');
  // Strict recursive/Function evaluation limited strictly to numeric arithmetic characters
  const fn = new Function(`"use strict"; return (${cleaned});`) as () => unknown;
  const val = fn();
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Error('Expression did not evaluate to a finite number');
  }
  return String(val);
}

export function ToolsHub({ lang, models }: Props) {
  const t = translations[lang];
  const enabledModels = useMemo(() => models.filter((m) => m.isEnabled), [models]);
  const [selectedModelKey, setSelectedModelKey] = useState(
    () => enabledModels.find((m) => m.isDefault)?.id || enabledModels[0]?.id || ''
  );

  const [activeTool, setActiveTool] = useState<ToolId>('translate');
  const [inputText, setInputText] = useState('');
  const [extraField, setExtraField] = useState('Persian');
  const [targetFormat, setTargetFormat] = useState<'json' | 'csv' | 'xml' | 'txt' | 'markdown'>('json');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [output, setOutput] = useState('');
  const [imageResultUrl, setImageResultUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toolItems: Array<{ id: ToolId; label: string; icon: typeof Languages }> = [
    { id: 'translate', label: t.tools.translate, icon: Languages },
    { id: 'summarize', label: t.tools.summarize, icon: FileText },
    { id: 'rewrite', label: t.tools.rewrite, icon: PenLine },
    { id: 'promptBuilder', label: t.tools.promptBuilder, icon: Wand2 },
    { id: 'ocr', label: t.tools.ocr, icon: ScanText },
    { id: 'converter', label: t.tools.converter, icon: FileCode2 },
    { id: 'calculator', label: t.tools.calculator, icon: Calculator },
    { id: 'dataAnalysis', label: t.tools.dataAnalysis, icon: BarChart3 },
    { id: 'extractInfo', label: t.tools.extractInfo, icon: Sparkles },
    { id: 'subtitles', label: t.tools.subtitles, icon: Subtitles },
    { id: 'linkAnalyzer', label: t.tools.linkAnalyzer, icon: Link2 },
    { id: 'webSearch', label: t.tools.webSearch, icon: Globe },
    { id: 'quickImage', label: t.tools.quickImage, icon: ImageIcon },
  ];

  async function runAiPrompt(systemPrompt: string, userText: string, file?: File | null) {
    const mKey = selectedModelKey || enabledModels[0]?.id;
    if (!mKey) throw new Error(t.common.noModelsConnected);

    const attachments = [];
    if (file) {
      const uploaded = await api.uploadFile(file, 'uploads');
      attachments.push(uploaded.attachment);
    }

    const conv = await api.createConversation({
      title: `Tool: ${activeTool}`,
      mode: 'chat',
      activeModelKeys: [mKey],
    });

    let acc = '';
    await api.streamChat(
      {
        conversationId: conv.conversation.id,
        modelKey: mKey,
        userText,
        attachments,
        systemPrompt,
        temperature: 0.3,
        maxTokens: 4096,
      },
      {
        onDelta: (chunk) => {
          acc += chunk;
          setOutput(acc);
        },
        onDone: () => {},
        onError: (err) => setError(err),
      }
    );
  }

  async function handleExecute(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOutput('');
    setImageResultUrl(null);

    try {
      if (activeTool === 'calculator') {
        const res = safeEvaluateMath(inputText);
        setOutput(`**Result:** \`${res}\``);
      } else if (activeTool === 'converter') {
        const res = await api.convertFormat({
          targetFormat,
          rawText: selectedFile ? undefined : inputText,
          file: selectedFile || undefined,
        });
        setOutput(`\`\`\`${targetFormat}\n${res.output}\n\`\`\``);
      } else if (activeTool === 'dataAnalysis') {
        const stats = await api.analyzeData({
          file: selectedFile || undefined,
          rawText: selectedFile ? undefined : inputText,
        });
        const statsMd = `### Dataset Summary\n- Rows: **${stats.rowCount}** · Columns: **${stats.columnCount}**\n\n\`\`\`json\n${JSON.stringify(stats.summary, null, 2)}\n\`\`\``;
        setOutput(statsMd);
        if (selectedModelKey || enabledModels[0]?.id) {
          await runAiPrompt(
            'You are a data analyst. Analyze these computed dataset statistics and summarize key insights.',
            `Statistics:\n${JSON.stringify(stats.summary)}\n\nSample rows:\n${JSON.stringify(stats.sampleRows)}`
          );
          setOutput((prev) => `${statsMd}\n\n---\n\n${prev}`);
        }
      } else if (activeTool === 'webSearch') {
        const res = await api.webSearch(inputText);
        const formatted = res.results
          .map((r, i) => `${i + 1}. **[${r.title}](${r.url})**\n   ${r.snippet}`)
          .join('\n\n');
        setOutput(formatted || t.common.noData);
      } else if (activeTool === 'linkAnalyzer') {
        const fetched = await api.fetchUrlText(inputText);
        await runAiPrompt(
          'Analyze the fetched webpage content cleanly and extract the main points.',
          `URL: ${fetched.url}\nTitle: ${fetched.title}\n\nContent:\n${fetched.text}`
        );
      } else if (activeTool === 'ocr') {
        if (!selectedFile) throw new Error('Please upload an image for OCR.');
        await runAiPrompt(
          'Extract all visible text from the attached image accurately, preserving structure.',
          inputText || 'Extract all text from this image.',
          selectedFile
        );
      } else if (activeTool === 'subtitles') {
        if (selectedFile && selectedFile.type.startsWith('audio/')) {
          const sttModel =
            models.find((m) => m.isEnabled && m.capabilities.audioStt)?.id || selectedModelKey;
          if (!sttModel) throw new Error('No STT-capable model enabled.');
          const res = await api.transcribeStt({
            modelKey: sttModel,
            file: selectedFile,
            responseFormat: 'srt',
          });
          setOutput(`\`\`\`srt\n${res.job.textOutput || ''}\n\`\`\``);
        } else {
          await runAiPrompt(
            'Convert the provided transcript or script into valid SRT subtitle format with realistic timestamps.',
            inputText
          );
        }
      } else if (activeTool === 'quickImage') {
        const imgModel =
          models.find((m) => m.isEnabled && m.capabilities.imageGen)?.id || selectedModelKey;
        if (!imgModel) throw new Error('No image model enabled.');
        const res = await api.generateImage({
          modelKey: imgModel,
          prompt: inputText,
          n: 1,
          size: '1024x1024',
          mode: 'txt2img',
        });
        const fileUrl = res.job.resultFiles[0]?.url;
        if (fileUrl) setImageResultUrl(fileUrl);
      } else if (activeTool === 'translate') {
        await runAiPrompt(
          `Translate the user text accurately and naturally into ${extraField || 'Persian'}. Output only the translation.`,
          inputText,
          selectedFile
        );
      } else if (activeTool === 'summarize') {
        await runAiPrompt(
          'Provide a concise, well-structured executive summary with key bullet points.',
          inputText || 'Summarize the attached file.',
          selectedFile
        );
      } else if (activeTool === 'rewrite') {
        await runAiPrompt(
          `Rewrite the text in a "${extraField || 'professional and clear'}" tone while preserving meaning.`,
          inputText
        );
      } else if (activeTool === 'promptBuilder') {
        await runAiPrompt(
          'Transform the user goal into a structured, high-precision prompt with Role, Context, Constraints, and Output Format.',
          inputText
        );
      } else if (activeTool === 'extractInfo') {
        await runAiPrompt(
          `Extract structured JSON information from the text/file focusing on: ${extraField || 'entities, dates, metrics, action items'}.`,
          inputText || 'Extract structured data from attached file.',
          selectedFile
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tool execution failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{t.tools.title}</h1>
          <select
            value={selectedModelKey}
            onChange={(e) => setSelectedModelKey(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] px-3 py-2 text-xs font-medium min-h-[40px]"
          >
            {enabledModels.length === 0 && <option value="">{t.common.selectModel}</option>}
            {enabledModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.providerName})
              </option>
            ))}
          </select>
        </div>

        {/* Tool Selector Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {toolItems.map((item) => {
            const Icon = item.icon;
            const active = activeTool === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTool(item.id);
                  setError(null);
                  setOutput('');
                  setImageResultUrl(null);
                }}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors text-start ${
                  active
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleExecute}
            className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-5 space-y-4"
          >
            {(activeTool === 'translate' || activeTool === 'rewrite' || activeTool === 'extractInfo') && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {activeTool === 'translate'
                    ? 'Target Language'
                    : activeTool === 'rewrite'
                      ? 'Target Tone'
                      : 'Fields to Extract'}
                </label>
                <input
                  value={extraField}
                  onChange={(e) => setExtraField(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
            )}

            {activeTool === 'converter' && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Target Format
                </label>
                <select
                  value={targetFormat}
                  onChange={(e) => setTargetFormat(e.target.value as typeof targetFormat)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                  <option value="xml">XML</option>
                  <option value="markdown">Markdown Table</option>
                  <option value="txt">Plain Text</option>
                </select>
              </div>
            )}

            {['ocr', 'converter', 'dataAnalysis', 'summarize', 'translate', 'extractInfo', 'subtitles'].includes(
              activeTool
            ) && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.common.upload} ({t.common.optional})
                </label>
                <input
                  type="file"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="w-full text-xs file:me-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:text-white"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {activeTool === 'linkAnalyzer'
                  ? 'URL (https://...)'
                  : activeTool === 'calculator'
                    ? 'Expression (e.g. (1250 * 0.15) + 42^2)'
                    : 'Input'}
              </label>
              <textarea
                rows={5}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-sm outline-none focus:border-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 min-h-[44px]"
            >
              {busy ? t.common.loading : t.common.send}
            </button>
          </form>

          <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-5 min-h-[360px]">
            {imageResultUrl ? (
              <img
                src={imageResultUrl}
                alt="Generated output"
                referrerPolicy="no-referrer"
                className="max-w-full rounded-xl mx-auto"
              />
            ) : output ? (
              <MarkdownRenderer content={output} />
            ) : (
              <div className="h-full min-h-[300px] flex items-center justify-center text-sm text-slate-400">
                {t.common.noData}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
