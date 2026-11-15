import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ApiLogDTO,
  AttachmentRef,
  ChatMessageDTO,
  ConversationDTO,
  LibraryFileDTO,
  LibraryFolder,
  MediaJobDTO,
  ModelCapabilities,
  ModelCategory,
  ModelDTO,
  ProviderDTO,
  ProviderPaths,
  StudioSettings,
} from '../src/types.ts';
import { decryptSecret } from './crypto.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'mahrad-studio.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    adapter_type TEXT NOT NULL,
    base_url TEXT NOT NULL,
    encrypted_api_key TEXT NOT NULL,
    key_hint TEXT NOT NULL,
    custom_headers_json TEXT NOT NULL DEFAULT '{}',
    custom_paths_json TEXT NOT NULL DEFAULT '{}',
    is_active INTEGER NOT NULL DEFAULT 1,
    last_status TEXT NOT NULL DEFAULT 'untested',
    last_error TEXT,
    last_latency_ms INTEGER,
    last_checked_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    capabilities_json TEXT NOT NULL,
    capabilities_source TEXT NOT NULL DEFAULT 'unverified',
    context_length INTEGER,
    pricing_prompt REAL,
    pricing_completion REAL,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    raw_metadata_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(provider_id) REFERENCES providers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'chat',
    system_prompt TEXT NOT NULL DEFAULT '',
    temperature REAL NOT NULL DEFAULT 0.7,
    max_tokens INTEGER NOT NULL DEFAULT 4096,
    active_model_keys_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model_key TEXT,
    provider_name TEXT,
    attachments_json TEXT NOT NULL DEFAULT '[]',
    tokens_prompt INTEGER,
    tokens_completion INTEGER,
    tokens_total INTEGER,
    duration_ms INTEGER,
    cost_estimate REAL,
    error TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS library_files (
    id TEXT PRIMARY KEY,
    folder TEXT NOT NULL,
    name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media_jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_key TEXT NOT NULL,
    prompt TEXT NOT NULL,
    params_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    remote_job_id TEXT,
    result_file_ids_json TEXT NOT NULL DEFAULT '[]',
    text_output TEXT,
    error TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_logs (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    model_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    status_code INTEGER,
    success INTEGER NOT NULL,
    tokens_prompt INTEGER,
    tokens_completion INTEGER,
    tokens_total INTEGER,
    cost_amount REAL,
    cost_currency TEXT,
    latency_ms INTEGER,
    error_message TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
`);

export interface ProviderRecord extends ProviderDTO {
  apiKey: string;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const DEFAULT_CAPABILITIES: ModelCapabilities = {
  chat: false,
  streaming: false,
  vision: false,
  imageGen: false,
  imageEdit: false,
  inpainting: false,
  backgroundRemoval: false,
  videoGen: false,
  imageToVideo: false,
  videoToVideo: false,
  audioTts: false,
  audioStt: false,
  musicGen: false,
  voiceClone: false,
  tools: false,
  jsonMode: false,
};

export function listProviders(): ProviderDTO[] {
  const rows = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM models m WHERE m.provider_id = p.id) AS model_count
       FROM providers p ORDER BY p.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    adapterType: String(r.adapter_type) as ProviderDTO['adapterType'],
    baseUrl: String(r.base_url),
    keyHint: String(r.key_hint),
    customHeaders: safeJsonParse<Record<string, string>>(r.custom_headers_json as string, {}),
    customPaths: safeJsonParse<ProviderPaths>(r.custom_paths_json as string, {}),
    isActive: Boolean(r.is_active),
    lastStatus: String(r.last_status) as ProviderDTO['lastStatus'],
    lastError: r.last_error ? String(r.last_error) : null,
    lastLatencyMs: r.last_latency_ms !== null ? Number(r.last_latency_ms) : null,
    lastCheckedAt: r.last_checked_at ? String(r.last_checked_at) : null,
    createdAt: String(r.created_at),
    modelCount: Number(r.model_count || 0),
  }));
}

export function getProviderWithKey(id: string): ProviderRecord | null {
  const r = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return {
    id: String(r.id),
    name: String(r.name),
    adapterType: String(r.adapter_type) as ProviderDTO['adapterType'],
    baseUrl: String(r.base_url),
    apiKey: decryptSecret(String(r.encrypted_api_key)),
    keyHint: String(r.key_hint),
    customHeaders: safeJsonParse<Record<string, string>>(r.custom_headers_json as string, {}),
    customPaths: safeJsonParse<ProviderPaths>(r.custom_paths_json as string, {}),
    isActive: Boolean(r.is_active),
    lastStatus: String(r.last_status) as ProviderDTO['lastStatus'],
    lastError: r.last_error ? String(r.last_error) : null,
    lastLatencyMs: r.last_latency_ms !== null ? Number(r.last_latency_ms) : null,
    lastCheckedAt: r.last_checked_at ? String(r.last_checked_at) : null,
    createdAt: String(r.created_at),
  };
}

export function listModels(filter?: { providerId?: string; enabledOnly?: boolean }): ModelDTO[] {
  let sql = `
    SELECT m.*, p.name AS provider_name, p.adapter_type AS adapter_type
    FROM models m
    JOIN providers p ON p.id = m.provider_id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (filter?.providerId) {
    sql += ' AND m.provider_id = ?';
    params.push(filter.providerId);
  }
  if (filter?.enabledOnly) {
    sql += ' AND m.is_enabled = 1 AND p.is_active = 1';
  }
  sql += ' ORDER BY m.is_default DESC, m.display_name ASC';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    providerId: String(r.provider_id),
    providerName: String(r.provider_name),
    adapterType: String(r.adapter_type) as ModelDTO['adapterType'],
    modelId: String(r.model_id),
    displayName: String(r.display_name),
    category: String(r.category) as ModelCategory,
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      ...safeJsonParse<Partial<ModelCapabilities>>(r.capabilities_json as string, {}),
    },
    capabilitiesSource: String(r.capabilities_source) as ModelDTO['capabilitiesSource'],
    contextLength: r.context_length !== null ? Number(r.context_length) : null,
    pricingPrompt: r.pricing_prompt !== null ? Number(r.pricing_prompt) : null,
    pricingCompletion: r.pricing_completion !== null ? Number(r.pricing_completion) : null,
    isEnabled: Boolean(r.is_enabled),
    isDefault: Boolean(r.is_default),
    lastError: r.last_error ? String(r.last_error) : null,
    rawMetadata: safeJsonParse<Record<string, unknown>>(r.raw_metadata_json as string, {}),
    createdAt: String(r.created_at),
  }));
}

export function getModelByKey(modelKey: string): ModelDTO | null {
  const r = db
    .prepare(
      `SELECT m.*, p.name AS provider_name, p.adapter_type AS adapter_type
       FROM models m JOIN providers p ON p.id = m.provider_id WHERE m.id = ?`
    )
    .get(modelKey) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: String(r.id),
    providerId: String(r.provider_id),
    providerName: String(r.provider_name),
    adapterType: String(r.adapter_type) as ModelDTO['adapterType'],
    modelId: String(r.model_id),
    displayName: String(r.display_name),
    category: String(r.category) as ModelCategory,
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      ...safeJsonParse<Partial<ModelCapabilities>>(r.capabilities_json as string, {}),
    },
    capabilitiesSource: String(r.capabilities_source) as ModelDTO['capabilitiesSource'],
    contextLength: r.context_length !== null ? Number(r.context_length) : null,
    pricingPrompt: r.pricing_prompt !== null ? Number(r.pricing_prompt) : null,
    pricingCompletion: r.pricing_completion !== null ? Number(r.pricing_completion) : null,
    isEnabled: Boolean(r.is_enabled),
    isDefault: Boolean(r.is_default),
    lastError: r.last_error ? String(r.last_error) : null,
    rawMetadata: safeJsonParse<Record<string, unknown>>(r.raw_metadata_json as string, {}),
    createdAt: String(r.created_at),
  };
}

export function listConversations(): ConversationDTO[] {
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c ORDER BY c.updated_at DESC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    mode: String(r.mode) as ConversationDTO['mode'],
    systemPrompt: String(r.system_prompt || ''),
    temperature: Number(r.temperature ?? 0.7),
    maxTokens: Number(r.max_tokens ?? 4096),
    activeModelKeys: safeJsonParse<string[]>(r.active_model_keys_json as string, []),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    messageCount: Number(r.message_count || 0),
  }));
}

export function getConversationMessages(conversationId: string): ChatMessageDTO[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    conversationId: String(r.conversation_id),
    role: String(r.role) as ChatMessageDTO['role'],
    content: String(r.content),
    modelKey: r.model_key ? String(r.model_key) : null,
    providerName: r.provider_name ? String(r.provider_name) : null,
    attachments: safeJsonParse<AttachmentRef[]>(r.attachments_json as string, []),
    tokensPrompt: r.tokens_prompt !== null ? Number(r.tokens_prompt) : null,
    tokensCompletion: r.tokens_completion !== null ? Number(r.tokens_completion) : null,
    tokensTotal: r.tokens_total !== null ? Number(r.tokens_total) : null,
    durationMs: r.duration_ms !== null ? Number(r.duration_ms) : null,
    costEstimate: r.cost_estimate !== null ? Number(r.cost_estimate) : null,
    error: r.error ? String(r.error) : null,
    createdAt: String(r.created_at),
  }));
}

export function listLibraryFiles(folder?: LibraryFolder, search?: string): LibraryFileDTO[] {
  let sql = 'SELECT * FROM library_files WHERE 1=1';
  const params: unknown[] = [];
  if (folder) {
    sql += ' AND folder = ?';
    params.push(folder);
  }
  if (search && search.trim()) {
    sql += ' AND (LOWER(name) LIKE ? OR LOWER(original_name) LIKE ?)';
    const q = `%${search.trim().toLowerCase()}%`;
    params.push(q, q);
  }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapLibraryRow);
}

export function getLibraryFile(id: string): (LibraryFileDTO & { storagePath: string }) | null {
  const r = db.prepare('SELECT * FROM library_files WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return {
    ...mapLibraryRow(r),
    storagePath: String(r.storage_path),
  };
}

function mapLibraryRow(r: Record<string, unknown>): LibraryFileDTO {
  return {
    id: String(r.id),
    folder: String(r.folder) as LibraryFolder,
    name: String(r.name),
    originalName: String(r.original_name),
    mimeType: String(r.mime_type),
    sizeBytes: Number(r.size_bytes),
    url: `/api/library/${String(r.id)}/content`,
    metadata: safeJsonParse<Record<string, unknown>>(r.metadata_json as string, {}),
    createdAt: String(r.created_at),
  };
}

export function listMediaJobs(kind?: MediaJobDTO['kind']): MediaJobDTO[] {
  let sql = 'SELECT * FROM media_jobs';
  const params: unknown[] = [];
  if (kind) {
    sql += ' WHERE kind = ?';
    params.push(kind);
  }
  sql += ' ORDER BY created_at DESC LIMIT 60';
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const fileIds = safeJsonParse<string[]>(r.result_file_ids_json as string, []);
    const resultFiles = fileIds
      .map((fid) => getLibraryFile(fid))
      .filter((f): f is LibraryFileDTO & { storagePath: string } => Boolean(f))
      .map(({ storagePath: _sp, ...rest }) => rest);
    return {
      id: String(r.id),
      kind: String(r.kind) as MediaJobDTO['kind'],
      providerId: String(r.provider_id),
      modelKey: String(r.model_key),
      prompt: String(r.prompt),
      params: safeJsonParse<Record<string, unknown>>(r.params_json as string, {}),
      status: String(r.status) as MediaJobDTO['status'],
      remoteJobId: r.remote_job_id ? String(r.remote_job_id) : null,
      resultFiles,
      textOutput: r.text_output ? String(r.text_output) : null,
      error: r.error ? String(r.error) : null,
      durationMs: r.duration_ms !== null ? Number(r.duration_ms) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  });
}

export function logApiCall(entry: Omit<ApiLogDTO, 'id' | 'createdAt'>): void {
  db.prepare(
    `INSERT INTO api_logs
     (id, provider_id, provider_name, model_id, endpoint, status_code, success, tokens_prompt, tokens_completion, tokens_total, cost_amount, cost_currency, latency_ms, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    entry.providerId,
    entry.providerName,
    entry.modelId,
    entry.endpoint,
    entry.statusCode ?? null,
    entry.success ? 1 : 0,
    entry.tokensPrompt ?? null,
    entry.tokensCompletion ?? null,
    entry.tokensTotal ?? null,
    entry.costAmount ?? null,
    entry.costCurrency ?? null,
    entry.latencyMs ?? null,
    entry.errorMessage ?? null,
    new Date().toISOString()
  );
}

export const DEFAULT_SETTINGS: StudioSettings = {
  language: 'fa',
  theme: 'dark',
  defaultSystemPrompt:
    'You are a precise, helpful AI assistant inside MAHRAD AI STUDIO. Respond clearly in the user’s language.',
  defaultTemperature: 0.7,
  defaultMaxTokens: 4096,
  memoryEnabled: true,
  searchEndpointUrl: '',
  searchProviderType: 'none',
};

export function getSettings(): StudioSettings {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('studio_settings') as
    | { value_json: string }
    | undefined;
  if (!row) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...safeJsonParse<Partial<StudioSettings>>(row.value_json, {}),
  };
}

export function saveSettings(partial: Partial<StudioSettings>): StudioSettings {
  const merged = { ...getSettings(), ...partial };
  db.prepare(
    `INSERT INTO settings (key, value_json) VALUES ('studio_settings', ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run(JSON.stringify(merged));
  return merged;
}
