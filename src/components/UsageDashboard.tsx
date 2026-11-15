import { useEffect, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { Lang } from '../i18n';
import { translations } from '../i18n';
import type { ApiLogDTO, ProviderDTO } from '../types';

interface Props {
  lang: Lang;
  providers: ProviderDTO[];
  onRefreshData: () => Promise<void>;
}

export function UsageDashboard({ lang, providers, onRefreshData }: Props) {
  const t = translations[lang];
  const [summary, setSummary] = useState<{
    totalRequests: number;
    errorCount: number;
    tokensPrompt: number;
    tokensCompletion: number;
    tokensTotal: number;
    avgLatencyMs: number | null;
    totalCost: number | null;
    costCount: number;
  } | null>(null);
  const [byModel, setByModel] = useState<
    Array<{
      modelId: string;
      providerName: string;
      requests: number;
      errors: number;
      tokensTotal: number;
      avgLatencyMs: number | null;
      totalCost: number | null;
    }>
  >([]);
  const [logs, setLogs] = useState<ApiLogDTO[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadUsage();
  }, []);

  async function loadUsage() {
    setLoading(true);
    try {
      const res = await api.getUsage();
      setSummary(res.summary);
      setByModel(res.byModel);
      setLogs(res.logs);
    } finally {
      setLoading(false);
    }
  }

  async function handleClearLogs() {
    await api.clearUsage();
    await loadUsage();
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{t.usage.title}</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadUsage}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 px-3.5 py-2 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{t.common.refresh}</span>
            </button>
            <button
              type="button"
              onClick={handleClearLogs}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-xs font-medium text-red-500 hover:bg-red-500/20"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t.usage.clearLogs}</span>
            </button>
          </div>
        </div>

        {/* Summary Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-4">
            <p className="text-xs text-slate-500">{t.usage.totalRequests}</p>
            <p className="mt-1 text-2xl font-bold font-mono tabular-nums">
              {summary?.totalRequests ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-4">
            <p className="text-xs text-slate-500">{t.usage.errors}</p>
            <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-red-500">
              {summary?.errorCount ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-4">
            <p className="text-xs text-slate-500">{t.usage.totalTokens}</p>
            <p className="mt-1 text-2xl font-bold font-mono tabular-nums">
              {(summary?.tokensTotal ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-4">
            <p className="text-xs text-slate-500">{t.usage.avgLatency}</p>
            <p className="mt-1 text-2xl font-bold font-mono tabular-nums">
              {summary?.avgLatencyMs ? `${Math.round(summary.avgLatencyMs)}ms` : '—'}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-4">
            <p className="text-xs text-slate-500">{t.usage.estimatedCost}</p>
            <p className="mt-1 text-lg font-bold font-mono tabular-nums">
              {summary && summary.costCount > 0 && summary.totalCost !== null
                ? `$${summary.totalCost.toFixed(5)}`
                : t.usage.costUnavailable}
            </p>
          </div>
        </div>

        {/* Provider Health */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-5 space-y-3">
          <h2 className="text-base font-semibold">{t.usage.providerHealth}</h2>
          {providers.length === 0 ? (
            <p className="text-sm text-slate-500">{t.common.noData}</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {providers.map((p) => (
                <div key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">{p.name}</p>
                    <p className="text-xs font-mono text-slate-500" dir="ltr">
                      {p.baseUrl} · {p.lastStatus}
                      {p.lastLatencyMs ? ` · ${p.lastLatencyMs}ms` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.testProvider(p.id);
                      await onRefreshData();
                      await loadUsage();
                    }}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {t.common.test}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Usage by Model */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-base font-semibold">{t.usage.modelBreakdown}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-start">Model</th>
                  <th className="px-4 py-3 text-start">Provider</th>
                  <th className="px-4 py-3 text-end">Requests</th>
                  <th className="px-4 py-3 text-end">Errors</th>
                  <th className="px-4 py-3 text-end">Tokens</th>
                  <th className="px-4 py-3 text-end">Latency</th>
                  <th className="px-4 py-3 text-end">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono text-xs tabular-nums">
                {byModel.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500 font-sans">
                      {t.common.noData}
                    </td>
                  </tr>
                ) : (
                  byModel.map((row) => (
                    <tr key={`${row.providerName}-${row.modelId}`}>
                      <td className="px-4 py-3 text-start">{row.modelId}</td>
                      <td className="px-4 py-3 text-start font-sans">{row.providerName}</td>
                      <td className="px-4 py-3 text-end">{row.requests}</td>
                      <td className="px-4 py-3 text-end text-red-500">{row.errors}</td>
                      <td className="px-4 py-3 text-end">{row.tokensTotal.toLocaleString()}</td>
                      <td className="px-4 py-3 text-end">
                        {row.avgLatencyMs ? `${Math.round(row.avgLatencyMs)}ms` : '—'}
                      </td>
                      <td className="px-4 py-3 text-end">
                        {row.totalCost !== null ? `$${row.totalCost.toFixed(5)}` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Recent Request History */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-base font-semibold">{t.usage.recentLogs}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-start">Time</th>
                  <th className="px-4 py-3 text-start">Endpoint</th>
                  <th className="px-4 py-3 text-start">Model</th>
                  <th className="px-4 py-3 text-end">Tokens</th>
                  <th className="px-4 py-3 text-end">Latency</th>
                  <th className="px-4 py-3 text-start">Status / Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-500 font-sans">
                      {t.common.noData}
                    </td>
                  </tr>
                ) : (
                  logs.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2.5 text-slate-500">
                        {new Date(l.createdAt).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2.5">{l.endpoint}</td>
                      <td className="px-4 py-2.5">{l.modelId}</td>
                      <td className="px-4 py-2.5 text-end">{l.tokensTotal ?? '—'}</td>
                      <td className="px-4 py-2.5 text-end">
                        {l.latencyMs !== null ? `${l.latencyMs}ms` : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {l.success ? (
                          <span className="text-emerald-500">OK ({l.statusCode ?? 200})</span>
                        ) : (
                          <span className="text-red-500 truncate max-w-[260px] inline-block">
                            {l.errorMessage || 'Error'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
