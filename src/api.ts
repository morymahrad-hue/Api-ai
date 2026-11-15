import type {
  AdapterType,
  ApiLogDTO,
  AttachmentRef,
  ChatMessageDTO,
  ChatStudioMode,
  ConversationDTO,
  LibraryFileDTO,
  LibraryFolder,
  MediaJobDTO,
  ModelCapabilities,
  ModelDTO,
  ProviderDTO,
  ProviderPaths,
  StudioSettings,
} from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error((data.error as string) || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  // Providers
  listProviders: () => request<{ providers: ProviderDTO[] }>('/api/providers'),
  createProvider: (body: {
    name: string;
    adapterType: AdapterType;
    baseUrl: string;
    apiKey: string;
    customHeaders?: Record<string, string>;
    customPaths?: ProviderPaths;
    autoFetchModels?: boolean;
  }) =>
    request<{
      provider: ProviderDTO;
      connection: { ok: boolean; latencyMs: number; modelCount?: number; error?: string };
      fetchedCount: number;
      fetchError: string | null;
    }>('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  updateProvider: (
    id: string,
    body: Partial<{
      name: string;
      adapterType: AdapterType;
      baseUrl: string;
      apiKey: string;
      customHeaders: Record<string, string>;
      customPaths: ProviderPaths;
      isActive: boolean;
    }>
  ) =>
    request<{ provider: ProviderDTO }>(`/api/providers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  deleteProvider: (id: string) =>
    request<{ ok: boolean }>(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testProvider: (id: string) =>
    request<{
      provider: ProviderDTO;
      result: { ok: boolean; latencyMs: number; modelCount?: number; error?: string };
    }>(`/api/providers/${encodeURIComponent(id)}/test`, { method: 'POST' }),
  fetchProviderModels: (id: string) =>
    request<{ ok: boolean; count: number; models: ModelDTO[] }>(
      `/api/providers/${encodeURIComponent(id)}/fetch-models`,
      { method: 'POST' }
    ),

  // Models
  listModels: (params?: { providerId?: string; enabledOnly?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.providerId) q.set('providerId', params.providerId);
    if (params?.enabledOnly) q.set('enabledOnly', 'true');
    const qs = q.toString();
    return request<{ models: ModelDTO[] }>(`/api/models${qs ? `?${qs}` : ''}`);
  },
  addManualModel: (body: {
    providerId: string;
    modelId: string;
    displayName?: string;
    category?: string;
    capabilities?: Partial<ModelCapabilities>;
  }) =>
    request<{ model: ModelDTO }>('/api/models/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  updateModel: (
    id: string,
    body: Partial<{
      isEnabled: boolean;
      isDefault: boolean;
      capabilities: Partial<ModelCapabilities>;
      category: string;
      displayName: string;
    }>
  ) =>
    request<{ model: ModelDTO }>(`/api/models/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  testModel: (id: string) =>
    request<{
      result: { ok: boolean; latencyMs: number; sampleReply?: string; error?: string };
      model: ModelDTO;
    }>(`/api/models/${encodeURIComponent(id)}/test`, { method: 'POST' }),
  deleteModel: (id: string) =>
    request<{ ok: boolean }>(`/api/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Conversations & Messages
  listConversations: () => request<{ conversations: ConversationDTO[] }>('/api/conversations'),
  createConversation: (body: Partial<ConversationDTO>) =>
    request<{ conversation: ConversationDTO }>('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  updateConversation: (id: string, body: Partial<ConversationDTO>) =>
    request<{ conversation: ConversationDTO }>(`/api/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  deleteConversation: (id: string) =>
    request<{ ok: boolean }>(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  clearConversations: () => request<{ ok: boolean }>('/api/conversations', { method: 'DELETE' }),
  listMessages: (conversationId: string) =>
    request<{ messages: ChatMessageDTO[] }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`
    ),
  updateMessage: (id: string, content: string) =>
    request<{ ok: boolean }>(`/api/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  deleteMessagesAfter: (id: string) =>
    request<{ ok: boolean }>(`/api/messages/${encodeURIComponent(id)}/after`, { method: 'DELETE' }),

  // Upload
  uploadFile: async (file: File, folder: LibraryFolder = 'uploads') => {
    const form = new FormData();
    form.append('file', file);
    form.append('folder', folder);
    return request<{ file: LibraryFileDTO; attachment: AttachmentRef }>('/api/files/upload', {
      method: 'POST',
      body: form,
    });
  },

  // Streaming Chat
  streamChat: async (
    payload: {
      conversationId: string;
      modelKey: string;
      userText: string;
      attachments?: AttachmentRef[];
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      skipSaveUserMessage?: boolean;
      studioMode?: ChatStudioMode;
    },
    handlers: {
      signal?: AbortSignal;
      onDelta: (text: string) => void;
      onStatus?: (statusText: string) => void;
      onDone: (message?: ChatMessageDTO) => void;
      onError: (err: string) => void;
    }
  ) => {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: handlers.signal,
    });
    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Stream unavailable');
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        try {
          const evt = JSON.parse(line.slice(5).trim()) as {
            type: 'delta' | 'status' | 'done' | 'error';
            text?: string;
            message?: ChatMessageDTO;
            error?: string;
          };
          if (evt.type === 'delta' && evt.text) handlers.onDelta(evt.text);
          else if (evt.type === 'status' && evt.text) handlers.onStatus?.(evt.text);
          else if (evt.type === 'done') handlers.onDone(evt.message);
          else if (evt.type === 'error') handlers.onError(evt.error || 'Unknown streaming error');
        } catch {
          // ignore malformed chunk
        }
      }
    }
  },

  // Image Studio
  listImageJobs: () => request<{ jobs: MediaJobDTO[] }>('/api/studio/image/jobs'),
  generateImage: (body: {
    modelKey: string;
    prompt: string;
    negativePrompt?: string;
    size?: string;
    aspectRatio?: string;
    quality?: string;
    n?: number;
    mode?: 'txt2img' | 'img2img' | 'inpaint' | 'remove_bg';
    referenceFileId?: string;
    maskBase64?: string;
  }) =>
    request<{ job: MediaJobDTO }>('/api/studio/image/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // Video Studio
  listVideoJobs: () => request<{ jobs: MediaJobDTO[] }>('/api/studio/video/jobs'),
  generateVideo: (body: {
    modelKey: string;
    prompt: string;
    mode?: 'txt2vid' | 'img2vid' | 'vid2vid';
    durationSec?: number;
    aspectRatio?: string;
    quality?: string;
    referenceFileId?: string;
  }) =>
    request<{ job: MediaJobDTO }>('/api/studio/video/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  pollVideoJob: (id: string) =>
    request<{ job: MediaJobDTO }>(`/api/studio/video/jobs/${encodeURIComponent(id)}/poll`, {
      method: 'POST',
    }),

  // Audio & Music Studio
  listAudioJobs: () => request<{ jobs: MediaJobDTO[] }>('/api/studio/audio/jobs'),
  generateTts: (body: {
    modelKey: string;
    text: string;
    voice?: string;
    speed?: number;
    format?: string;
    voiceCloneConsent?: boolean;
    referenceFileId?: string;
  }) =>
    request<{ job: MediaJobDTO }>('/api/studio/audio/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  transcribeStt: async (body: {
    modelKey: string;
    file?: File;
    fileId?: string;
    language?: string;
    responseFormat?: 'json' | 'srt' | 'vtt' | 'text';
  }) => {
    const form = new FormData();
    form.append('modelKey', body.modelKey);
    if (body.file) form.append('file', body.file);
    if (body.fileId) form.append('fileId', body.fileId);
    if (body.language) form.append('language', body.language);
    if (body.responseFormat) form.append('responseFormat', body.responseFormat);
    return request<{ job: MediaJobDTO }>('/api/studio/audio/stt', { method: 'POST', body: form });
  },
  generateMusic: (body: {
    modelKey: string;
    prompt: string;
    style?: string;
    instrumental?: boolean;
    durationSec?: number;
    mode?: 'music' | 'beat' | 'ambient' | 'sfx' | 'vocals';
  }) =>
    request<{ job: MediaJobDTO }>('/api/studio/audio/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // Code Studio ZIP Export
  exportCodeZip: async (projectName: string, files: Array<{ path: string; content: string }>) => {
    const res = await fetch('/api/studio/code/export-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName, files, saveToLibrary: true }),
    });
    if (!res.ok) throw new Error('Failed generating ZIP archive');
    return res.blob();
  },

  // Tools
  convertFormat: async (body: {
    targetFormat: 'json' | 'csv' | 'xml' | 'txt' | 'markdown';
    rawText?: string;
    sourceFormat?: 'json' | 'csv' | 'xlsx' | 'txt';
    file?: File;
  }) => {
    if (body.file) {
      const form = new FormData();
      form.append('file', body.file);
      form.append('targetFormat', body.targetFormat);
      return request<{ output: string }>('/api/tools/convert', { method: 'POST', body: form });
    }
    return request<{ output: string }>('/api/tools/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  analyzeData: async (body: { file?: File; rawText?: string }) => {
    if (body.file) {
      const form = new FormData();
      form.append('file', body.file);
      return request<{
        rowCount: number;
        columnCount: number;
        summary: Array<{
          column: string;
          nonNull: number;
          nullCount: number;
          type: string;
          min: number | null;
          max: number | null;
          mean: number | null;
        }>;
        sampleRows: Array<Record<string, unknown>>;
      }>('/api/tools/analyze-data', { method: 'POST', body: form });
    }
    return request<{
      rowCount: number;
      columnCount: number;
      summary: Array<{
        column: string;
        nonNull: number;
        nullCount: number;
        type: string;
        min: number | null;
        max: number | null;
        mean: number | null;
      }>;
      sampleRows: Array<Record<string, unknown>>;
    }>('/api/tools/analyze-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText: body.rawText }),
    });
  },
  fetchUrlText: (url: string) =>
    request<{ url: string; title: string; text: string }>('/api/tools/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }),
  webSearch: (query: string) =>
    request<{ results: Array<{ title: string; url: string; snippet: string }> }>(
      '/api/tools/web-search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      }
    ),

  // Library
  listLibrary: (folder?: LibraryFolder, search?: string) => {
    const q = new URLSearchParams();
    if (folder) q.set('folder', folder);
    if (search) q.set('search', search);
    return request<{ files: LibraryFileDTO[] }>(`/api/library${q.toString() ? `?${q}` : ''}`);
  },
  renameLibraryFile: (id: string, name: string) =>
    request<{ file: LibraryFileDTO }>(`/api/library/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  deleteLibraryFile: (id: string) =>
    request<{ ok: boolean }>(`/api/library/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Usage
  getUsage: () =>
    request<{
      summary: {
        totalRequests: number;
        errorCount: number;
        tokensPrompt: number;
        tokensCompletion: number;
        tokensTotal: number;
        avgLatencyMs: number | null;
        totalCost: number | null;
        costCount: number;
      };
      byModel: Array<{
        modelId: string;
        providerName: string;
        requests: number;
        errors: number;
        tokensTotal: number;
        avgLatencyMs: number | null;
        totalCost: number | null;
      }>;
      logs: ApiLogDTO[];
    }>('/api/usage'),
  clearUsage: () => request<{ ok: boolean }>('/api/usage', { method: 'DELETE' }),

  // Settings
  getSettings: () => request<{ settings: StudioSettings }>('/api/settings'),
  saveSettings: (settings: Partial<StudioSettings>) =>
    request<{ settings: StudioSettings }>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),
};
