import { useEffect, useMemo, useState } from 'react';
import { Download, Mic, Music, Upload, Volume2 } from 'lucide-react';
import { api } from '../api';
import type { Lang } from '../i18n';
import { translations } from '../i18n';
import type { ActiveView, MediaJobDTO, ModelDTO } from '../types';

interface Props {
  lang: Lang;
  models: ModelDTO[];
  onNavigate: (view: ActiveView) => void;
}

export function AudioStudio({ lang, models, onNavigate }: Props) {
  const t = translations[lang];
  const [tab, setTab] = useState<'music' | 'tts' | 'stt' | 'clone'>('tts');

  const musicModels = useMemo(
    () => models.filter((m) => m.isEnabled && (m.capabilities.musicGen || m.category === 'music')),
    [models]
  );
  const ttsModels = useMemo(
    () => models.filter((m) => m.isEnabled && (m.capabilities.audioTts || m.category === 'audio')),
    [models]
  );
  const sttModels = useMemo(
    () => models.filter((m) => m.isEnabled && (m.capabilities.audioStt || m.category === 'audio')),
    [models]
  );
  const cloneModels = useMemo(
    () => models.filter((m) => m.isEnabled && m.capabilities.voiceClone),
    [models]
  );

  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [jobs, setJobs] = useState<MediaJobDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Music state
  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicMode, setMusicMode] = useState<'music' | 'beat' | 'ambient' | 'sfx' | 'vocals'>('music');
  const [musicStyle, setMusicStyle] = useState('');
  const [instrumental, setInstrumental] = useState(true);
  const [durationSec, setDurationSec] = useState(30);

  // TTS & Clone state
  const [ttsText, setTtsText] = useState('');
  const [voice, setVoice] = useState('alloy');
  const [speed, setSpeed] = useState(1.0);
  const [format, setFormat] = useState('mp3');
  const [cloneConsent, setCloneConsent] = useState(false);
  const [cloneRefFileId, setCloneRefFileId] = useState<string | undefined>();
  const [cloneRefName, setCloneRefName] = useState<string | undefined>();

  // STT state
  const [sttFile, setSttFile] = useState<File | null>(null);
  const [sttLanguage, setSttLanguage] = useState('');
  const [sttFormat, setSttFormat] = useState<'json' | 'srt' | 'vtt' | 'text'>('json');

  const activePool =
    tab === 'music'
      ? musicModels
      : tab === 'stt'
        ? sttModels
        : tab === 'clone'
          ? cloneModels
          : ttsModels;

  useEffect(() => {
    if (activePool.length > 0 && !activePool.some((m) => m.id === selectedModelKey)) {
      setSelectedModelKey(activePool[0].id);
    } else if (activePool.length === 0) {
      setSelectedModelKey('');
    }
  }, [tab, activePool, selectedModelKey]);

  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    const res = await api.listAudioJobs();
    setJobs(res.jobs);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedModelKey) return;
    setBusy(true);
    setError(null);
    try {
      if (tab === 'music') {
        await api.generateMusic({
          modelKey: selectedModelKey,
          prompt: musicPrompt,
          style: musicStyle,
          instrumental,
          durationSec,
          mode: musicMode,
        });
      } else if (tab === 'tts') {
        await api.generateTts({
          modelKey: selectedModelKey,
          text: ttsText,
          voice,
          speed,
          format,
        });
      } else if (tab === 'clone') {
        if (!cloneConsent) throw new Error(t.audio.consentRequired);
        await api.generateTts({
          modelKey: selectedModelKey,
          text: ttsText,
          voice,
          speed,
          format,
          voiceCloneConsent: true,
          referenceFileId: cloneRefFileId,
        });
      } else if (tab === 'stt') {
        if (!sttFile) throw new Error('Please upload an audio file.');
        await api.transcribeStt({
          modelKey: selectedModelKey,
          file: sttFile,
          language: sttLanguage || undefined,
          responseFormat: sttFormat,
        });
      }
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{t.audio.title}</h1>
          <button
            type="button"
            onClick={() => onNavigate('models')}
            className="rounded-xl border border-slate-200 dark:border-slate-800 px-3.5 py-2 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t.common.goToModels}
          </button>
        </div>

        {/* Sub-Tabs */}
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 p-1 w-fit">
          {(
            [
              ['tts', t.audio.ttsTab],
              ['stt', t.audio.sttTab],
              ['music', t.audio.musicTab],
              ['clone', t.audio.cloneTab],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
                tab === id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSubmit}
            className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-5 space-y-4"
          >
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {t.common.selectModel}
              </label>
              <select
                value={selectedModelKey}
                onChange={(e) => setSelectedModelKey(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm"
              >
                {activePool.length === 0 && (
                  <option value="">
                    {lang === 'fa'
                      ? 'مدل سازگار در صفحه مدلها فعال نشده است'
                      : 'No capable model enabled in Models'}
                  </option>
                )}
                {activePool.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.providerName})
                  </option>
                ))}
              </select>
            </div>

            {tab === 'music' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    {t.audio.musicMode}
                  </label>
                  <select
                    value={musicMode}
                    onChange={(e) => setMusicMode(e.target.value as typeof musicMode)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    {Object.entries(t.audio.modes).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
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
                    rows={3}
                    value={musicPrompt}
                    onChange={(e) => setMusicPrompt(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      {t.audio.style}
                    </label>
                    <input
                      value={musicStyle}
                      onChange={(e) => setMusicStyle(e.target.value)}
                      placeholder="Ambient / Electronic / Classical"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      {t.video.durationSec}
                    </label>
                    <input
                      type="number"
                      min="5"
                      max="180"
                      value={durationSec}
                      onChange={(e) => setDurationSec(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-mono tabular-nums"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={instrumental}
                    onChange={(e) => setInstrumental(e.target.checked)}
                    className="accent-indigo-600"
                  />
                  <span>{t.audio.instrumental}</span>
                </label>
              </>
            )}

            {(tab === 'tts' || tab === 'clone') && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Text</label>
                  <textarea
                    required
                    rows={4}
                    value={ttsText}
                    onChange={(e) => setTtsText(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-sm"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      {t.audio.voice}
                    </label>
                    <input
                      value={voice}
                      onChange={(e) => setVoice(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      {t.audio.speed}
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.5"
                      max="2.0"
                      value={speed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      {t.audio.format}
                    </label>
                    <select
                      value={format}
                      onChange={(e) => setFormat(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
                    >
                      <option value="mp3">mp3</option>
                      <option value="wav">wav</option>
                      <option value="opus">opus</option>
                    </select>
                  </div>
                </div>

                {tab === 'clone' && (
                  <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                    <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-3 text-xs cursor-pointer">
                      <Upload className="w-4 h-4" />
                      <span>{cloneRefName || t.common.upload}</span>
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const res = await api.uploadFile(f, 'audio');
                          setCloneRefFileId(res.file.id);
                          setCloneRefName(res.file.name);
                        }}
                      />
                    </label>
                    <label className="flex items-start gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cloneConsent}
                        onChange={(e) => setCloneConsent(e.target.checked)}
                        className="mt-0.5 accent-indigo-600"
                      />
                      <span>{t.audio.consentLabel}</span>
                    </label>
                  </div>
                )}
              </>
            )}

            {tab === 'stt' && (
              <>
                <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-5 text-xs text-slate-500 cursor-pointer hover:border-indigo-500">
                  <Upload className="w-4 h-4" />
                  <span>{sttFile?.name || t.common.upload}</span>
                  <input
                    type="file"
                    accept="audio/*,video/*"
                    className="hidden"
                    onChange={(e) => setSttFile(e.target.files?.[0] || null)}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Language ({t.common.optional})
                    </label>
                    <input
                      value={sttLanguage}
                      onChange={(e) => setSttLanguage(e.target.value)}
                      placeholder="fa / en"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      {t.audio.format}
                    </label>
                    <select
                      value={sttFormat}
                      onChange={(e) => setSttFormat(e.target.value as typeof sttFormat)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
                    >
                      <option value="json">Text (JSON)</option>
                      <option value="srt">Subtitles (SRT)</option>
                      <option value="vtt">Subtitles (VTT)</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={busy || !selectedModelKey || (tab === 'clone' && !cloneConsent)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 min-h-[44px]"
            >
              {tab === 'music' ? (
                <Music className="w-4 h-4" />
              ) : tab === 'stt' ? (
                <Mic className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
              <span>
                {busy
                  ? t.common.loading
                  : tab === 'music'
                    ? t.audio.generateMusic
                    : tab === 'stt'
                      ? t.audio.transcribe
                      : t.audio.synthesize}
              </span>
            </button>
          </form>

          {/* Audio Outputs History */}
          <div className="lg:col-span-7 space-y-4">
            <h2 className="text-base font-semibold">{t.audio.history}</h2>
            {jobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center text-sm text-slate-500">
                {t.common.noData}
              </div>
            ) : (
              <div className="space-y-3">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-mono">
                        {job.kind.toUpperCase()} · {job.modelKey.split('::')[1]}
                      </span>
                      <span>{job.status}</span>
                    </div>
                    <p className="text-sm">{job.prompt}</p>
                    {job.error && <p className="text-xs text-red-500">{job.error}</p>}
                    {job.textOutput && (
                      <pre className="rounded-xl bg-slate-100 dark:bg-slate-950 p-3 text-xs whitespace-pre-wrap max-h-60 overflow-y-auto">
                        {job.textOutput}
                      </pre>
                    )}
                    {job.resultFiles.map((f) => (
                      <div key={f.id} className="flex flex-wrap items-center gap-3">
                        <audio controls src={f.url} className="flex-1 min-w-[220px]" />
                        <a
                          href={`${f.url}?download=1`}
                          download={f.name}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
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
