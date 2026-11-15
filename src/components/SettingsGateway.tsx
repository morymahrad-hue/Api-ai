import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  Edit3,
  KeyRound,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import type { Lang } from '../i18n';
import { translations } from '../i18n';
import type { AdapterType, ProviderDTO, StudioSettings } from '../types';

interface Props {
  lang: Lang;
  providers: ProviderDTO[];
  settings: StudioSettings;
  onRefreshData: () => Promise<void>;
  onUpdateSettings: (next: Partial<StudioSettings>) => Promise<void>;
}

const PRESETS: Array<{ label: string; adapterType: AdapterType; baseUrl: string }> = [
  {
    label: 'Respan Gateway',
    adapterType: 'openai_compatible',
    baseUrl: 'https://gateway.respan.ai/v1',
  },
  {
    label: 'OpenAI',
    adapterType: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    label: 'OpenRouter',
    adapterType: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    label: 'Google Gemini',
    adapterType: 'google_gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  {
    label: 'Anthropic Claude',
    adapterType: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  {
    label: 'DeepSeek',
    adapterType: 'openai_compatible',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  {
    label: 'Groq',
    adapterType: 'openai_compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
  {
    label: 'xAI Grok',
    adapterType: 'openai_compatible',
    baseUrl: 'https://api.x.ai/v1',
  },
  {
    label: 'Ollama (Local)',
    adapterType: 'openai_compatible',
    baseUrl: 'http://localhost:11434/v1',
  },
];

export function SettingsGateway({
  lang,
  providers,
  settings,
  onRefreshData,
  onUpdateSettings,
}: Props) {
  const t = translations[lang];

  // Provider form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [adapterType, setAdapterType] = useState<AdapterType>('openai_compatible');
  const [baseUrl, setBaseUrl] = useState('https://gateway.respan.ai/v1');
  const [apiKey, setApiKey] = useState('');
  const [customHeadersText, setCustomHeadersText] = useState('{}');
  const [customPathsText, setCustomPathsText] = useState('{}');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [busy, setBusy] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  function resetForm() {
    setEditingId(null);
    setName('');
    setAdapterType('openai_compatible');
    setBaseUrl('https://gateway.respan.ai/v1');
    setApiKey('');
    setCustomHeadersText('{}');
    setCustomPathsText('{}');
  }

  function startEdit(p: ProviderDTO) {
    setEditingId(p.id);
    setName(p.name);
    setAdapterType(p.adapterType);
    setBaseUrl(p.baseUrl);
    setApiKey('');
    setCustomHeadersText(JSON.stringify(p.customHeaders, null, 2));
    setCustomPathsText(JSON.stringify(p.customPaths, null, 2));
    setShowAdvanced(true);
  }

  async function handleSubmitProvider(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const customHeaders = JSON.parse(customHeadersText || '{}') as Record<string, string>;
      const customPaths = JSON.parse(customPathsText || '{}') as Record<string, string>;

      if (editingId) {
        await api.updateProvider(editingId, {
          name,
          adapterType,
          baseUrl,
          apiKey: apiKey || undefined,
          customHeaders,
          customPaths,
        });
        setFeedback({ type: 'ok', text: lang === 'fa' ? 'Provider بروزرسانی شد.' : 'Provider updated.' });
      } else {
        const res = await api.createProvider({
          name,
          adapterType,
          baseUrl,
          apiKey,
          customHeaders,
          customPaths,
          autoFetchModels: true,
        });
        const msg = res.connection.ok
          ? lang === 'fa'
            ? `متصل شد (${res.connection.latencyMs}ms) · ${res.fetchedCount} مدل واقعی دریافت شد.`
            : `Connected (${res.connection.latencyMs}ms) · ${res.fetchedCount} live models fetched.`
          : `${t.common.error}: ${res.connection.error}`;
        setFeedback({ type: res.connection.ok ? 'ok' : 'err', text: msg });
      }
      resetForm();
      await onRefreshData();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Failed saving provider' });
    } finally {
      setBusy(false);
    }
  }

  async function handleTestProvider(id: string) {
    setRowBusyId(id);
    setFeedback(null);
    try {
      const res = await api.testProvider(id);
      setFeedback({
        type: res.result.ok ? 'ok' : 'err',
        text: res.result.ok
          ? `OK (${res.result.latencyMs}ms${res.result.modelCount !== undefined ? ` · ${res.result.modelCount} models` : ''})`
          : res.result.error || 'Connection failed',
      });
      await onRefreshData();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleFetchModels(id: string) {
    setRowBusyId(id);
    setFeedback(null);
    try {
      const res = await api.fetchProviderModels(id);
      setFeedback({
        type: 'ok',
        text:
          lang === 'fa'
            ? `${res.count} مدل واقعی از API دریافت و ثبت شد.`
            : `Fetched ${res.count} live models from API.`,
      });
      await onRefreshData();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Fetch failed' });
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleDeleteProvider(id: string) {
    setRowBusyId(id);
    try {
      await api.deleteProvider(id);
      await onRefreshData();
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleClearHistory() {
    if (!window.confirm(t.settings.confirmClear)) return;
    await api.clearConversations();
    setFeedback({
      type: 'ok',
      text: lang === 'fa' ? 'تاریخچه مکالمات پاک شد.' : 'All conversation history cleared.',
    });
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.settings.title}</h1>
        </div>

        {feedback && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              feedback.type === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* Section 1: Universal AI Gateway & Providers */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Add / Edit Provider Form */}
          <form
            onSubmit={handleSubmitProvider}
            className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-indigo-500" />
                <span>{editingId ? t.common.edit : t.settings.addProvider}</span>
              </h2>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  {t.common.cancel}
                </button>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-slate-500 mb-2">{t.settings.presets}</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      if (!name) setName(preset.label);
                      setAdapterType(preset.adapterType);
                      setBaseUrl(preset.baseUrl);
                    }}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 hover:border-indigo-500 hover:text-indigo-500 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.settings.providerName}
                </label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Respan Gateway"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.settings.adapterType}
                </label>
                <select
                  value={adapterType}
                  onChange={(e) => setAdapterType(e.target.value as AdapterType)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500"
                >
                  <option value="openai_compatible">OpenAI Compatible API</option>
                  <option value="google_gemini">Google Gemini API</option>
                  <option value="anthropic">Anthropic Claude API</option>
                  <option value="custom_http">Custom HTTP Gateway</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.settings.baseUrl}
                </label>
                <input
                  required
                  dir="ltr"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://gateway.respan.ai/v1"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm font-mono outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.settings.apiKey}
                </label>
                <input
                  type="password"
                  dir="ltr"
                  required={!editingId}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={editingId ? t.settings.apiKeyKeep : 'sk-...'}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm font-mono outline-none focus:border-indigo-500"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs font-medium text-indigo-500 hover:underline"
              >
                {showAdvanced ? '−' : '+'} {t.settings.customHeaders} & {t.settings.customPaths}
              </button>

              {showAdvanced && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      {t.settings.customHeaders}
                    </label>
                    <textarea
                      rows={2}
                      dir="ltr"
                      value={customHeadersText}
                      onChange={(e) => setCustomHeadersText(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2.5 text-xs font-mono outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      {t.settings.customPaths}
                    </label>
                    <textarea
                      rows={3}
                      dir="ltr"
                      placeholder='{"models":"/models","chat":"/chat/completions","images":"/images/generations","videos":"/videos"}'
                      value={customPathsText}
                      onChange={(e) => setCustomPathsText(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2.5 text-xs font-mono outline-none"
                    />
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>{busy ? t.common.loading : editingId ? t.common.save : t.settings.addProvider}</span>
            </button>
          </form>

          {/* Connected Providers List */}
          <div className="lg:col-span-7 space-y-3">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-500" />
              <span>{t.settings.providersTitle}</span>
            </h2>

            {providers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-8 text-center text-sm text-slate-500">
                {t.common.noData}
              </div>
            ) : (
              <div className="space-y-3">
                {providers.map((p) => {
                  const isBusy = rowBusyId === p.id;
                  return (
                    <div
                      key={p.id}
                      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-base truncate">{p.name}</h3>
                            {p.lastStatus === 'connected' ? (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>{p.lastLatencyMs}ms</span>
                              </span>
                            ) : p.lastStatus === 'error' ? (
                              <span className="inline-flex items-center gap-1 text-xs text-red-500">
                                <XCircle className="w-3.5 h-3.5" />
                                <span>{t.common.error}</span>
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs font-mono text-slate-500 truncate" dir="ltr">
                            {p.baseUrl} · {p.keyHint} · {p.adapterType} · {p.modelCount || 0} models
                          </p>
                          {p.lastError && (
                            <p className="text-xs text-red-500 break-all">{p.lastError}</p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleTestProvider(p.id)}
                            className="rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[36px]"
                          >
                            {t.settings.testConnection}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleFetchModels(p.id)}
                            className="inline-flex items-center gap-1 rounded-xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 px-3 py-1.5 text-xs font-medium hover:bg-indigo-600/20 min-h-[36px]"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                            <span>{t.settings.fetchModels}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(p)}
                            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProvider(p.id)}
                            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-red-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Section 2: General Preferences, Search, Data Management */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-5 space-y-5">
          <h2 className="text-base font-semibold">{t.settings.generalTitle}</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                {t.common.language}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ language: 'fa' })}
                  className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium ${
                    settings.language === 'fa'
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  فارسی (RTL)
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ language: 'en' })}
                  className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium ${
                    settings.language === 'en'
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  English (LTR)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Theme</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ theme: 'dark' })}
                  className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium ${
                    settings.theme === 'dark'
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {t.common.darkMode}
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ theme: 'light' })}
                  className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium ${
                    settings.theme === 'light'
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {t.common.lightMode}
                </button>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                {t.chat.systemPrompt}
              </label>
              <textarea
                rows={2}
                value={settings.defaultSystemPrompt}
                onChange={(e) => onUpdateSettings({ defaultSystemPrompt: e.target.value })}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-sm outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                {t.settings.searchConfig}
              </label>
              <select
                value={settings.searchProviderType}
                onChange={(e) =>
                  onUpdateSettings({
                    searchProviderType: e.target.value as StudioSettings['searchProviderType'],
                  })
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm"
              >
                <option value="none">Disabled</option>
                <option value="duckduckgo_instant">DuckDuckGo Instant Answer API (Free)</option>
                <option value="custom">Custom JSON Search Endpoint</option>
              </select>
            </div>

            {settings.searchProviderType === 'custom' && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  Custom Search Endpoint URL
                </label>
                <input
                  dir="ltr"
                  value={settings.searchEndpointUrl}
                  onChange={(e) => onUpdateSettings({ searchEndpointUrl: e.target.value })}
                  placeholder="https://your-search-proxy.example/search"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm font-mono"
                />
              </div>
            )}
          </div>

          <label className="flex items-center gap-2.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={settings.memoryEnabled}
              onChange={(e) => onUpdateSettings({ memoryEnabled: e.target.checked })}
              className="w-4 h-4 rounded accent-indigo-600"
            />
            <span>{t.settings.memoryEnabled}</span>
          </label>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-3">
            <a
              href="/api/conversations/export"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Download className="w-4 h-4" />
              <span>{t.settings.exportChats}</span>
            </a>
            <button
              type="button"
              onClick={handleClearHistory}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs font-medium text-red-500 hover:bg-red-500/20"
            >
              <Trash2 className="w-4 h-4" />
              <span>{t.settings.clearChats}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
