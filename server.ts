import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import type {
  AdapterType,
  AttachmentRef,
  ChatStudioMode,
  LibraryFolder,
  ModelCapabilities,
  ProviderPaths,
  StudioSettings,
} from './src/types.ts';
import { getAdapter } from './server/adapters/index.ts';
import type { ChatTurnMessage } from './server/adapters/types.ts';
import {
  buildUnifiedStudioSystemAddendum,
  processUnifiedChatDirectives,
  runDirectStudioAction,
} from './server/chatStudio.ts';
import {
  encryptSecret,
  maskApiKey,
  sanitizeErrorMessage,
  validateExternalUrl,
} from './server/crypto.ts';
import {
  db,
  DEFAULT_CAPABILITIES,
  getConversationMessages,
  getLibraryFile,
  getModelByKey,
  getProviderWithKey,
  getSettings,
  listConversations,
  listLibraryFiles,
  listMediaJobs,
  listModels,
  listProviders,
  logApiCall,
  saveSettings,
} from './server/db.ts';
import {
  classifyAttachmentKind,
  extractTextFromBuffer,
  MAX_UPLOAD_BYTES,
  saveBufferToLibrary,
  validateUploadFile,
} from './server/files.ts';

const PORT = Number(process.env.PORT || 3000);
const app = express();

// Security headers & strict body limits
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '25mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// ==================== HEALTH ====================
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'MAHRAD AI STUDIO' });
});

// ==================== PROVIDERS ====================
app.get('/api/providers', (_req, res) => {
  res.json({ providers: listProviders() });
});

app.post('/api/providers', async (req: Request, res: Response) => {
  try {
    const {
      name,
      adapterType,
      baseUrl,
      apiKey,
      customHeaders,
      customPaths,
      autoFetchModels = true,
    } = req.body as {
      name?: string;
      adapterType?: AdapterType;
      baseUrl?: string;
      apiKey?: string;
      customHeaders?: Record<string, string>;
      customPaths?: ProviderPaths;
      autoFetchModels?: boolean;
    };

    if (!name?.trim()) return res.status(400).json({ error: 'Provider name is required.' });
    if (!apiKey?.trim()) return res.status(400).json({ error: 'API Key is required.' });
    const resolvedAdapter: AdapterType = adapterType || 'openai_compatible';
    const resolvedBaseUrl =
      baseUrl?.trim() ||
      (resolvedAdapter === 'google_gemini'
        ? 'https://generativelanguage.googleapis.com/v1beta'
        : resolvedAdapter === 'anthropic'
          ? 'https://api.anthropic.com/v1'
          : 'https://api.openai.com/v1');

    validateExternalUrl(resolvedBaseUrl, true);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const encryptedKey = encryptSecret(apiKey.trim());
    const hint = maskApiKey(apiKey.trim());

    db.prepare(
      `INSERT INTO providers
       (id, name, adapter_type, base_url, encrypted_api_key, key_hint, custom_headers_json, custom_paths_json, is_active, last_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'untested', ?)`
    ).run(
      id,
      name.trim(),
      resolvedAdapter,
      resolvedBaseUrl.replace(/\/+$/, ''),
      encryptedKey,
      hint,
      JSON.stringify(customHeaders || {}),
      JSON.stringify(customPaths || {}),
      now
    );

    const provider = getProviderWithKey(id)!;
    const adapter = getAdapter(provider.adapterType);
    const testResult = await adapter.testConnection(provider);

    db.prepare(
      `UPDATE providers SET last_status = ?, last_error = ?, last_latency_ms = ?, last_checked_at = ? WHERE id = ?`
    ).run(
      testResult.ok ? 'connected' : 'error',
      testResult.error || null,
      testResult.latencyMs,
      new Date().toISOString(),
      id
    );

    let fetchedCount = 0;
    let fetchError: string | null = null;
    if (testResult.ok && autoFetchModels) {
      try {
        fetchedCount = await syncProviderModels(id);
      } catch (err) {
        fetchError = sanitizeErrorMessage(err, [provider.apiKey]);
      }
    }

    const updated = listProviders().find((p) => p.id === id);
    res.status(201).json({
      provider: updated,
      connection: testResult,
      fetchedCount,
      fetchError,
    });
  } catch (err) {
    res.status(400).json({ error: sanitizeErrorMessage(err) });
  }
});

app.put('/api/providers/:id', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = getProviderWithKey(id);
    if (!existing) return res.status(404).json({ error: 'Provider not found.' });

    const { name, adapterType, baseUrl, apiKey, customHeaders, customPaths, isActive } = req.body as {
      name?: string;
      adapterType?: AdapterType;
      baseUrl?: string;
      apiKey?: string;
      customHeaders?: Record<string, string>;
      customPaths?: ProviderPaths;
      isActive?: boolean;
    };

    const nextBaseUrl = baseUrl?.trim() ? baseUrl.trim().replace(/\/+$/, '') : existing.baseUrl;
    validateExternalUrl(nextBaseUrl, true);

    const encryptedKey = apiKey?.trim() ? encryptSecret(apiKey.trim()) : undefined;
    const keyHint = apiKey?.trim() ? maskApiKey(apiKey.trim()) : existing.keyHint;

    if (encryptedKey) {
      db.prepare(
        `UPDATE providers SET name = ?, adapter_type = ?, base_url = ?, encrypted_api_key = ?, key_hint = ?, custom_headers_json = ?, custom_paths_json = ?, is_active = ? WHERE id = ?`
      ).run(
        name?.trim() || existing.name,
        adapterType || existing.adapterType,
        nextBaseUrl,
        encryptedKey,
        keyHint,
        JSON.stringify(customHeaders ?? existing.customHeaders),
        JSON.stringify(customPaths ?? existing.customPaths),
        isActive === undefined ? (existing.isActive ? 1 : 0) : isActive ? 1 : 0,
        id
      );
    } else {
      db.prepare(
        `UPDATE providers SET name = ?, adapter_type = ?, base_url = ?, custom_headers_json = ?, custom_paths_json = ?, is_active = ? WHERE id = ?`
      ).run(
        name?.trim() || existing.name,
        adapterType || existing.adapterType,
        nextBaseUrl,
        JSON.stringify(customHeaders ?? existing.customHeaders),
        JSON.stringify(customPaths ?? existing.customPaths),
        isActive === undefined ? (existing.isActive ? 1 : 0) : isActive ? 1 : 0,
        id
      );
    }

    const updated = listProviders().find((p) => p.id === id);
    res.json({ provider: updated });
  } catch (err) {
    res.status(400).json({ error: sanitizeErrorMessage(err) });
  }
});

app.delete('/api/providers/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM providers WHERE id = ?').run(String(req.params.id));
  res.json({ ok: true });
});

app.post('/api/providers/:id/test', async (req: Request, res: Response) => {
  const provider = getProviderWithKey(String(req.params.id));
  if (!provider) return res.status(404).json({ error: 'Provider not found.' });
  const adapter = getAdapter(provider.adapterType);
  const result = await adapter.testConnection(provider);
  db.prepare(
    `UPDATE providers SET last_status = ?, last_error = ?, last_latency_ms = ?, last_checked_at = ? WHERE id = ?`
  ).run(
    result.ok ? 'connected' : 'error',
    result.error || null,
    result.latencyMs,
    new Date().toISOString(),
    provider.id
  );
  logApiCall({
    providerId: provider.id,
    providerName: provider.name,
    modelId: '-',
    endpoint: 'testConnection',
    statusCode: result.ok ? 200 : 502,
    success: result.ok,
    tokensPrompt: null,
    tokensCompletion: null,
    tokensTotal: null,
    costAmount: null,
    costCurrency: null,
    latencyMs: result.latencyMs,
    errorMessage: result.error || null,
  });
  const updated = listProviders().find((p) => p.id === provider.id);
  res.json({ provider: updated, result });
});

async function syncProviderModels(providerId: string): Promise<number> {
  const provider = getProviderWithKey(providerId);
  if (!provider) throw new Error('Provider not found.');
  const adapter = getAdapter(provider.adapterType);
  const start = Date.now();
  try {
    const discovered = await adapter.fetchModels(provider);
    const now = new Date().toISOString();
    const existingRows = db
      .prepare('SELECT id, is_enabled, is_default, capabilities_source, capabilities_json, category FROM models WHERE provider_id = ?')
      .all(providerId) as Array<Record<string, unknown>>;
    const existingMap = new Map(existingRows.map((r) => [String(r.id), r]));

    const upsert = db.prepare(`
      INSERT INTO models
      (id, provider_id, model_id, display_name, category, capabilities_json, capabilities_source, context_length, pricing_prompt, pricing_completion, is_enabled, is_default, raw_metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        category = CASE WHEN models.capabilities_source = 'manual' THEN models.category ELSE excluded.category END,
        capabilities_json = CASE WHEN models.capabilities_source = 'manual' THEN models.capabilities_json ELSE excluded.capabilities_json END,
        capabilities_source = CASE WHEN models.capabilities_source IN ('manual', 'tested') THEN models.capabilities_source ELSE excluded.capabilities_source END,
        context_length = excluded.context_length,
        pricing_prompt = excluded.pricing_prompt,
        pricing_completion = excluded.pricing_completion,
        raw_metadata_json = excluded.raw_metadata_json
    `);

    const tx = db.transaction(() => {
      for (const m of discovered) {
        const key = `${providerId}::${m.modelId}`;
        const prev = existingMap.get(key);
        upsert.run(
          key,
          providerId,
          m.modelId,
          m.displayName,
          m.category,
          JSON.stringify(m.capabilities),
          m.capabilitiesSource,
          m.contextLength,
          m.pricingPrompt,
          m.pricingCompletion,
          prev ? Number(prev.is_enabled) : 1,
          prev ? Number(prev.is_default) : 0,
          JSON.stringify(m.rawMetadata),
          now
        );
      }
    });
    tx();

    db.prepare(
      `UPDATE providers SET last_status = 'connected', last_error = NULL, last_latency_ms = ?, last_checked_at = ? WHERE id = ?`
    ).run(Date.now() - start, now, providerId);

    logApiCall({
      providerId: provider.id,
      providerName: provider.name,
      modelId: '-',
      endpoint: 'fetchModels',
      statusCode: 200,
      success: true,
      tokensPrompt: null,
      tokensCompletion: null,
      tokensTotal: null,
      costAmount: null,
      costCurrency: null,
      latencyMs: Date.now() - start,
      errorMessage: null,
    });
    return discovered.length;
  } catch (err) {
    const msg = sanitizeErrorMessage(err, [provider.apiKey]);
    db.prepare(
      `UPDATE providers SET last_status = 'error', last_error = ?, last_checked_at = ? WHERE id = ?`
    ).run(msg, new Date().toISOString(), providerId);
    logApiCall({
      providerId: provider.id,
      providerName: provider.name,
      modelId: '-',
      endpoint: 'fetchModels',
      statusCode: 500,
      success: false,
      tokensPrompt: null,
      tokensCompletion: null,
      tokensTotal: null,
      costAmount: null,
      costCurrency: null,
      latencyMs: Date.now() - start,
      errorMessage: msg,
    });
    throw new Error(msg);
  }
}

app.post('/api/providers/:id/fetch-models', async (req: Request, res: Response) => {
  try {
    const providerId = String(req.params.id);
    const count = await syncProviderModels(providerId);
    res.json({ ok: true, count, models: listModels({ providerId }) });
  } catch (err) {
    res.status(400).json({ error: sanitizeErrorMessage(err) });
  }
});

// ==================== MODELS ====================
app.get('/api/models', (req: Request, res: Response) => {
  const providerId = req.query.providerId ? String(req.query.providerId) : undefined;
  const enabledOnly = req.query.enabledOnly === 'true';
  res.json({ models: listModels({ providerId, enabledOnly }) });
});

app.post('/api/models/manual', (req: Request, res: Response) => {
  try {
    const { providerId, modelId, displayName, category, capabilities } = req.body as {
      providerId?: string;
      modelId?: string;
      displayName?: string;
      category?: string;
      capabilities?: Partial<ModelCapabilities>;
    };
    if (!providerId || !modelId?.trim()) {
      return res.status(400).json({ error: 'Provider and Model ID are required.' });
    }
    const provider = getProviderWithKey(providerId);
    if (!provider) return res.status(404).json({ error: 'Provider not found.' });

    const key = `${providerId}::${modelId.trim()}`;
    const mergedCaps: ModelCapabilities = { ...DEFAULT_CAPABILITIES, ...capabilities };
    db.prepare(
      `INSERT INTO models
       (id, provider_id, model_id, display_name, category, capabilities_json, capabilities_source, is_enabled, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', 1, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         category = excluded.category,
         capabilities_json = excluded.capabilities_json,
         capabilities_source = 'manual'`
    ).run(
      key,
      providerId,
      modelId.trim(),
      displayName?.trim() || modelId.trim(),
      category || 'chat',
      JSON.stringify(mergedCaps),
      new Date().toISOString()
    );
    res.status(201).json({ model: getModelByKey(key) });
  } catch (err) {
    res.status(400).json({ error: sanitizeErrorMessage(err) });
  }
});

app.patch('/api/models/:id', (req: Request, res: Response) => {
  const key = decodeURIComponent(String(req.params.id));
  const model = getModelByKey(key);
  if (!model) return res.status(404).json({ error: 'Model not found.' });

  const { isEnabled, isDefault, capabilities, category, displayName } = req.body as {
    isEnabled?: boolean;
    isDefault?: boolean;
    capabilities?: Partial<ModelCapabilities>;
    category?: string;
    displayName?: string;
  };

  if (isDefault === true) {
    db.prepare('UPDATE models SET is_default = 0').run();
  }

  const nextCaps = capabilities ? { ...model.capabilities, ...capabilities } : model.capabilities;
  const nextSource = capabilities ? 'manual' : model.capabilitiesSource;

  db.prepare(
    `UPDATE models SET is_enabled = ?, is_default = ?, capabilities_json = ?, capabilities_source = ?, category = ?, display_name = ? WHERE id = ?`
  ).run(
    isEnabled === undefined ? (model.isEnabled ? 1 : 0) : isEnabled ? 1 : 0,
    isDefault === undefined ? (model.isDefault ? 1 : 0) : isDefault ? 1 : 0,
    JSON.stringify(nextCaps),
    nextSource,
    category || model.category,
    displayName?.trim() || model.displayName,
    key
  );

  res.json({ model: getModelByKey(key) });
});

app.post('/api/models/:id/test', async (req: Request, res: Response) => {
  const key = decodeURIComponent(String(req.params.id));
  const model = getModelByKey(key);
  if (!model) return res.status(404).json({ error: 'Model not found.' });
  const provider = getProviderWithKey(model.providerId);
  if (!provider) return res.status(404).json({ error: 'Provider not found.' });

  const adapter = getAdapter(provider.adapterType);
  const result = await adapter.testModel(provider, model.modelId);

  const mergedCaps = result.detectedCapabilities
    ? { ...model.capabilities, ...result.detectedCapabilities }
    : model.capabilities;

  db.prepare(
    `UPDATE models SET last_error = ?, capabilities_json = ?, capabilities_source = ? WHERE id = ?`
  ).run(
    result.ok ? null : result.error || 'Model test failed',
    JSON.stringify(mergedCaps),
    result.ok ? 'tested' : model.capabilitiesSource,
    key
  );

  logApiCall({
    providerId: provider.id,
    providerName: provider.name,
    modelId: model.modelId,
    endpoint: 'testModel',
    statusCode: result.ok ? 200 : 400,
    success: result.ok,
    tokensPrompt: null,
    tokensCompletion: null,
    tokensTotal: null,
    costAmount: null,
    costCurrency: null,
    latencyMs: result.latencyMs,
    errorMessage: result.error || null,
  });

  res.json({ result, model: getModelByKey(key) });
});

app.delete('/api/models/:id', (req: Request, res: Response) => {
  const key = decodeURIComponent(String(req.params.id));
  db.prepare('DELETE FROM models WHERE id = ?').run(key);
  res.json({ ok: true });
});

// ==================== CONVERSATIONS & MESSAGES ====================
app.get('/api/conversations', (_req, res) => {
  res.json({ conversations: listConversations() });
});

app.post('/api/conversations', (req: Request, res: Response) => {
  const settings = getSettings();
  const { title, mode, systemPrompt, temperature, maxTokens, activeModelKeys } = req.body as {
    title?: string;
    mode?: 'chat' | 'multi_model' | 'code';
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    activeModelKeys?: string[];
  };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO conversations
     (id, title, mode, system_prompt, temperature, max_tokens, active_model_keys_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    title?.trim() || 'گفتگوی جدید',
    mode || 'chat',
    systemPrompt ?? settings.defaultSystemPrompt,
    temperature ?? settings.defaultTemperature,
    maxTokens ?? settings.defaultMaxTokens,
    JSON.stringify(activeModelKeys || []),
    now,
    now
  );
  const created = listConversations().find((c) => c.id === id);
  res.status(201).json({ conversation: created });
});

app.patch('/api/conversations/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const existing = listConversations().find((c) => c.id === id);
  if (!existing) return res.status(404).json({ error: 'Conversation not found.' });

  const { title, mode, systemPrompt, temperature, maxTokens, activeModelKeys } = req.body as {
    title?: string;
    mode?: 'chat' | 'multi_model' | 'code';
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    activeModelKeys?: string[];
  };

  db.prepare(
    `UPDATE conversations SET title = ?, mode = ?, system_prompt = ?, temperature = ?, max_tokens = ?, active_model_keys_json = ?, updated_at = ? WHERE id = ?`
  ).run(
    title?.trim() || existing.title,
    mode || existing.mode,
    systemPrompt ?? existing.systemPrompt,
    temperature ?? existing.temperature,
    maxTokens ?? existing.maxTokens,
    JSON.stringify(activeModelKeys ?? existing.activeModelKeys),
    new Date().toISOString(),
    id
  );
  res.json({ conversation: listConversations().find((c) => c.id === id) });
});

app.delete('/api/conversations/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(String(req.params.id));
  res.json({ ok: true });
});

app.delete('/api/conversations', (_req, res) => {
  db.prepare('DELETE FROM conversations').run();
  res.json({ ok: true });
});

app.get('/api/conversations/export', (_req, res) => {
  const conversations = listConversations();
  const payload = conversations.map((c) => ({
    ...c,
    messages: getConversationMessages(c.id),
  }));
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="mahrad-ai-studio-conversations.json"');
  res.send(JSON.stringify(payload, null, 2));
});

app.get('/api/conversations/:id/messages', (req: Request, res: Response) => {
  res.json({ messages: getConversationMessages(String(req.params.id)) });
});

app.patch('/api/messages/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { content } = req.body as { content?: string };
  if (typeof content !== 'string') return res.status(400).json({ error: 'Content is required.' });
  db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id);
  res.json({ ok: true });
});

app.delete('/api/messages/:id/after', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const target = db.prepare('SELECT conversation_id, created_at FROM messages WHERE id = ?').get(id) as
    | { conversation_id: string; created_at: string }
    | undefined;
  if (!target) return res.status(404).json({ error: 'Message not found.' });
  db.prepare('DELETE FROM messages WHERE conversation_id = ? AND created_at > ?').run(
    target.conversation_id,
    target.created_at
  );
  res.json({ ok: true });
});

// ==================== FILE UPLOAD & PROCESSING ====================
app.post('/api/files/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    validateUploadFile(req.file.originalname, req.file.size);

    const folderParam = (req.body?.folder as LibraryFolder | undefined) || 'uploads';
    const ext = path.extname(req.file.originalname).toLowerCase();
    const kind = classifyAttachmentKind(req.file.mimetype, ext);
    const extractedText = await extractTextFromBuffer(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    const saved = saveBufferToLibrary({
      buffer: req.file.buffer,
      folder: folderParam,
      name: req.file.originalname,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype || 'application/octet-stream',
      metadata: { kind, hasExtractedText: Boolean(extractedText) },
    });

    const attachment: AttachmentRef = {
      fileId: saved.id,
      name: saved.name,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      extractedText,
      previewUrl: saved.url,
      kind,
    };

    res.status(201).json({ file: saved, attachment });
  } catch (err) {
    res.status(400).json({ error: sanitizeErrorMessage(err) });
  }
});

// ==================== CHAT STREAMING ====================
app.post('/api/chat/stream', async (req: Request, res: Response) => {
  const {
    conversationId,
    modelKey,
    userText,
    attachments = [],
    systemPrompt,
    temperature,
    maxTokens,
    skipSaveUserMessage = false,
    studioMode = 'auto',
  } = req.body as {
    conversationId?: string;
    modelKey?: string;
    userText?: string;
    attachments?: AttachmentRef[];
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    skipSaveUserMessage?: boolean;
    studioMode?: ChatStudioMode;
  };

  const isDirectMediaMode =
    studioMode === 'image' ||
    studioMode === 'video' ||
    studioMode === 'tts' ||
    studioMode === 'music';

  if (!conversationId || (!modelKey && !isDirectMediaMode)) {
    return res.status(400).json({ error: 'conversationId and modelKey are required.' });
  }

  let model = modelKey ? getModelByKey(modelKey) : null;
  if (!model && isDirectMediaMode) {
    const enabled = listModels({ enabledOnly: true });
    model = enabled[0] || null;
  }
  if (!model) return res.status(404).json({ error: 'Selected model not found.' });
  if (!model.isEnabled) return res.status(400).json({ error: 'Selected model is disabled.' });

  const provider = getProviderWithKey(model.providerId);
  if (!provider || !provider.isActive) {
    return res.status(400).json({ error: 'Provider is missing or inactive.' });
  }

  const conv = listConversations().find((c) => c.id === conversationId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found.' });

  const settings = getSettings();

  if (!skipSaveUserMessage && (userText?.trim() || attachments.length > 0)) {
    const userMsgId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO messages
       (id, conversation_id, role, content, attachments_json, created_at)
       VALUES (?, ?, 'user', ?, ?, ?)`
    ).run(
      userMsgId,
      conversationId,
      userText || '',
      JSON.stringify(attachments),
      new Date().toISOString()
    );

    // Update conversation title on first message if still default
    const msgCount = (
      db
        .prepare('SELECT COUNT(*) AS cnt FROM messages WHERE conversation_id = ?')
        .get(conversationId) as { cnt: number }
    ).cnt;
    if (msgCount <= 1 && userText?.trim()) {
      const autoTitle = userText.trim().slice(0, 48);
      db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
        autoTitle,
        new Date().toISOString(),
        conversationId
      );
    }
  }

  // Prepare SSE response
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const abortController = new AbortController();
  req.on('close', () => {
    abortController.abort();
  });

  const sendEvent = (payload: Record<string, unknown>) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };

  const start = Date.now();
  let accumulated = '';
  const assistantMsgId = crypto.randomUUID();

  try {
    // Direct Studio Dispatch (Image / Video / TTS / Music selected directly inside Smart Chat)
    if (
      studioMode === 'image' ||
      studioMode === 'video' ||
      studioMode === 'tts' ||
      studioMode === 'music'
    ) {
      const studioRes = await runDirectStudioAction({
        mode: studioMode,
        prompt: userText || 'Generate output',
        settings,
        fallbackModelKey: model.id,
        userAttachments: attachments,
        onProgress: (statusLine) => {
          sendEvent({ type: 'status', text: statusLine });
        },
      });
      const durationMs = Date.now() - start;
      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO messages
         (id, conversation_id, role, content, model_key, provider_name, attachments_json, duration_ms, created_at)
         VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`
      ).run(
        assistantMsgId,
        conversationId,
        studioRes.summaryText,
        studioRes.modelUsed,
        provider.name,
        JSON.stringify(studioRes.attachments),
        durationMs,
        createdAt
      );
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(createdAt, conversationId);
      const savedMsg = getConversationMessages(conversationId).find((m) => m.id === assistantMsgId);
      sendEvent({ type: 'done', message: savedMsg });
      res.end();
      return;
    }

    const historyRows = settings.memoryEnabled
      ? getConversationMessages(conversationId)
      : getConversationMessages(conversationId).slice(-1);

    const turnMessages: ChatTurnMessage[] = [];
    const baseSystem = (systemPrompt ?? conv.systemPrompt ?? settings.defaultSystemPrompt).trim();
    const studioAddendum =
      studioMode === 'auto' || studioMode === 'code'
        ? buildUnifiedStudioSystemAddendum(settings)
        : '';
    const effectiveSystem = [baseSystem, studioAddendum].filter(Boolean).join('\n\n');
    if (effectiveSystem) {
      turnMessages.push({ role: 'system', content: effectiveSystem });
    }

    for (const m of historyRows) {
      if (m.role === 'system') continue;
      // Avoid merging unrelated assistant errors into prompt context
      if (m.error && !m.content) continue;
      const hydratedAttachments: ChatTurnMessage['attachments'] = [];
      for (const att of m.attachments) {
        let base64: string | undefined;
        if (att.kind === 'image' || att.kind === 'audio' || att.kind === 'video') {
          const fileRec = getLibraryFile(att.fileId);
          if (fileRec && fs.existsSync(fileRec.storagePath)) {
            base64 = fs.readFileSync(fileRec.storagePath).toString('base64');
          }
        }
        hydratedAttachments.push({
          name: att.name,
          mimeType: att.mimeType,
          kind: att.kind,
          base64,
          extractedText: att.extractedText,
        });
      }
      turnMessages.push({
        role: m.role,
        content: m.content,
        attachments: hydratedAttachments,
      });
    }

    const adapter = getAdapter(provider.adapterType);
    let usageMeta = {
      tokensPrompt: null as number | null,
      tokensCompletion: null as number | null,
      tokensTotal: null as number | null,
      costAmount: null as number | null,
      costCurrency: null as string | null,
    };

    await adapter.streamChat(
      {
        provider,
        modelId: model.modelId,
        messages: turnMessages,
        temperature: temperature ?? conv.temperature,
        maxTokens: maxTokens ?? conv.maxTokens,
        signal: abortController.signal,
      },
      {
        onDelta: (chunk) => {
          accumulated += chunk;
          sendEvent({ type: 'delta', text: chunk });
        },
        onDone: (meta) => {
          usageMeta = meta;
        },
      }
    );

    // Materialize any [[STUDIO_FILE:...]], [[STUDIO_PROJECT:...]], or media studio tags into real files
    let finalContent = accumulated;
    let generatedAttachments: AttachmentRef[] = [];
    if (studioMode === 'auto' || studioMode === 'code') {
      const processed = await processUnifiedChatDirectives({
        rawText: accumulated,
        settings,
        fallbackModelKey: model.id,
        userAttachments: attachments,
        onProgress: (statusLine) => {
          sendEvent({ type: 'status', text: statusLine });
        },
      });
      finalContent = processed.cleanedText || accumulated;
      generatedAttachments = processed.attachments;
    }

    const durationMs = Date.now() - start;

    // Only calculate cost if provider returned cost OR model metadata included official pricing
    let finalCost: number | null = usageMeta.costAmount;
    if (
      finalCost === null &&
      model.pricingPrompt !== null &&
      model.pricingCompletion !== null &&
      usageMeta.tokensPrompt !== null &&
      usageMeta.tokensCompletion !== null
    ) {
      finalCost = Number(
        (
          (usageMeta.tokensPrompt / 1_000_000) * model.pricingPrompt +
          (usageMeta.tokensCompletion / 1_000_000) * model.pricingCompletion
        ).toFixed(6)
      );
    }

    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO messages
       (id, conversation_id, role, content, model_key, provider_name, attachments_json, tokens_prompt, tokens_completion, tokens_total, duration_ms, cost_estimate, created_at)
       VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      assistantMsgId,
      conversationId,
      finalContent,
      model.id,
      provider.name,
      JSON.stringify(generatedAttachments),
      usageMeta.tokensPrompt,
      usageMeta.tokensCompletion,
      usageMeta.tokensTotal,
      durationMs,
      finalCost,
      createdAt
    );

    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(createdAt, conversationId);

    logApiCall({
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.modelId,
      endpoint: 'chat',
      statusCode: 200,
      success: true,
      tokensPrompt: usageMeta.tokensPrompt,
      tokensCompletion: usageMeta.tokensCompletion,
      tokensTotal: usageMeta.tokensTotal,
      costAmount: finalCost,
      costCurrency: finalCost !== null ? usageMeta.costCurrency || 'USD' : null,
      latencyMs: durationMs,
      errorMessage: null,
    });

    const savedMsg = getConversationMessages(conversationId).find((m) => m.id === assistantMsgId);
    sendEvent({ type: 'done', message: savedMsg });
    res.end();
  } catch (err) {
    const durationMs = Date.now() - start;
    const isAbort = abortController.signal.aborted;
    const errMsg = isAbort ? 'Generation stopped by user.' : sanitizeErrorMessage(err, [provider.apiKey]);

    if (accumulated.trim() || !isAbort) {
      db.prepare(
        `INSERT INTO messages
         (id, conversation_id, role, content, model_key, provider_name, duration_ms, error, created_at)
         VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`
      ).run(
        assistantMsgId,
        conversationId,
        accumulated,
        model.id,
        provider.name,
        durationMs,
        isAbort ? null : errMsg,
        new Date().toISOString()
      );
    }

    if (!isAbort) {
      db.prepare('UPDATE models SET last_error = ? WHERE id = ?').run(errMsg, model.id);
      logApiCall({
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.modelId,
        endpoint: 'chat',
        statusCode: 500,
        success: false,
        tokensPrompt: null,
        tokensCompletion: null,
        tokensTotal: null,
        costAmount: null,
        costCurrency: null,
        latencyMs: durationMs,
        errorMessage: errMsg,
      });
    }

    sendEvent({ type: 'error', error: errMsg, partialContent: accumulated });
    res.end();
  }
});

// ==================== IMAGE STUDIO ====================
app.get('/api/studio/image/jobs', (_req, res) => {
  res.json({ jobs: listMediaJobs('image') });
});

app.post('/api/studio/image/generate', async (req: Request, res: Response) => {
  const {
    modelKey,
    prompt,
    negativePrompt,
    size,
    aspectRatio,
    quality,
    n = 1,
    mode = 'txt2img',
    referenceFileId,
    maskBase64,
  } = req.body as {
    modelKey?: string;
    prompt?: string;
    negativePrompt?: string;
    size?: string;
    aspectRatio?: string;
    quality?: string;
    n?: number;
    mode?: 'txt2img' | 'img2img' | 'inpaint' | 'remove_bg';
    referenceFileId?: string;
    maskBase64?: string;
  };

  if (!modelKey || !prompt?.trim()) {
    return res.status(400).json({ error: 'Model and prompt are required.' });
  }
  const model = getModelByKey(modelKey);
  if (!model) return res.status(404).json({ error: 'Model not found.' });
  const provider = getProviderWithKey(model.providerId);
  if (!provider) return res.status(404).json({ error: 'Provider not found.' });

  const adapter = getAdapter(provider.adapterType);
  if (!adapter.generateImage) {
    return res.status(400).json({ error: 'Selected provider adapter does not support image generation.' });
  }

  let refBase64: string | undefined;
  let refMime: string | undefined;
  if (referenceFileId) {
    const fileRec = getLibraryFile(referenceFileId);
    if (fileRec && fs.existsSync(fileRec.storagePath)) {
      refBase64 = fs.readFileSync(fileRec.storagePath).toString('base64');
      refMime = fileRec.mimeType;
    }
  }

  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO media_jobs (id, kind, provider_id, model_key, prompt, params_json, status, created_at, updated_at)
     VALUES (?, 'image', ?, ?, ?, ?, 'processing', ?, ?)`
  ).run(
    jobId,
    provider.id,
    model.id,
    prompt.trim(),
    JSON.stringify({ negativePrompt, size, aspectRatio, quality, n, mode }),
    now,
    now
  );

  const start = Date.now();
  try {
    const assets = await adapter.generateImage({
      provider,
      modelId: model.modelId,
      prompt: prompt.trim(),
      negativePrompt,
      size,
      aspectRatio,
      quality,
      n,
      mode,
      referenceImageBase64: refBase64,
      referenceImageMime: refMime,
      maskImageBase64: maskBase64?.replace(/^data:image\/\w+;base64,/, ''),
      maskImageMime: 'image/png',
    });

    const savedIds: string[] = [];
    for (const asset of assets) {
      const saved = saveBufferToLibrary({
        buffer: asset.buffer,
        folder: 'images',
        name: asset.filename,
        originalName: asset.filename,
        mimeType: asset.mimeType,
        metadata: { prompt: prompt.trim(), modelKey: model.id, mode },
      });
      savedIds.push(saved.id);
    }

    const durationMs = Date.now() - start;
    db.prepare(
      `UPDATE media_jobs SET status = 'completed', result_file_ids_json = ?, duration_ms = ?, updated_at = ? WHERE id = ?`
    ).run(JSON.stringify(savedIds), durationMs, new Date().toISOString(), jobId);

    logApiCall({
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.modelId,
      endpoint: 'imageGeneration',
      statusCode: 200,
      success: true,
      tokensPrompt: null,
      tokensCompletion: null,
      tokensTotal: null,
      costAmount: null,
      costCurrency: null,
      latencyMs: durationMs,
      errorMessage: null,
    });

    const job = listMediaJobs('image').find((j) => j.id === jobId);
    res.json({ job });
  } catch (err) {
    const durationMs = Date.now() - start;
    const msg = sanitizeErrorMessage(err, [provider.apiKey]);
    db.prepare(
      `UPDATE media_jobs SET status = 'failed', error = ?, duration_ms = ?, updated_at = ? WHERE id = ?`
    ).run(msg, durationMs, new Date().toISOString(), jobId);
    logApiCall({
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.modelId,
      endpoint: 'imageGeneration',
      statusCode: 500,
      success: false,
      tokensPrompt: null,
      tokensCompletion: null,
      tokensTotal: null,
      costAmount: null,
      costCurrency: null,
      latencyMs: durationMs,
      errorMessage: msg,
    });
    res.status(400).json({ error: msg });
  }
});

// ==================== VIDEO STUDIO ====================
app.get('/api/studio/video/jobs', (_req, res) => {
  res.json({ jobs: listMediaJobs('video') });
});

app.post('/api/studio/video/generate', async (req: Request, res: Response) => {
  const { modelKey, prompt, mode = 'txt2vid', durationSec, aspectRatio, quality, referenceFileId } =
    req.body as {
      modelKey?: string;
      prompt?: string;
      mode?: 'txt2vid' | 'img2vid' | 'vid2vid';
      durationSec?: number;
      aspectRatio?: string;
      quality?: string;
      referenceFileId?: string;
    };

  if (!modelKey || !prompt?.trim()) {
    return res.status(400).json({ error: 'Model and prompt are required.' });
  }
  const model = getModelByKey(modelKey);
  if (!model) return res.status(404).json({ error: 'Model not found.' });
  const provider = getProviderWithKey(model.providerId);
  if (!provider) return res.status(404).json({ error: 'Provider not found.' });

  const adapter = getAdapter(provider.adapterType);
  if (!adapter.generateVideo) {
    return res.status(400).json({ error: 'Selected provider adapter does not support video generation.' });
  }

  let refBase64: string | undefined;
  let refMime: string | undefined;
  if (referenceFileId) {
    const fileRec = getLibraryFile(referenceFileId);
    if (fileRec && fs.existsSync(fileRec.storagePath)) {
      refBase64 = fs.readFileSync(fileRec.storagePath).toString('base64');
      refMime = fileRec.mimeType;
    }
  }

  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO media_jobs (id, kind, provider_id, model_key, prompt, params_json, status, created_at, updated_at)
     VALUES (?, 'video', ?, ?, ?, ?, 'processing', ?, ?)`
  ).run(
    jobId,
    provider.id,
    model.id,
    prompt.trim(),
    JSON.stringify({ mode, durationSec, aspectRatio, quality }),
    now,
    now
  );

  const start = Date.now();
  try {
    const result = await adapter.generateVideo({
      provider,
      modelId: model.modelId,
      prompt: prompt.trim(),
      mode,
      durationSec,
      aspectRatio,
      quality,
      referenceBase64: refBase64,
      referenceMime: refMime,
    });

    if (result.status === 'completed' && result.assets?.length) {
      const savedIds = result.assets.map(
        (a) =>
          saveBufferToLibrary({
            buffer: a.buffer,
            folder: 'videos',
            name: a.filename,
            originalName: a.filename,
            mimeType: a.mimeType,
            metadata: { prompt: prompt.trim(), modelKey: model.id, mode },
          }).id
      );
      db.prepare(
        `UPDATE media_jobs SET status = 'completed', result_file_ids_json = ?, duration_ms = ?, updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(savedIds), Date.now() - start, new Date().toISOString(), jobId);
    } else {
      db.prepare(
        `UPDATE media_jobs SET status = 'processing', remote_job_id = ?, updated_at = ? WHERE id = ?`
      ).run(result.remoteJobId || null, new Date().toISOString(), jobId);
    }

    logApiCall({
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.modelId,
      endpoint: 'videoGeneration',
      statusCode: 200,
      success: true,
      tokensPrompt: null,
      tokensCompletion: null,
      tokensTotal: null,
      costAmount: null,
      costCurrency: null,
      latencyMs: Date.now() - start,
      errorMessage: null,
    });

    res.json({ job: listMediaJobs('video').find((j) => j.id === jobId) });
  } catch (err) {
    const msg = sanitizeErrorMessage(err, [provider.apiKey]);
    db.prepare(
      `UPDATE media_jobs SET status = 'failed', error = ?, duration_ms = ?, updated_at = ? WHERE id = ?`
    ).run(msg, Date.now() - start, new Date().toISOString(), jobId);
    logApiCall({
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.modelId,
      endpoint: 'videoGeneration',
      statusCode: 500,
      success: false,
      tokensPrompt: null,
      tokensCompletion: null,
      tokensTotal: null,
      costAmount: null,
      costCurrency: null,
      latencyMs: Date.now() - start,
      errorMessage: msg,
    });
    res.status(400).json({ error: msg });
  }
});

app.post('/api/studio/video/jobs/:id/poll', async (req: Request, res: Response) => {
  const jobId = String(req.params.id);
  const job = listMediaJobs('video').find((j) => j.id === jobId);
  if (!job) return res.status(404).json({ error: 'Video job not found.' });
  if (!job.remoteJobId) return res.json({ job });

  const provider = getProviderWithKey(job.providerId);
  const model = getModelByKey(job.modelKey);
  if (!provider || !model) return res.status(404).json({ error: 'Provider/model not found.' });

  const adapter = getAdapter(provider.adapterType);
  if (!adapter.pollVideo) return res.status(400).json({ error: 'Adapter does not support polling.' });

  try {
    const result = await adapter.pollVideo(provider, job.remoteJobId, model.modelId);
    if (result.status === 'completed' && result.assets?.length) {
      const savedIds = result.assets.map(
        (a) =>
          saveBufferToLibrary({
            buffer: a.buffer,
            folder: 'videos',
            name: a.filename,
            originalName: a.filename,
            mimeType: a.mimeType,
            metadata: { prompt: job.prompt, modelKey: job.modelKey },
          }).id
      );
      db.prepare(
        `UPDATE media_jobs SET status = 'completed', result_file_ids_json = ?, updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(savedIds), new Date().toISOString(), jobId);
    }
    res.json({ job: listMediaJobs('video').find((j) => j.id === jobId) });
  } catch (err) {
    const msg = sanitizeErrorMessage(err, [provider.apiKey]);
    db.prepare(
      `UPDATE media_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`
    ).run(msg, new Date().toISOString(), jobId);
    res.status(400).json({ error: msg, job: listMediaJobs('video').find((j) => j.id === jobId) });
  }
});

// ==================== MUSIC & AUDIO STUDIO ====================
app.get('/api/studio/audio/jobs', (_req, res) => {
  const jobs = [...listMediaJobs('music'), ...listMediaJobs('tts'), ...listMediaJobs('stt')].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt)
  );
  res.json({ jobs });
});

app.post('/api/studio/audio/tts', async (req: Request, res: Response) => {
  const { modelKey, text, voice, speed, format, voiceCloneConsent, referenceFileId } = req.body as {
    modelKey?: string;
    text?: string;
    voice?: string;
    speed?: number;
    format?: string;
    voiceCloneConsent?: boolean;
    referenceFileId?: string;
  };
  if (!modelKey || !text?.trim()) {
    return res.status(400).json({ error: 'Model and text are required.' });
  }
  if (referenceFileId && !voiceCloneConsent) {
    return res.status(400).json({
      error: 'Explicit voice owner consent confirmation is required for voice cloning.',
    });
  }

  const model = getModelByKey(modelKey);
  if (!model) return res.status(404).json({ error: 'Model not found.' });
  const provider = getProviderWithKey(model.providerId);
  if (!provider) return res.status(404).json({ error: 'Provider not found.' });
  const adapter = getAdapter(provider.adapterType);
  if (!adapter.textToSpeech) {
    return res.status(400).json({ error: 'Selected provider adapter does not support Text-to-Speech.' });
  }

  let refBase64: string | undefined;
  let refMime: string | undefined;
  if (referenceFileId) {
    const rec = getLibraryFile(referenceFileId);
    if (rec && fs.existsSync(rec.storagePath)) {
      refBase64 = fs.readFileSync(rec.storagePath).toString('base64');
      refMime = rec.mimeType;
    }
  }

  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO media_jobs (id, kind, provider_id, model_key, prompt, params_json, status, created_at, updated_at)
     VALUES (?, 'tts', ?, ?, ?, ?, 'processing', ?, ?)`
  ).run(jobId, provider.id, model.id, text.trim(), JSON.stringify({ voice, speed, format }), now, now);

  const start = Date.now();
  try {
    const asset = await adapter.textToSpeech({
      provider,
      modelId: model.modelId,
      text: text.trim(),
      voice,
      speed,
      format,
      referenceAudioBase64: refBase64,
      referenceAudioMime: refMime,
      voiceCloneConsent,
    });
    const saved = saveBufferToLibrary({
      buffer: asset.buffer,
      folder: 'audio',
      name: asset.filename,
      originalName: asset.filename,
      mimeType: asset.mimeType,
      metadata: { text: text.trim().slice(0, 200), modelKey: model.id },
    });
    const durationMs = Date.now() - start;
    db.prepare(
      `UPDATE media_jobs SET status = 'completed', result_file_ids_json = ?, duration_ms = ?, updated_at = ? WHERE id = ?`
    ).run(JSON.stringify([saved.id]), durationMs, new Date().toISOString(), jobId);
    logApiCall({
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.modelId,
      endpoint: 'textToSpeech',
      statusCode: 200,
      success: true,
      tokensPrompt: null,
      tokensCompletion: null,
      tokensTotal: null,
      costAmount: null,
      costCurrency: null,
      latencyMs: durationMs,
      errorMessage: null,
    });
    res.json({ job: listMediaJobs('tts').find((j) => j.id === jobId) });
  } catch (err) {
    const msg = sanitizeErrorMessage(err, [provider.apiKey]);
    db.prepare(
      `UPDATE media_jobs SET status = 'failed', error = ?, duration_ms = ?, updated_at = ? WHERE id = ?`
    ).run(msg, Date.now() - start, new Date().toISOString(), jobId);
    res.status(400).json({ error: msg });
  }
});

app.post('/api/studio/audio/stt', upload.single('file'), async (req: Request, res: Response) => {
  const { modelKey, language, responseFormat, fileId } = req.body as {
    modelKey?: string;
    language?: string;
    responseFormat?: 'json' | 'srt' | 'vtt' | 'text';
    fileId?: string;
  };
  if (!modelKey) return res.status(400).json({ error: 'Model is required.' });
  const model = getModelByKey(modelKey);
  if (!model) return res.status(404).json({ error: 'Model not found.' });
  const provider = getProviderWithKey(model.providerId);
  if (!provider) return res.status(404).json({ error: 'Provider not found.' });
  const adapter = getAdapter(provider.adapterType);
  if (!adapter.transcribeAudio) {
    return res.status(400).json({ error: 'Selected provider adapter does not support Speech-to-Text.' });
  }

  let audioBuffer: Buffer | undefined;
  let filename = 'audio.mp3';
  let mimeType = 'audio/mpeg';

  if (req.file) {
    validateUploadFile(req.file.originalname, req.file.size);
    audioBuffer = req.file.buffer;
    filename = req.file.originalname;
    mimeType = req.file.mimetype;
  } else if (fileId) {
    const rec = getLibraryFile(fileId);
    if (rec && fs.existsSync(rec.storagePath)) {
      audioBuffer = fs.readFileSync(rec.storagePath);
      filename = rec.name;
      mimeType = rec.mimeType;
    }
  }
  if (!audioBuffer) return res.status(400).json({ error: 'Audio file is required.' });

  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO media_jobs (id, kind, provider_id, model_key, prompt, params_json, status, created_at, updated_at)
     VALUES (?, 'stt', ?, ?, ?, ?, 'processing', ?, ?)`
  ).run(jobId, provider.id, model.id, filename, JSON.stringify({ language, responseFormat }), now, now);

  const start = Date.now();
  try {
    const out = await adapter.transcribeAudio({
      provider,
      modelId: model.modelId,
      audioBuffer,
      filename,
      mimeType,
      language,
      responseFormat,
    });
    const durationMs = Date.now() - start;
    db.prepare(
      `UPDATE media_jobs SET status = 'completed', text_output = ?, duration_ms = ?, updated_at = ? WHERE id = ?`
    ).run(out.text, durationMs, new Date().toISOString(), jobId);
    logApiCall({
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.modelId,
      endpoint: 'speechToText',
      statusCode: 200,
      success: true,
      tokensPrompt: null,
      tokensCompletion: null,
      tokensTotal: null,
      costAmount: null,
      costCurrency: null,
      latencyMs: durationMs,
      errorMessage: null,
    });
    res.json({ job: listMediaJobs('stt').find((j) => j.id === jobId) });
  } catch (err) {
    const msg = sanitizeErrorMessage(err, [provider.apiKey]);
    db.prepare(
      `UPDATE media_jobs SET status = 'failed', error = ?, duration_ms = ?, updated_at = ? WHERE id = ?`
    ).run(msg, Date.now() - start, new Date().toISOString(), jobId);
    res.status(400).json({ error: msg });
  }
});

app.post('/api/studio/audio/music', async (req: Request, res: Response) => {
  const { modelKey, prompt, style, instrumental, durationSec, mode = 'music' } = req.body as {
    modelKey?: string;
    prompt?: string;
    style?: string;
    instrumental?: boolean;
    durationSec?: number;
    mode?: 'music' | 'beat' | 'ambient' | 'sfx' | 'vocals';
  };
  if (!modelKey || !prompt?.trim()) {
    return res.status(400).json({ error: 'Model and prompt are required.' });
  }
  const model = getModelByKey(modelKey);
  if (!model) return res.status(404).json({ error: 'Model not found.' });
  const provider = getProviderWithKey(model.providerId);
  if (!provider) return res.status(404).json({ error: 'Provider not found.' });
  const adapter = getAdapter(provider.adapterType);
  if (!adapter.generateMusic) {
    return res.status(400).json({ error: 'Selected provider adapter does not support music generation.' });
  }

  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO media_jobs (id, kind, provider_id, model_key, prompt, params_json, status, created_at, updated_at)
     VALUES (?, 'music', ?, ?, ?, ?, 'processing', ?, ?)`
  ).run(
    jobId,
    provider.id,
    model.id,
    prompt.trim(),
    JSON.stringify({ style, instrumental, durationSec, mode }),
    now,
    now
  );

  const start = Date.now();
  try {
    const assets = await adapter.generateMusic({
      provider,
      modelId: model.modelId,
      prompt: prompt.trim(),
      style,
      instrumental,
      durationSec,
      mode,
    });
    const savedIds = assets.map(
      (a) =>
        saveBufferToLibrary({
          buffer: a.buffer,
          folder: 'music',
          name: a.filename,
          originalName: a.filename,
          mimeType: a.mimeType,
          metadata: { prompt: prompt.trim(), style, mode, modelKey: model.id },
        }).id
    );
    const durationMs = Date.now() - start;
    db.prepare(
      `UPDATE media_jobs SET status = 'completed', result_file_ids_json = ?, duration_ms = ?, updated_at = ? WHERE id = ?`
    ).run(JSON.stringify(savedIds), durationMs, new Date().toISOString(), jobId);
    res.json({ job: listMediaJobs('music').find((j) => j.id === jobId) });
  } catch (err) {
    const msg = sanitizeErrorMessage(err, [provider.apiKey]);
    db.prepare(
      `UPDATE media_jobs SET status = 'failed', error = ?, duration_ms = ?, updated_at = ? WHERE id = ?`
    ).run(msg, Date.now() - start, new Date().toISOString(), jobId);
    res.status(400).json({ error: msg });
  }
});

// ==================== CODE STUDIO ZIP EXPORT ====================
app.post('/api/studio/code/export-zip', (req: Request, res: Response) => {
  try {
    const { projectName = 'mahrad-project', files = [], saveToLibrary = true } = req.body as {
      projectName?: string;
      files?: Array<{ path: string; content: string }>;
      saveToLibrary?: boolean;
    };
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'No project files provided.' });
    }
    const zip = new AdmZip();
    for (const f of files) {
      const cleanPath = f.path.replace(/^\/+/, '').replace(/\.\.\//g, '');
      if (cleanPath) {
        zip.addFile(cleanPath, Buffer.from(f.content || '', 'utf8'));
      }
    }
    const zipBuf = zip.toBuffer();
    const safeName = `${projectName.replace(/[^a-zA-Z0-9_\-]/g, '_')}.zip`;
    if (saveToLibrary) {
      saveBufferToLibrary({
        buffer: zipBuf,
        folder: 'projects',
        name: safeName,
        originalName: safeName,
        mimeType: 'application/zip',
        metadata: { fileCount: files.length },
      });
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.send(zipBuf);
  } catch (err) {
    res.status(400).json({ error: sanitizeErrorMessage(err) });
  }
});

// ==================== TOOLS BACKEND UTILITIES ====================
app.post('/api/tools/convert', upload.single('file'), (req: Request, res: Response) => {
  try {
    const { targetFormat, rawText, sourceFormat } = req.body as {
      targetFormat?: 'json' | 'csv' | 'xml' | 'txt' | 'markdown';
      rawText?: string;
      sourceFormat?: 'json' | 'csv' | 'xlsx' | 'txt';
    };
    let rows: Array<Record<string, unknown>> = [];
    let plainText = rawText || '';

    if (req.file) {
      validateUploadFile(req.file.originalname, req.file.size);
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
        plainText = XLSX.utils.sheet_to_csv(ws);
      } else {
        plainText = req.file.buffer.toString('utf8');
      }
    }

    if (rows.length === 0 && plainText.trim()) {
      const trimmed = plainText.trim();
      if (sourceFormat === 'json' || trimmed.startsWith('[') || trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        const wb = XLSX.read(trimmed, { type: 'string' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
      }
    }

    let output = '';
    if (targetFormat === 'json') {
      output = JSON.stringify(rows.length ? rows : { text: plainText }, null, 2);
    } else if (targetFormat === 'csv') {
      const ws = XLSX.utils.json_to_sheet(rows);
      output = XLSX.utils.sheet_to_csv(ws);
    } else if (targetFormat === 'xml') {
      const itemsXml = rows
        .map((row) => {
          const cols = Object.entries(row)
            .map(([k, v]) => `    <${k.replace(/[^a-zA-Z0-9_]/g, '_')}>${String(v ?? '')}</${k.replace(/[^a-zA-Z0-9_]/g, '_')}>`)
            .join('\n');
          return `  <row>\n${cols}\n  </row>`;
        })
        .join('\n');
      output = `<?xml version="1.0" encoding="UTF-8"?>\n<records>\n${itemsXml}\n</records>`;
    } else if (targetFormat === 'markdown') {
      if (rows.length === 0) {
        output = plainText;
      } else {
        const headers = Object.keys(rows[0]);
        const headerRow = `| ${headers.join(' | ')} |`;
        const sepRow = `| ${headers.map(() => '---').join(' | ')} |`;
        const bodyRows = rows.map(
          (r) => `| ${headers.map((h) => String(r[h] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`
        );
        output = [headerRow, sepRow, ...bodyRows].join('\n');
      }
    } else {
      output = plainText || JSON.stringify(rows, null, 2);
    }

    res.json({ output });
  } catch (err) {
    res.status(400).json({ error: sanitizeErrorMessage(err) });
  }
});

app.post('/api/tools/analyze-data', upload.single('file'), (req: Request, res: Response) => {
  try {
    let rows: Array<Record<string, unknown>> = [];
    if (req.file) {
      validateUploadFile(req.file.originalname, req.file.size);
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext === '.json') {
        const parsed = JSON.parse(req.file.buffer.toString('utf8'));
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
      }
    } else if (typeof req.body?.rawText === 'string' && req.body.rawText.trim()) {
      const txt = req.body.rawText.trim();
      if (txt.startsWith('[') || txt.startsWith('{')) {
        const parsed = JSON.parse(txt);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        const wb = XLSX.read(txt, { type: 'string' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
      }
    }

    if (rows.length === 0) return res.status(400).json({ error: 'No tabular data rows found.' });

    const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    const summary = columns.map((col) => {
      const vals = rows.map((r) => r[col]).filter((v) => v !== undefined && v !== null && v !== '');
      const nums = vals.map(Number).filter((n) => !Number.isNaN(n));
      const isNumeric = nums.length > 0 && nums.length === vals.length;
      return {
        column: col,
        nonNull: vals.length,
        nullCount: rows.length - vals.length,
        type: isNumeric ? 'number' : 'string',
        min: isNumeric ? Math.min(...nums) : null,
        max: isNumeric ? Math.max(...nums) : null,
        mean: isNumeric
          ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4))
          : null,
      };
    });

    res.json({
      rowCount: rows.length,
      columnCount: columns.length,
      summary,
      sampleRows: rows.slice(0, 10),
    });
  } catch (err) {
    res.status(400).json({ error: sanitizeErrorMessage(err) });
  }
});

app.post('/api/tools/fetch-url', async (req: Request, res: Response) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url?.trim()) return res.status(400).json({ error: 'URL is required.' });
    const parsed = validateExternalUrl(url, false);
    const response = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'MAHRAD-AI-STUDIO/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return res.status(400).json({ error: `Failed fetching URL: HTTP ${response.status}` });
    }
    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 25000);
    res.json({
      url: parsed.toString(),
      title: titleMatch?.[1]?.trim() || parsed.hostname,
      text: stripped,
    });
  } catch (err) {
    res.status(400).json({ error: sanitizeErrorMessage(err) });
  }
});

app.post('/api/tools/web-search', async (req: Request, res: Response) => {
  try {
    const { query } = req.body as { query?: string };
    if (!query?.trim()) return res.status(400).json({ error: 'Search query is required.' });

    const settings = getSettings();
    if (settings.searchProviderType === 'custom' && settings.searchEndpointUrl) {
      validateExternalUrl(settings.searchEndpointUrl, false);
      const r = await fetch(
        `${settings.searchEndpointUrl}${settings.searchEndpointUrl.includes('?') ? '&' : '?'}q=${encodeURIComponent(query.trim())}`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (!r.ok) return res.status(400).json({ error: `Search endpoint returned HTTP ${r.status}` });
      return res.json({ results: await r.json() });
    }

    if (settings.searchProviderType === 'duckduckgo_instant') {
      const r = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query.trim())}&format=json&no_html=1&skip_disambig=1`,
        { signal: AbortSignal.timeout(15000) }
      );
      const data = (await r.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };
      const items = [
        ...(data.AbstractText
          ? [{ title: data.Heading || query, url: data.AbstractURL || '', snippet: data.AbstractText }]
          : []),
        ...(data.RelatedTopics || [])
          .filter((t) => t.Text && t.FirstURL)
          .slice(0, 8)
          .map((t) => ({ title: t.Text!.split(' - ')[0], url: t.FirstURL!, snippet: t.Text! })),
      ];
      return res.json({ results: items });
    }

    return res.status(400).json({
      error:
        'Web search provider is not configured. Enable DuckDuckGo Instant API or set a Custom Search URL in Settings.',
    });
  } catch (err) {
    res.status(400).json({ error: sanitizeErrorMessage(err) });
  }
});

// ==================== FILE LIBRARY ====================
app.get('/api/library', (req: Request, res: Response) => {
  const folder = req.query.folder ? (String(req.query.folder) as LibraryFolder) : undefined;
  const search = req.query.search ? String(req.query.search) : undefined;
  res.json({ files: listLibraryFiles(folder, search) });
});

app.get('/api/library/:id/content', (req: Request, res: Response) => {
  const file = getLibraryFile(String(req.params.id));
  if (!file || !fs.existsSync(file.storagePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
  }
  fs.createReadStream(file.storagePath).pipe(res);
});

app.patch('/api/library/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { name } = req.body as { name?: string };
  if (!name?.trim()) return res.status(400).json({ error: 'Filename is required.' });
  db.prepare('UPDATE library_files SET name = ? WHERE id = ?').run(name.trim().slice(0, 140), id);
  const updated = getLibraryFile(id);
  if (!updated) return res.status(404).json({ error: 'File not found.' });
  const { storagePath: _sp, ...dto } = updated;
  res.json({ file: dto });
});

app.delete('/api/library/:id', (req: Request, res: Response) => {
  const file = getLibraryFile(String(req.params.id));
  if (!file) return res.status(404).json({ error: 'File not found.' });
  if (fs.existsSync(file.storagePath)) {
    fs.unlinkSync(file.storagePath);
  }
  db.prepare('DELETE FROM library_files WHERE id = ?').run(file.id);
  res.json({ ok: true });
});

// ==================== USAGE & API LOGS ====================
app.get('/api/usage', (_req, res) => {
  const summary = db
    .prepare(
      `SELECT
        COUNT(*) AS totalRequests,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS errorCount,
        SUM(COALESCE(tokens_prompt, 0)) AS tokensPrompt,
        SUM(COALESCE(tokens_completion, 0)) AS tokensCompletion,
        SUM(COALESCE(tokens_total, 0)) AS tokensTotal,
        AVG(latency_ms) AS avgLatencyMs,
        SUM(cost_amount) AS totalCost,
        COUNT(cost_amount) AS costCount
       FROM api_logs`
    )
    .get() as Record<string, number | null>;

  const byModel = db
    .prepare(
      `SELECT model_id AS modelId, provider_name AS providerName,
        COUNT(*) AS requests,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS errors,
        SUM(COALESCE(tokens_total, 0)) AS tokensTotal,
        AVG(latency_ms) AS avgLatencyMs,
        SUM(cost_amount) AS totalCost
       FROM api_logs
       WHERE model_id != '-'
       GROUP BY model_id, provider_name
       ORDER BY requests DESC`
    )
    .all();

  const logs = db
    .prepare('SELECT * FROM api_logs ORDER BY created_at DESC LIMIT 100')
    .all() as Array<Record<string, unknown>>;

  res.json({
    summary,
    byModel,
    logs: logs.map((r) => ({
      id: String(r.id),
      providerId: String(r.provider_id),
      providerName: String(r.provider_name),
      modelId: String(r.model_id),
      endpoint: String(r.endpoint),
      statusCode: r.status_code !== null ? Number(r.status_code) : null,
      success: Boolean(r.success),
      tokensPrompt: r.tokens_prompt !== null ? Number(r.tokens_prompt) : null,
      tokensCompletion: r.tokens_completion !== null ? Number(r.tokens_completion) : null,
      tokensTotal: r.tokens_total !== null ? Number(r.tokens_total) : null,
      costAmount: r.cost_amount !== null ? Number(r.cost_amount) : null,
      costCurrency: r.cost_currency ? String(r.cost_currency) : null,
      latencyMs: r.latency_ms !== null ? Number(r.latency_ms) : null,
      errorMessage: r.error_message ? String(r.error_message) : null,
      createdAt: String(r.created_at),
    })),
  });
});

app.delete('/api/usage', (_req, res) => {
  db.prepare('DELETE FROM api_logs').run();
  res.json({ ok: true });
});

// ==================== SETTINGS ====================
app.get('/api/settings', (_req, res) => {
  res.json({ settings: getSettings() });
});

app.put('/api/settings', (req: Request, res: Response) => {
  const updated = saveSettings(req.body as Partial<StudioSettings>);
  res.json({ settings: updated });
});

// ==================== VITE / STATIC SERVING ====================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MAHRAD AI STUDIO server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
