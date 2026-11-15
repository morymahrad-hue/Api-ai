import { useEffect, useMemo, useState } from 'react';
import { Download, Film, RefreshCw, Upload } from 'lucide-react';
import { api } from '../api';
import type { Lang } from '../i18n';
import { translations } from '../i18n';
import type { ActiveView, MediaJobDTO, ModelDTO } from '../types';

interface Props {
  lang: Lang;
  models: ModelDTO[];
  onNavigate: (view: ActiveView) => void;
}

export function VideoStudio({ lang, models, onNavigate }: Props) {
  const t = translations[lang];
  const videoModels = useMemo(
    () =>
      models.filter(
        (m) =>
          m.isEnabled &&
          (m.capabilities.videoGen ||
            m.capabilities.imageToVideo ||
            m.capabilities.videoToVideo ||
            m.category === 'video')
      ),
    [models]
  );

  const [selectedModelKey, setSelectedModelKey] = useState('');
  const selectedModel = useMemo(
    () => videoModels.find((m) => m.id === selectedModelKey) || videoModels[0] || null,
    [videoModels, selectedModelKey]
  );

  const [mode, setMode] = useState<'txt2vid' | 'img2vid' | 'vid2vid'>('txt2vid');
  const [prompt, setPrompt] = useState('');
  const [durationSec, setDurationSec] = useState(5);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [quality, setQuality] = useState('standard');
  const [refFileId, setRefFileId] = useState<string | undefined>();
  const [refName, setRefName] = useState<string | undefined>();

  const [jobs, setJobs] = useState<MediaJobDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedModelKey && videoModels.length > 0) setSelectedModelKey(videoModels[0].id);
  }, [videoModels, selectedModelKey]);

  useEffect(() => {
    loadJobs();
  }, []);

  // Automatic background polling for processing jobs
  useEffect(() => {
    const processing = jobs.filter((j) => j.status === 'processing' && j.remoteJobId);
    if (processing.length === 0) return;
    const timer = setInterval(async () => {
      for (const job of processing) {
        try {
          await api.pollVideoJob(job.id);
        } catch {
          // handled on job record
        }
      }
      loadJobs();
    }, 5000);
    return () => clearInterval(timer);
  }, [jobs]);

  async function loadJobs() {
    const res = await api.listVideoJobs();
    setJobs(res.jobs);
  }

  async function handleUploadRef(file: File | undefined) {
    if (!file) return;
    const res = await api.uploadFile(file, 'uploads');
    setRefFileId(res.file.id);
    setRefName(res.file.name);
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedModel || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.generateVideo({
        modelKey: selectedModel.id,
        prompt: prompt.trim(),
        mode,
        durationSec,
        aspectRatio,
        quality,
        referenceFileId: refFileId,
      });
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Video generation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{t.video.title}</h1>
          {videoModels.length === 0 && (
            <button
              type="button"
              onClick={() => onNavigate('models')}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white"
            >
              {t.common.goToModels}
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleGenerate}
            className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-5 space-y-4"
          >
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 p-1">
              <button
                type="button"
                onClick={() => setMode('txt2vid')}
                className={`rounded-lg py-2 text-xs font-medium ${
                  mode === 'txt2vid'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {t.video.txt2vid}
              </button>
              <button
                type="button"
                disabled={!selectedModel?.capabilities.imageToVideo}
                onClick={() => setMode('img2vid')}
                className={`rounded-lg py-2 text-xs font-medium disabled:opacity-40 ${
                  mode === 'img2vid'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {t.video.img2vid}
              </button>
              <button
                type="button"
                disabled={!selectedModel?.capabilities.videoToVideo}
                onClick={() => setMode('vid2vid')}
                className={`rounded-lg py-2 text-xs font-medium disabled:opacity-40 ${
                  mode === 'vid2vid'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {t.video.vid2vid}
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {t.common.selectModel}
              </label>
              <select
                value={selectedModel?.id || ''}
                onChange={(e) => setSelectedModelKey(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm"
              >
                {videoModels.length === 0 && <option value="">{t.common.selectModel}</option>}
                {videoModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.providerName})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {t.video.prompt}
              </label>
              <textarea
                required
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-sm outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.video.durationSec}
                </label>
                <input
                  type="number"
                  min="2"
                  max="60"
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.video.aspectRatio}
                </label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-mono"
                >
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                  <option value="1:1">1:1</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.video.quality}
                </label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
                >
                  <option value="standard">720p</option>
                  <option value="hd">1080p</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {t.video.referenceMedia} ({t.common.optional})
              </label>
              <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-3 text-xs text-slate-500 hover:border-indigo-500 cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>{refName || t.common.upload}</span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => handleUploadRef(e.target.files?.[0])}
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={busy || !selectedModel || !prompt.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 min-h-[44px]"
            >
              <Film className="w-4 h-4" />
              <span>{busy ? t.common.loading : t.video.generate}</span>
            </button>
          </form>

          <div className="lg:col-span-7 space-y-4">
            <h2 className="text-base font-semibold">{t.video.history}</h2>
            {jobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center text-sm text-slate-500">
                {t.common.noData}
              </div>
            ) : (
              <div className="space-y-4">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{job.prompt}</p>
                      <span className="text-xs font-mono text-slate-500">{job.status}</span>
                    </div>

                    {job.status === 'processing' && (
                      <div className="flex items-center justify-between rounded-xl bg-indigo-500/10 p-3 text-xs text-indigo-400">
                        <span>{t.video.processing}</span>
                        <button
                          type="button"
                          onClick={() => api.pollVideoJob(job.id).then(loadJobs)}
                          className="inline-flex items-center gap-1 font-medium hover:underline"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>{t.video.pollStatus}</span>
                        </button>
                      </div>
                    )}

                    {job.error && <p className="text-xs text-red-500">{job.error}</p>}

                    {job.resultFiles.map((f) => (
                      <div key={f.id} className="space-y-2">
                        <video controls className="w-full rounded-xl bg-black max-h-80" src={f.url} />
                        <a
                          href={`${f.url}?download=1`}
                          download={f.name}
                          className="inline-flex items-center gap-1.5 text-xs text-indigo-500 hover:underline"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>{t.common.download}</span>
                        </a>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
