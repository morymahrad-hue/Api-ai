import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Columns2,
  Copy,
  Download,
  Edit3,
  FileArchive,
  FileText,
  Film,
  Image as ImageIcon,
  Layers,
  MessageSquare,
  MessageSquarePlus,
  Music,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { Lang } from '../i18n';
import { translations } from '../i18n';
import type {
  ActiveView,
  AttachmentRef,
  ChatMessageDTO,
  ChatStudioMode,
  ConversationDTO,
  ModelDTO,
  StudioSettings,
} from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface Props {
  lang: Lang;
  models: ModelDTO[];
  settings: StudioSettings;
  onUpdateSettings: (next: Partial<StudioSettings>) => Promise<void>;
  onNavigate: (view: ActiveView) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function ChatWorkspace({ lang, models, settings, onUpdateSettings, onNavigate }: Props) {
  const t = translations[lang];
  const enabledModels = useMemo(() => models.filter((m) => m.isEnabled), [models]);
  const defaultModel = useMemo(
    () => enabledModels.find((m) => m.isDefault) || enabledModels[0] || null,
    [enabledModels]
  );

  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);

  // Model & Unified Studio mode state
  const [isMultiModel, setIsMultiModel] = useState(false);
  const [studioMode, setStudioMode] = useState<ChatStudioMode>('auto');
  const [selectedModelKey, setSelectedModelKey] = useState<string>('');
  const [multiModelKeys, setMultiModelKeys] = useState<string[]>([]);
  const [showParamsDrawer, setShowParamsDrawer] = useState(false);
  const [showStudioModelsDrawer, setShowStudioModelsDrawer] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);

  // Composer state
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Streaming state per modelKey
  const [streamingMap, setStreamingMap] = useState<Record<string, string>>({});
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllersRef = useRef<AbortController[]>([]);

  // Rename / Edit state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (!selectedModelKey && defaultModel) {
      setSelectedModelKey(defaultModel.id);
    }
    if (multiModelKeys.length === 0 && enabledModels.length > 0) {
      setMultiModelKeys(enabledModels.slice(0, 2).map((m) => m.id));
    }
  }, [defaultModel, enabledModels, selectedModelKey, multiModelKeys.length]);

  useEffect(() => {
    if (activeConvId) {
      api.listMessages(activeConvId).then((res) => setMessages(res.messages)).catch(() => {});
      const conv = conversations.find((c) => c.id === activeConvId);
      if (conv) {
        setSystemPrompt(conv.systemPrompt);
        setTemperature(conv.temperature);
        setMaxTokens(conv.maxTokens);
        setIsMultiModel(conv.mode === 'multi_model');
        if (conv.activeModelKeys.length > 0) {
          setSelectedModelKey(conv.activeModelKeys[0]);
          if (conv.mode === 'multi_model') setMultiModelKeys(conv.activeModelKeys);
        }
      }
    } else {
      setMessages([]);
    }
  }, [activeConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingMap, statusNotice]);

  async function loadConversations() {
    const res = await api.listConversations();
    const chatConvs = res.conversations.filter((c) => c.mode !== 'code');
    setConversations(chatConvs);
    if (!activeConvId && chatConvs.length > 0) {
      setActiveConvId(chatConvs[0].id);
    }
  }

  async function handleNewChat() {
    const res = await api.createConversation({
      title: lang === 'fa' ? 'گفتگوی جدید' : 'New Chat',
      mode: isMultiModel ? 'multi_model' : 'chat',
      activeModelKeys: isMultiModel
        ? multiModelKeys
        : selectedModelKey
          ? [selectedModelKey]
          : [],
    });
    setConversations((prev) => [res.conversation, ...prev]);
    setActiveConvId(res.conversation.id);
    setMessages([]);
    setShowHistoryDrawer(false);
  }

  async function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        const res = await api.uploadFile(file, 'uploads');
        setAttachments((prev) => [...prev, res.attachment]);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function ensureActiveConversation(): Promise<string> {
    if (activeConvId) return activeConvId;
    const res = await api.createConversation({
      title: inputText.trim().slice(0, 42) || (lang === 'fa' ? 'گفتگوی جدید' : 'New Chat'),
      mode: isMultiModel ? 'multi_model' : 'chat',
      activeModelKeys: isMultiModel
        ? multiModelKeys
        : selectedModelKey
          ? [selectedModelKey]
          : [],
    });
    setConversations((prev) => [res.conversation, ...prev]);
    setActiveConvId(res.conversation.id);
    return res.conversation.id;
  }

  async function sendToModels(
    convId: string,
    text: string,
    atts: AttachmentRef[],
    targetKeys: string[],
    skipSaveUser = false
  ) {
    if (targetKeys.length === 0) return;
    setIsStreaming(true);
    setStreamingMap({});
    setStatusNotice(null);
    const controllers: AbortController[] = [];
    abortControllersRef.current = controllers;

    if (!skipSaveUser) {
      const optimisticUser: ChatMessageDTO = {
        id: `temp-${Date.now()}`,
        conversationId: convId,
        role: 'user',
        content: text,
        modelKey: null,
        providerName: null,
        attachments: atts,
        tokensPrompt: null,
        tokensCompletion: null,
        tokensTotal: null,
        durationMs: null,
        costEstimate: null,
        error: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticUser]);
    }

    await Promise.all(
      targetKeys.map(async (mKey, idx) => {
        const ctrl = new AbortController();
        controllers.push(ctrl);
        try {
          await api.streamChat(
            {
              conversationId: convId,
              modelKey: mKey,
              userText: text,
              attachments: atts,
              systemPrompt,
              temperature,
              maxTokens,
              skipSaveUserMessage: skipSaveUser || idx > 0,
              studioMode: isMultiModel ? 'chat' : studioMode,
            },
            {
              signal: ctrl.signal,
              onDelta: (chunk) => {
                setStreamingMap((prev) => ({ ...prev, [mKey]: (prev[mKey] || '') + chunk }));
              },
              onStatus: (statusText) => {
                setStatusNotice(statusText);
              },
              onDone: () => {},
              onError: (err) => {
                setStreamingMap((prev) => ({
                  ...prev,
                  [mKey]: (prev[mKey] ? prev[mKey] + '\n\n' : '') + `[${t.common.error}: ${err}]`,
                }));
              },
            }
          );
        } catch (err) {
          if (!ctrl.signal.aborted) {
            const msg = err instanceof Error ? err.message : 'Streaming failed';
            setStreamingMap((prev) => ({ ...prev, [mKey]: `[${t.common.error}: ${msg}]` }));
          }
        }
      })
    );

    setIsStreaming(false);
    setStreamingMap({});
    setStatusNotice(null);
    abortControllersRef.current = [];
    const refreshed = await api.listMessages(convId);
    setMessages(refreshed.messages);
    loadConversations();
  }

  async function handleSend() {
    if (isStreaming) return;
    if (!inputText.trim() && attachments.length === 0) return;
    const targets = isMultiModel
      ? multiModelKeys
      : selectedModelKey
        ? [selectedModelKey]
        : enabledModels[0]
          ? [enabledModels[0].id]
          : [];
    if (targets.length === 0) return;

    const convId = await ensureActiveConversation();
    const text = inputText.trim();
    const atts = [...attachments];
    setInputText('');
    setAttachments([]);
    await sendToModels(convId, text, atts, targets, false);
  }

  function handleStop() {
    for (const ctrl of abortControllersRef.current) {
      ctrl.abort();
    }
    setIsStreaming(false);
    setStatusNotice(null);
  }

  async function handleRegenerate(msg: ChatMessageDTO) {
    if (!activeConvId || isStreaming) return;
    const idx = messages.findIndex((m) => m.id === msg.id);
    if (idx === -1) return;
    const prevUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
    if (!prevUser) return;
    await api.deleteMessagesAfter(prevUser.id);
    const updated = await api.listMessages(activeConvId);
    setMessages(updated.messages);
    const target = msg.modelKey || selectedModelKey;
    if (target) {
      await sendToModels(activeConvId, prevUser.content, prevUser.attachments, [target], true);
    }
  }

  async function handleSaveEdit(msg: ChatMessageDTO) {
    if (!activeConvId || !editingText.trim()) return;
    await api.updateMessage(msg.id, editingText.trim());
    if (msg.role === 'user') {
      await api.deleteMessagesAfter(msg.id);
      const updated = await api.listMessages(activeConvId);
      setMessages(updated.messages);
      setEditingMsgId(null);
      const targets = isMultiModel
        ? multiModelKeys
        : selectedModelKey
          ? [selectedModelKey]
          : [];
      if (targets.length) {
        await sendToModels(activeConvId, editingText.trim(), msg.attachments, targets, true);
      }
    } else {
      const updated = await api.listMessages(activeConvId);
      setMessages(updated.messages);
      setEditingMsgId(null);
    }
  }

  async function handleSaveParams() {
    if (!activeConvId) {
      setShowParamsDrawer(false);
      return;
    }
    await api.updateConversation(activeConvId, {
      systemPrompt,
      temperature,
      maxTokens,
      mode: isMultiModel ? 'multi_model' : 'chat',
      activeModelKeys: isMultiModel ? multiModelKeys : [selectedModelKey],
    });
    setShowParamsDrawer(false);
  }

  async function handleRenameConv(id: string) {
    if (!renameText.trim()) {
      setRenamingId(null);
      return;
    }
    await api.updateConversation(id, { title: renameText.trim() });
    setRenamingId(null);
    loadConversations();
  }

  async function handleDeleteConv(id: string) {
    await api.deleteConversation(id);
    if (activeConvId === id) {
      setActiveConvId(null);
      setMessages([]);
    }
    loadConversations();
  }

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  function copyMessage(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  }

  const studioModeItems: Array<{ id: ChatStudioMode; label: string; icon: typeof Sparkles }> = [
    { id: 'auto', label: t.chat.studioModes.auto, icon: Sparkles },
    { id: 'chat', label: t.chat.studioModes.chat, icon: MessageSquare },
    { id: 'image', label: t.chat.studioModes.image, icon: ImageIcon },
    { id: 'video', label: t.chat.studioModes.video, icon: Film },
    { id: 'tts', label: t.chat.studioModes.tts, icon: Volume2 },
    { id: 'music', label: t.chat.studioModes.music, icon: Music },
    { id: 'code', label: t.chat.studioModes.code, icon: Code2 },
  ];

  const streamingEntries = Object.entries(streamingMap);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Conversation History Column (Desktop) / Drawer (Mobile) */}
      <div
        className={`${
          showHistoryDrawer ? 'fixed inset-0 z-40 flex' : 'hidden lg:flex'
        } lg:static lg:w-72 shrink-0`}
      >
        {showHistoryDrawer && (
          <div
            className="fixed inset-0 bg-black/50 lg:hidden"
            onClick={() => setShowHistoryDrawer(false)}
          />
        )}
        <aside className="relative z-10 flex h-full w-72 flex-col border-e border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B101B]">
          <div className="p-3.5 border-b border-slate-200 dark:border-slate-800/80 space-y-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleNewChat}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors min-h-[42px]"
              >
                <MessageSquarePlus className="w-4 h-4" />
                <span>{t.chat.newChat}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowHistoryDrawer(false)}
                className="lg:hidden rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t.chat.searchChats}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 ps-9 pe-3 py-2 text-xs outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredConversations.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">{t.common.noData}</p>
            ) : (
              filteredConversations.map((c) => {
                const isActive = c.id === activeConvId;
                return (
                  <div
                    key={c.id}
                    className={`group flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-200 font-medium'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900/60'
                    }`}
                    onClick={() => {
                      setActiveConvId(c.id);
                      setShowHistoryDrawer(false);
                    }}
                  >
                    {renamingId === c.id ? (
                      <input
                        autoFocus
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onBlur={() => handleRenameConv(c.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameConv(c.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 rounded bg-white dark:bg-slate-900 px-2 py-1 text-xs border border-indigo-500 outline-none"
                      />
                    ) : (
                      <span className="truncate flex-1">{c.title}</span>
                    )}
                    <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(c.id);
                          setRenameText(c.title);
                        }}
                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteConv(c.id);
                        }}
                        className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-950/60 text-slate-400 hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>

      {/* Main Chat Pane */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-[#080C14]">
        {/* Chat Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800/80 bg-white/80 dark:bg-[#0B101B]/80 backdrop-blur-md px-4 py-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowHistoryDrawer(true)}
              className="lg:hidden rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs font-medium min-h-[40px]"
            >
              {t.chat.newChat} ({conversations.length})
            </button>

            {/* Single vs Multi-Model Switch */}
            <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 p-1">
              <button
                type="button"
                onClick={() => setIsMultiModel(false)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  !isMultiModel
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {t.chat.singleModel}
              </button>
              <button
                type="button"
                onClick={() => setIsMultiModel(true)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  isMultiModel
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Columns2 className="w-3.5 h-3.5" />
                <span>{t.chat.multiModel}</span>
              </button>
            </div>

            {!isMultiModel ? (
              <select
                value={selectedModelKey}
                onChange={(e) => {
                  const next = e.target.value;
                  setSelectedModelKey(next);
                  if (activeConvId) {
                    api.updateConversation(activeConvId, { activeModelKeys: [next] });
                  }
                }}
                className="max-w-[260px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium outline-none focus:border-indigo-500 min-h-[40px]"
              >
                {enabledModels.length === 0 && (
                  <option value="">{t.common.selectModel}</option>
                )}
                {enabledModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.providerName})
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {enabledModels.slice(0, 6).map((m) => {
                  const checked = multiModelKeys.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        setMultiModelKeys((prev) =>
                          prev.includes(m.id)
                            ? prev.filter((k) => k !== m.id)
                            : [...prev, m.id].slice(0, 4)
                        )
                      }
                      className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap ${
                        checked
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200 font-medium'
                          : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {m.displayName}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowStudioModelsDrawer((v) => !v);
                setShowParamsDrawer(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 min-h-[40px]"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-500" />
              <span>{t.chat.studioModels}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowParamsDrawer((v) => !v);
                setShowStudioModelsDrawer(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 min-h-[40px]"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.chat.chatSettings}</span>
            </button>
          </div>
        </div>

        {/* Studio Models Assignment Drawer */}
        {showStudioModelsDrawer && (
          <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">{t.chat.studioRoutingNote}</p>
              <button
                type="button"
                onClick={() => setShowStudioModelsDrawer(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(
                [
                  ['preferredImageModelKey', t.chat.studioModes.image],
                  ['preferredVideoModelKey', t.chat.studioModes.video],
                  ['preferredTtsModelKey', t.chat.studioModes.tts],
                  ['preferredMusicModelKey', t.chat.studioModes.music],
                ] as const
              ).map(([field, label]) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                  <select
                    value={settings[field] || ''}
                    onChange={(e) => onUpdateSettings({ [field]: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 py-2 text-xs"
                  >
                    <option value="">Auto</option>
                    {enabledModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName} ({m.providerName})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Parameters Drawer */}
        {showParamsDrawer && (
          <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t.chat.systemPrompt}
                </label>
                <textarea
                  rows={2}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    {t.chat.temperature} ({temperature})
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    className="w-full accent-indigo-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    {t.chat.maxTokens}
                  </label>
                  <input
                    type="number"
                    min="64"
                    max="128000"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-sm font-mono tabular-nums"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowParamsDrawer(false)}
                className="rounded-xl px-3.5 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={handleSaveParams}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500"
              >
                {t.common.save}
              </button>
            </div>
          </div>
        )}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-4xl space-y-6">
            {enabledModels.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-8 text-center space-y-4">
                <h3 className="text-lg font-semibold">{t.common.noModelsConnected}</h3>
                <button
                  type="button"
                  onClick={() => onNavigate('settings')}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  {t.common.goToGateway}
                </button>
              </div>
            ) : messages.length === 0 && streamingEntries.length === 0 && !statusNotice ? (
              <div className="py-16 text-center space-y-3">
                <h2 className="text-2xl font-bold tracking-tight">{t.chat.emptyTitle}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
                  {t.chat.emptyDesc}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{t.chat.attachHint}</p>
              </div>
            ) : (
              <>
                {messages.map((m) => {
                  const isUser = m.role === 'user';
                  const modelMeta = m.modelKey ? models.find((x) => x.id === m.modelKey) : null;
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[92%] md:max-w-[85%] rounded-2xl px-4 py-3.5 ${
                          isUser
                            ? 'bg-indigo-600 text-white'
                            : 'w-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1422] text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {!isUser && (
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {modelMeta?.displayName || m.modelKey?.split('::')[1] || 'AI'}
                              {m.providerName ? ` · ${m.providerName}` : ''}
                            </span>
                            <div className="flex items-center gap-2 font-mono tabular-nums">
                              {m.tokensTotal !== null && (
                                <span>
                                  {m.tokensTotal} {t.chat.tokens}
                                </span>
                              )}
                              {m.durationMs !== null && (
                                <span>· {(m.durationMs / 1000).toFixed(2)}s</span>
                              )}
                              {m.costEstimate !== null && <span>· ${m.costEstimate}</span>}
                            </div>
                          </div>
                        )}

                        {editingMsgId === m.id ? (
                          <div className="space-y-2">
                            <textarea
                              rows={3}
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-sm text-slate-900 dark:text-slate-100 outline-none"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingMsgId(null)}
                                className="rounded-lg px-3 py-1.5 text-xs bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                              >
                                {t.common.cancel}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(m)}
                                className="rounded-lg px-3 py-1.5 text-xs bg-emerald-600 text-white"
                              >
                                {t.common.save}
                              </button>
                            </div>
                          </div>
                        ) : m.error && !m.content ? (
                          <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-500">
                            {m.error}
                          </div>
                        ) : isUser ? (
                          <p className="whitespace-pre-wrap text-[15px] leading-7">{m.content}</p>
                        ) : (
                          <MarkdownRenderer content={m.content} />
                        )}

                        {/* Rich Attachments Renderer (Images, Videos, Audio, Downloadable Files / ZIP / Word / Excel / PDF) */}
                        {m.attachments.length > 0 && (
                          <div className="mt-3 space-y-2.5">
                            {m.attachments.map((att) => {
                              const downloadUrl = `${att.previewUrl || `/api/library/${att.fileId}/content`}?download=1`;
                              if (att.kind === 'image' && att.previewUrl && !isUser) {
                                return (
                                  <div
                                    key={att.fileId}
                                    className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 max-w-md"
                                  >
                                    <img
                                      src={att.previewUrl}
                                      alt={att.name}
                                      referrerPolicy="no-referrer"
                                      className="w-full max-h-96 object-contain"
                                    />
                                    <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 text-xs text-slate-200">
                                      <span className="truncate font-mono">{att.name}</span>
                                      <a
                                        href={downloadUrl}
                                        download={att.name}
                                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 shrink-0"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                        <span>{t.common.download}</span>
                                      </a>
                                    </div>
                                  </div>
                                );
                              }

                              if (att.kind === 'video' && att.previewUrl && !isUser) {
                                return (
                                  <div
                                    key={att.fileId}
                                    className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-black max-w-lg"
                                  >
                                    <video
                                      controls
                                      src={att.previewUrl}
                                      className="w-full max-h-80"
                                    />
                                    <div className="flex items-center justify-between px-3 py-2 bg-slate-900 text-xs text-slate-200">
                                      <span className="truncate font-mono">{att.name}</span>
                                      <a
                                        href={downloadUrl}
                                        download={att.name}
                                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 shrink-0"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                        <span>{t.common.download}</span>
                                      </a>
                                    </div>
                                  </div>
                                );
                              }

                              if (att.kind === 'audio' && att.previewUrl && !isUser) {
                                return (
                                  <div
                                    key={att.fileId}
                                    className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-3"
                                  >
                                    <audio controls src={att.previewUrl} className="flex-1 min-w-[200px]" />
                                    <a
                                      href={downloadUrl}
                                      download={att.name}
                                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      <span>{t.common.download}</span>
                                    </a>
                                  </div>
                                );
                              }

                              return (
                                <div
                                  key={att.fileId}
                                  className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-xs ${
                                    isUser
                                      ? 'bg-indigo-500/40 text-white'
                                      : 'border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80'
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    {att.kind === 'image' && att.previewUrl ? (
                                      <img
                                        src={att.previewUrl}
                                        alt={att.name}
                                        referrerPolicy="no-referrer"
                                        className="w-9 h-9 rounded-lg object-cover shrink-0"
                                      />
                                    ) : att.kind === 'archive' ? (
                                      <FileArchive className="w-5 h-5 text-indigo-500 shrink-0" />
                                    ) : (
                                      <FileText className="w-5 h-5 text-indigo-500 shrink-0" />
                                    )}
                                    <div className="min-w-0">
                                      <p className="font-mono font-medium truncate">{att.name}</p>
                                      <p className="text-[11px] opacity-75 font-mono tabular-nums">
                                        {formatBytes(att.sizeBytes)}
                                      </p>
                                    </div>
                                  </div>
                                  <a
                                    href={downloadUrl}
                                    download={att.name}
                                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium shrink-0 ${
                                      isUser
                                        ? 'bg-white/20 hover:bg-white/30 text-white'
                                        : 'bg-indigo-600 text-white hover:bg-indigo-500'
                                    }`}
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                    <span>{t.chat.downloadFile}</span>
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {m.error && m.content && (
                          <div className="mt-2 rounded-lg bg-red-500/10 p-2 text-xs text-red-400">
                            {m.error}
                          </div>
                        )}
                      </div>

                      {/* Message Action Strip */}
                      <div className="mt-1 flex items-center gap-2 px-1 text-xs text-slate-400">
                        <button
                          type="button"
                          onClick={() => copyMessage(m.id, m.content)}
                          className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200 py-1 px-1.5"
                        >
                          {copiedId === m.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedId === m.id ? t.common.copied : t.common.copy}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMsgId(m.id);
                            setEditingText(m.content);
                          }}
                          className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200 py-1 px-1.5"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>{t.common.edit}</span>
                        </button>
                        {!isUser && (
                          <button
                            type="button"
                            onClick={() => handleRegenerate(m)}
                            className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200 py-1 px-1.5"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>{t.chat.regenerate}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Active Streaming & Studio Progress Cards */}
                {(streamingEntries.length > 0 || statusNotice) && (
                  <div
                    className={`grid gap-4 ${
                      streamingEntries.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
                    }`}
                  >
                    {streamingEntries.length > 0 ? (
                      streamingEntries.map(([mKey, text]) => {
                        const meta = models.find((x) => x.id === mKey);
                        return (
                          <div
                            key={mKey}
                            className="rounded-2xl border border-indigo-500/40 bg-white dark:bg-[#0E1422] p-4 space-y-2"
                          >
                            <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                              {meta?.displayName || mKey} · {statusNotice || t.common.loading}
                            </div>
                            <MarkdownRenderer content={text || '...'} />
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-indigo-500/40 bg-white dark:bg-[#0E1422] p-4 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                        {statusNotice}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Unified Studio Bar + Composer */}
        <div className="border-t border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B101B] p-3 sm:p-4">
          <div className="mx-auto max-w-4xl space-y-2.5">
            {/* Embedded Studio Mode Selector */}
            {!isMultiModel && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {studioModeItems.map((sm) => {
                  const Icon = sm.icon;
                  const active = studioMode === sm.id;
                  return (
                    <button
                      key={sm.id}
                      type="button"
                      onClick={() => setStudioMode(sm.id)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                        active
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200'
                          : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{sm.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {uploadError && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-500">
                {uploadError}
              </div>
            )}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((att) => (
                  <div
                    key={att.fileId}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                  >
                    {att.kind === 'image' ? (
                      <ImageIcon className="w-3.5 h-3.5 text-indigo-500" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-indigo-500" />
                    )}
                    <span className="max-w-[160px] truncate">{att.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((a) => a.fileId !== att.fileId))
                      }
                      className="text-slate-400 hover:text-red-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 p-2 focus-within:border-indigo-500">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files)}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                title={t.chat.attachHint}
                className="rounded-xl p-2.5 text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <Paperclip className="w-5 h-5" />
              </button>

              <textarea
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={t.chat.placeholder}
                className="flex-1 max-h-40 resize-none bg-transparent py-2.5 px-2 text-sm outline-none placeholder:text-slate-400"
              />

              {isStreaming ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-red-500 min-h-[44px]"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>{t.common.stop}</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={enabledModels.length === 0 || (!inputText.trim() && attachments.length === 0)}
                  onClick={handleSend}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none min-h-[44px]"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">{t.common.send}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
