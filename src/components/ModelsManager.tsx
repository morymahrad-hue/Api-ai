import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Play,
  Plus,
  Search,
  Sliders,
  Star,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import type { Lang } from '../i18n';
import { translations } from '../i18n';
import type { ModelCapabilities, ModelDTO, ProviderDTO } from '../types';

interface Props {
  lang: Lang;
  models: ModelDTO[];
  providers: ProviderDTO[];
  onRefreshData: () => Promise<void>;
}

const CAP_KEYS: Array<keyof ModelCapabilities> = [
  'chat',
  'streaming',
  'vision',
  'imageGen',
  'imageEdit',
  'inpainting',
  'backgroundRemoval',
  'videoGen',
  'imageToVideo',
  'videoToVideo',
  'audioTts',
  'audioStt',
  'musicGen',
  'voiceClone',
  'tools',
  'jsonMode',
];

export function ModelsManager({ lang, models, providers, onRefreshData }: Props) {
  const t = translations[lang];
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testNotice, setTestNotice] = useState<string | null>(null);

  // Manual add modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProviderId, setNewProviderId] = useState(providers[0]?.id || '');
  const [newModelId, setNewModelId] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newCategory, setNewCategory] = useState('chat');

  // Capability editor modal
  const [editingModel, setEditingModel] = useState<ModelDTO | null>(null);
  const [editCaps, setEditCaps] = useState<ModelCapabilities | null>(null);
  const [editCat, setEditCat] = useState('chat');

  const filtered = useMemo(() => {
    return models.filter((m) => {
      if (providerFilter !== 'all' && m.providerId !== providerFilter) return false;
      if (categoryFilter !== 'all' && m.category !== categoryFilter) return false;
      if (
        search.trim() &&
        !m.modelId.toLowerCase().includes(search.toLowerCase()) &&
        !m.displayName.toLowerCase().includes(search.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [models, providerFilter, categoryFilter, search]);

  async function handleToggleEnable(m: ModelDTO) {
    await api.updateModel(m.id, { isEnabled: !m.isEnabled });
    await onRefreshData();
  }

  async function handleSetDefault(m: ModelDTO) {
    await api.updateModel(m.id, { isDefault: true, isEnabled: true });
    await onRefreshData();
  }

  async function handleTestModel(m: ModelDTO) {
    setTestingId(m.id);
    setTestNotice(null);
    try {
      const res = await api.testModel(m.id);
      setTestNotice(
        res.result.ok
          ? `${m.modelId}: OK (${res.result.latencyMs}ms) — "${res.result.sampleReply}"`
          : `${m.modelId}: ${res.result.error}`
      );
      await onRefreshData();
    } catch (err) {
      setTestNotice(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTestingId(null);
    }
  }

  async function handleAddManual(e: React.FormEvent) {
    e.preventDefault();
    const pid = newProviderId || providers[0]?.id;
    if (!pid || !newModelId.trim()) return;
    await api.addManualModel({
      providerId: pid,
      modelId: newModelId.trim(),
      displayName: newDisplayName.trim() || newModelId.trim(),
      category: newCategory,
      capabilities: { chat: newCategory === 'chat' || newCategory === 'code' || newCategory === 'reasoning' },
    });
    setShowAddModal(false);
    setNewModelId('');
    setNewDisplayName('');
    await onRefreshData();
  }

  async function handleSaveCapabilities() {
    if (!editingModel || !editCaps) return;
    await api.updateModel(editingModel.id, { capabilities: editCaps, category: editCat });
    setEditingModel(null);
    await onRefreshData();
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t.models.title}</h1>
            <p className="text-xs text-slate-500 mt-1">{t.models.noGuessNote}</p>
          </div>
          <button
            type="button"
            disabled={providers.length === 0}
            onClick={() => {
              setNewProviderId(providers[0]?.id || '');
              setShowAddModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40 min-h-[42px]"
          >
            <Plus className="w-4 h-4" />
            <span>{t.models.addManual}</span>
          </button>
        </div>

        {testNotice && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-xs font-mono">
            {testNotice}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.common.search}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] ps-9 pe-3 py-2.5 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] px-3 py-2.5 text-xs font-medium min-h-[42px]"
          >
            <option value="all">{t.models.filterProvider}: {t.common.all}</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] px-3 py-2.5 text-xs font-medium min-h-[42px]"
          >
            <option value="all">{t.models.filterCategory}: {t.common.all}</option>
            {['chat', 'reasoning', 'vision', 'code', 'image', 'video', 'audio', 'music', 'embedding', 'other'].map(
              (cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              )
            )}
          </select>
        </div>

        {/* Models Table / Cards */}
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-10 text-center text-sm text-slate-500">
            {t.common.noData}
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((m) => {
              const activeCaps = CAP_KEYS.filter((k) => m.capabilities[k]);
              return (
                <div
                  key={m.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm">{m.displayName}</span>
                      {m.isDefault && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500">
                          <Star className="w-3.5 h-3.5 fill-current" />
                          {t.models.setDefault}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono">
                      <span dir="ltr">{m.modelId}</span>
                      <span>·</span>
                      <span>{m.providerName}</span>
                      <span>·</span>
                      <span>{m.category}</span>
                      <span>·</span>
                      <span>{t.models.source[m.capabilitiesSource]}</span>
                      {m.contextLength ? (
                        <>
                          <span>·</span>
                          <span>{m.contextLength.toLocaleString()} ctx</span>
                        </>
                      ) : null}
                    </div>
                    {activeCaps.length > 0 && (
                      <p className="text-xs text-indigo-600 dark:text-indigo-400">
                        {activeCaps.join(' · ')}
                      </p>
                    )}
                    {m.lastError && (
                      <p className="text-xs text-red-500 flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{m.lastError}</span>
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={testingId === m.id}
                      onClick={() => handleTestModel(m)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[36px]"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{testingId === m.id ? t.common.loading : t.models.testModel}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingModel(m);
                        setEditCaps({ ...m.capabilities });
                        setEditCat(m.category);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[36px]"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>{t.models.editCapabilities}</span>
                    </button>
                    {!m.isDefault && (
                      <button
                        type="button"
                        onClick={() => handleSetDefault(m)}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[36px]"
                      >
                        {t.models.setDefault}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleToggleEnable(m)}
                      className={`inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-medium min-h-[36px] ${
                        m.isEnabled
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                      }`}
                    >
                      {m.isEnabled && <CheckCircle2 className="w-3.5 h-3.5" />}
                      <span>{m.isEnabled ? t.models.enabled : t.models.disabled}</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.deleteModel(m.id);
                        await onRefreshData();
                      }}
                      className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add Manual Model Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <form
              onSubmit={handleAddManual}
              className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{t.models.addManual}</h3>
                <button type="button" onClick={() => setShowAddModal(false)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Provider</label>
                <select
                  value={newProviderId}
                  onChange={(e) => setNewProviderId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Model ID</label>
                <input
                  required
                  dir="ltr"
                  value={newModelId}
                  onChange={(e) => setNewModelId(e.target.value)}
                  placeholder="e.g. gpt-4o or black-forest-labs/FLUX.1-dev"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Display Name</label>
                <input
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  {['chat', 'reasoning', 'vision', 'code', 'image', 'video', 'audio', 'music', 'other'].map(
                    (c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    )
                  )}
                </select>
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                {t.common.save}
              </button>
            </form>
          </div>
        )}

        {/* Capability Editor Modal */}
        {editingModel && editCaps && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm font-mono">{editingModel.modelId}</h3>
                <button type="button" onClick={() => setEditingModel(null)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>
                <select
                  value={editCat}
                  onChange={(e) => setEditCat(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  {['chat', 'reasoning', 'vision', 'code', 'image', 'video', 'audio', 'music', 'embedding', 'other'].map(
                    (c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    )
                  )}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2.5 max-h-72 overflow-y-auto">
                {CAP_KEYS.map((cap) => (
                  <label
                    key={cap}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={editCaps[cap]}
                      onChange={(e) =>
                        setEditCaps((prev) => (prev ? { ...prev, [cap]: e.target.checked } : prev))
                      }
                      className="accent-indigo-600"
                    />
                    <span className="font-mono">{cap}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingModel(null)}
                  className="rounded-xl px-4 py-2 text-xs text-slate-500"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleSaveCapabilities}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500"
                >
                  {t.common.save}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
