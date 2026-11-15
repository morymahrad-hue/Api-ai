export type AdapterType = 'openai_compatible' | 'google_gemini' | 'anthropic' | 'custom_http';

export type ModelCategory =
  | 'chat'
  | 'reasoning'
  | 'vision'
  | 'code'
  | 'image'
  | 'video'
  | 'audio'
  | 'music'
  | 'embedding'
  | 'other';

export interface ModelCapabilities {
  chat: boolean;
  streaming: boolean;
  vision: boolean;
  imageGen: boolean;
  imageEdit: boolean;
  inpainting: boolean;
  backgroundRemoval: boolean;
  videoGen: boolean;
  imageToVideo: boolean;
  videoToVideo: boolean;
  audioTts: boolean;
  audioStt: boolean;
  musicGen: boolean;
  voiceClone: boolean;
  tools: boolean;
  jsonMode: boolean;
}

export interface ProviderPaths {
  models?: string;
  chat?: string;
  images?: string;
  imageEdits?: string;
  videos?: string;
  videoStatus?: string;
  audioSpeech?: string;
  audioTranscriptions?: string;
  music?: string;
}

export interface ProviderDTO {
  id: string;
  name: string;
  adapterType: AdapterType;
  baseUrl: string;
  keyHint: string;
  customHeaders: Record<string, string>;
  customPaths: ProviderPaths;
  isActive: boolean;
  lastStatus: 'untested' | 'connected' | 'error';
  lastError: string | null;
  lastLatencyMs: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
  modelCount?: number;
}

export interface ModelDTO {
  id: string; // `${providerId}::${modelId}`
  providerId: string;
  providerName?: string;
  adapterType?: AdapterType;
  modelId: string;
  displayName: string;
  category: ModelCategory;
  capabilities: ModelCapabilities;
  capabilitiesSource: 'api_metadata' | 'tested' | 'manual' | 'unverified';
  contextLength: number | null;
  pricingPrompt: number | null; // per 1M tokens if provided by API
  pricingCompletion: number | null;
  isEnabled: boolean;
  isDefault: boolean;
  lastError: string | null;
  rawMetadata?: Record<string, unknown>;
  createdAt: string;
}

export interface AttachmentRef {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  extractedText?: string;
  previewUrl?: string;
  kind: 'image' | 'audio' | 'video' | 'document' | 'code' | 'archive';
}

export interface ChatMessageDTO {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelKey: string | null;
  providerName: string | null;
  attachments: AttachmentRef[];
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  tokensTotal: number | null;
  durationMs: number | null;
  costEstimate: number | null;
  error: string | null;
  createdAt: string;
}

export interface ConversationDTO {
  id: string;
  title: string;
  mode: 'chat' | 'multi_model' | 'code';
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  activeModelKeys: string[];
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

export type LibraryFolder =
  | 'images'
  | 'videos'
  | 'music'
  | 'audio'
  | 'documents'
  | 'uploads'
  | 'projects';

export interface LibraryFileDTO {
  id: string;
  folder: LibraryFolder;
  name: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MediaJobDTO {
  id: string;
  kind: 'image' | 'video' | 'music' | 'tts' | 'stt';
  providerId: string;
  modelKey: string;
  prompt: string;
  params: Record<string, unknown>;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  remoteJobId: string | null;
  resultFiles: LibraryFileDTO[];
  textOutput: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiLogDTO {
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  endpoint: string;
  statusCode: number | null;
  success: boolean;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  tokensTotal: number | null;
  costAmount: number | null;
  costCurrency: string | null;
  latencyMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export type ChatStudioMode = 'auto' | 'chat' | 'image' | 'video' | 'tts' | 'music' | 'code';

export interface StudioSettings {
  language: 'fa' | 'en';
  theme: 'dark' | 'light';
  defaultSystemPrompt: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  memoryEnabled: boolean;
  searchEndpointUrl: string;
  searchProviderType: 'none' | 'duckduckgo_instant' | 'tavily' | 'serper' | 'custom';
  preferredImageModelKey?: string;
  preferredVideoModelKey?: string;
  preferredTtsModelKey?: string;
  preferredSttModelKey?: string;
  preferredMusicModelKey?: string;
}

export type ActiveView =
  | 'chat'
  | 'image'
  | 'video'
  | 'audio'
  | 'code'
  | 'tools'
  | 'models'
  | 'usage'
  | 'library'
  | 'settings';
