import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eraser, Image as ImageIcon, Sparkles, Upload } from 'lucide-react';
import { api } from '../api';
import type { Lang } from '../i18n';
import { translations } from '../i18n';
import type { ActiveView, MediaJobDTO, ModelDTO } from '../types';

interface Props {
  lang: Lang;
  models: ModelDTO[];
  onNavigate: (view: ActiveView) => void;
}

export function ImageStudio({ lang, models, onNavigate }: Props) {
  const t = translations[lang];
  const imageModels = useMemo(
    () =>
      models.filter(
        (m) =>
          m.isEnabled &&
          (m.capabilities.imageGen ||
            m.capabilities.imageEdit ||
            m.capabilities.inpainting ||
            m.capabilities.backgroundRemoval ||
            m.category === 'image')
      ),
    [models]
  );

  const [selectedModelKey, setSelectedModelKey] = useState('');
  const selectedModel = useMemo(
    () => imageModels.find((m) => m.id === selectedModelKey) || imageModels[0] || null,
    [imageModels, selectedModelKey]
  );

  const [mode, setMode] = useState<'txt2img' | 'img2img' | 'inpaint' | 'remove_bg'>('txt2img');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [quality, setQuality] = useState('standard');
  const [count, setCount] = useState(1);

  const [refFileId, setRefFileId] = useState<string | undefined>();
  const [refPreviewUrl, setRefPreviewUrl] = useState<string | undefined>();
  const [maskBase64, setMaskBase64] = useState<string | undefined>();

  const [jobs, setJobs] = useState<MediaJobDTO[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    if (!selectedModelKey && imageModels.length > 0) {
      setSelectedModelKey(imageModels[0].id);
    }
  }, [imageModels, selectedModelKey]);

  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    const res = await api.listImageJobs();
    setJobs(res.jobs);
  }

  async function handleUploadRef(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const res = await api.uploadFile(file, 'uploads');
      setRefFileId(res.file.id);
      setRefPreviewUrl(res.file.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = true;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 22;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(
      ((e.clientX - rect.left) / rect.width) * canvas.width,
      ((e.clientY - rect.top) / rect.height) * canvas.height
    );
  }

  function moveDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(
      ((e.clientX - rect.left) / rect.width) * canvas.width,
      ((e.clientY - rect.top) / rect.height) * canvas.height
    );
    ctx.stroke();
  }

  function endDraw() {
    if (!drawingRef.current || !canvasRef.current) return;
    drawingRef.current = false;
    setMaskBase64(canvasRef.current.toDataURL('image/png'));
  }

  function clearMask() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setMaskBase64(undefined);
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedModel || !prompt.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      await api.generateImage({
        modelKey: selectedModel.id,
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        size,
        aspectRatio,
        quality,
        n: count,
        mode,
        referenceFileId: refFileId,
        maskBase64: mode === 'inpaint' ? maskBase64 : undefined,
      });
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  const canImg2Img = Boolean(selectedModel?.capabilities.imageEdit);
  const canInpaint = Boolean(selectedModel?.capabilities.inpainting);
  const canRemoveBg = Boolean(selectedModel?.capabilities.backgroundRemoval);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t.image.title}</h1>
            <p className="text-xs text-slate-500 mt-1">{t.image.unsupportedNote}</p>
          </div>
          {imageModels.length === 0 && (
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
          {/* Controls Panel */}
          <form
            onSubmit={handleGenerate}
            className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-5 space-y-4"
          >
            {/* Mode Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 p-1">
              <button
                type="button"
                onClick={() => setMode('txt2img')}
                className={`rounded-lg py-2 px-2 text-xs font-medium transition-colors ${
                  mode === 'txt2img'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {t.image.txt2img}
              </button>
              <button
                type="button"
                disabled={!canImg2Img}
                onClick={() => setMode('img2img')}
                className={`rounded-lg py-2 px-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                  mode === 'img2img'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {t.image.img2img}
              </button>
              <button
                type="button"
                disabled={!canInpaint}
                onClick={() => setMode('inpaint')}
                className={`rounded-lg py-2 px-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                  mode === 'inpaint'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {t.image.inpaint}
              </button>
              <button
                type="button"
                disabled={!canRemoveBg}
                onClick={() => setMode('remove_bg')}
                className={`rounded-lg py-2 px-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                  mode === 'remove_bg'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {t.image.removeBg}
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
                {imageModels.length === 0 && <option value="">{t.common.selectModel}</option>}
                {imageModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.providerName})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {t.image.prompt}
              </label>
              <textarea
                required
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-sm outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {t.image.negativePrompt} ({t.common.optional})
              </label>
              <input
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.image.size}
                </label>
                <select
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-mono"
                >
                  <option value="1024x1024">1024x1024</option>
                  <option value="1792x1024">1792x1024</option>
                  <option value="1024x1792">1024x1792</option>
                  <option value="512x512">512x512</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.image.aspectRatio}
                </label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-mono"
                >
                  <option value="1:1">1:1</option>
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                  <option value="4:3">4:3</option>
                  <option value="3:4">3:4</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.image.quality}
                </label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
                >
                  <option value="standard">Standard</option>
                  <option value="hd">HD</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.image.count}
                </label>
                <input
                  type="number"
                  min="1"
                  max="4"
                  value={count}
                  onChange={(e) => setCount(Math.min(4, Math.max(1, Number(e.target.value))))}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-mono tabular-nums"
                />
              </div>
            </div>

            {/* Reference Image & Inpaint Mask Canvas */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-500">
                {t.image.referenceImage} ({t.common.optional})
              </label>
              <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-3 text-xs text-slate-500 hover:border-indigo-500 cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>{t.common.upload}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleUploadRef(e.target.files?.[0])}
                />
              </label>

              {refPreviewUrl && (
                <div className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                  <img
                    src={refPreviewUrl}
                    alt="Reference"
                    referrerPolicy="no-referrer"
                    className="w-full max-h-56 object-contain bg-black/20"
                  />
                  {mode === 'inpaint' && (
                    <canvas
                      ref={canvasRef}
                      width={512}
                      height={512}
                      onPointerDown={startDraw}
                      onPointerMove={moveDraw}
                      onPointerUp={endDraw}
                      onPointerLeave={endDraw}
                      className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
                    />
                  )}
                </div>
              )}

              {mode === 'inpaint' && refPreviewUrl && (
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{t.image.maskDraw}</span>
                  <button
                    type="button"
                    onClick={clearMask}
                    className="inline-flex items-center gap-1 text-red-500 hover:underline"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    <span>{t.image.clearMask}</span>
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={generating || !selectedModel || !prompt.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 min-h-[44px]"
            >
              <Sparkles className="w-4 h-4" />
              <span>{generating ? t.common.loading : t.image.generate}</span>
            </button>
          </form>

          {/* Gallery History */}
          <div className="lg:col-span-7 space-y-4">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-indigo-500" />
              <span>{t.image.history}</span>
            </h2>

            {jobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center text-sm text-slate-500">
                {t.common.noData}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] overflow-hidden"
                  >
                    {job.resultFiles.length > 0 ? (
                      <div className="grid gap-1 bg-slate-950">
                        {job.resultFiles.map((f) => (
                          <div key={f.id} className="relative group">
                            <img
                              src={f.url}
                              alt={job.prompt}
                              referrerPolicy="no-referrer"
                              className="w-full aspect-square object-cover"
                            />
                            <a
                              href={`${f.url}?download=1`}
                              download={f.name}
                              className="absolute bottom-3 end-3 rounded-xl bg-black/75 p-2 text-white opacity-90 hover:opacity-100"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-6 text-xs text-red-500">{job.error || job.status}</div>
                    )}
                    <div className="p-3.5 space-y-1">
                      <p className="text-xs line-clamp-2">{job.prompt}</p>
                      <p className="text-[11px] font-mono text-slate-500">
                        {job.modelKey.split('::')[1]}
                        {job.durationMs ? ` · ${(job.durationMs / 1000).toFixed(1)}s` : ''}
                      </p>
                    </div>
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
