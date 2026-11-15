import type {
  ModelCapabilities,
  ModelCategory,
  ProviderPaths,
} from '../../src/types.ts';
import type { ProviderRecord } from '../db.ts';

export interface DiscoveredModel {
  modelId: string;
  displayName: string;
  category: ModelCategory;
  capabilities: ModelCapabilities;
  capabilitiesSource: 'api_metadata' | 'tested' | 'manual' | 'unverified';
  contextLength: number | null;
  pricingPrompt: number | null;
  pricingCompletion: number | null;
  rawMetadata: Record<string, unknown>;
}

export interface ChatTurnMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  attachments?: Array<{
    name: string;
    mimeType: string;
    kind: 'image' | 'audio' | 'video' | 'document' | 'code' | 'archive';
    base64?: string;
    extractedText?: string;
  }>;
}

export interface ChatStreamCallbacks {
  onDelta: (textChunk: string) => void;
  onDone: (meta: {
    tokensPrompt: number | null;
    tokensCompletion: number | null;
    tokensTotal: number | null;
    costAmount: number | null;
    costCurrency: string | null;
  }) => void;
}

export interface ChatStreamInput {
  provider: ProviderRecord;
  modelId: string;
  messages: ChatTurnMessage[];
  temperature: number;
  maxTokens: number;
  signal: AbortSignal;
}

export interface ImageGenInput {
  provider: ProviderRecord;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  n?: number;
  mode: 'txt2img' | 'img2img' | 'inpaint' | 'remove_bg';
  referenceImageBase64?: string;
  referenceImageMime?: string;
  maskImageBase64?: string;
  maskImageMime?: string;
}

export interface GeneratedMediaAsset {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export interface VideoGenInput {
  provider: ProviderRecord;
  modelId: string;
  prompt: string;
  mode: 'txt2vid' | 'img2vid' | 'vid2vid';
  durationSec?: number;
  aspectRatio?: string;
  quality?: string;
  referenceBase64?: string;
  referenceMime?: string;
}

export interface VideoGenResult {
  status: 'completed' | 'processing';
  remoteJobId?: string;
  assets?: GeneratedMediaAsset[];
  statusEndpoint?: string;
}

export interface AudioTtsInput {
  provider: ProviderRecord;
  modelId: string;
  text: string;
  voice?: string;
  speed?: number;
  format?: string;
  referenceAudioBase64?: string;
  referenceAudioMime?: string;
  voiceCloneConsent?: boolean;
}

export interface AudioSttInput {
  provider: ProviderRecord;
  modelId: string;
  audioBuffer: Buffer;
  filename: string;
  mimeType: string;
  language?: string;
  responseFormat?: 'json' | 'srt' | 'vtt' | 'text';
}

export interface MusicGenInput {
  provider: ProviderRecord;
  modelId: string;
  prompt: string;
  style?: string;
  instrumental?: boolean;
  durationSec?: number;
  mode: 'music' | 'beat' | 'ambient' | 'sfx' | 'vocals';
}

export interface ProviderAdapter {
  testConnection(provider: ProviderRecord): Promise<{
    ok: boolean;
    latencyMs: number;
    modelCount?: number;
    error?: string;
  }>;
  fetchModels(provider: ProviderRecord): Promise<DiscoveredModel[]>;
  testModel(
    provider: ProviderRecord,
    modelId: string
  ): Promise<{
    ok: boolean;
    latencyMs: number;
    sampleReply?: string;
    detectedCapabilities?: Partial<ModelCapabilities>;
    error?: string;
  }>;
  streamChat(input: ChatStreamInput, callbacks: ChatStreamCallbacks): Promise<void>;
  generateImage?(input: ImageGenInput): Promise<GeneratedMediaAsset[]>;
  generateVideo?(input: VideoGenInput): Promise<VideoGenResult>;
  pollVideo?(provider: ProviderRecord, remoteJobId: string, modelId: string): Promise<VideoGenResult>;
  textToSpeech?(input: AudioTtsInput): Promise<GeneratedMediaAsset>;
  transcribeAudio?(input: AudioSttInput): Promise<{ text: string }>;
  generateMusic?(input: MusicGenInput): Promise<GeneratedMediaAsset[]>;
}

export function joinUrl(baseUrl: string, pathSegment: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = pathSegment.startsWith('/') ? pathSegment : `/${pathSegment}`;
  return `${cleanBase}${cleanPath}`;
}

export function resolvePath(paths: ProviderPaths, key: keyof ProviderPaths, fallback: string): string {
  const custom = paths[key];
  return custom && custom.trim() ? custom.trim() : fallback;
}
