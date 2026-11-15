import { DEFAULT_CAPABILITIES, type ProviderRecord } from '../db.ts';
import { sanitizeErrorMessage, validateExternalUrl } from '../crypto.ts';
import type { ModelCapabilities, ModelCategory } from '../../src/types.ts';
import {
  joinUrl,
  resolvePath,
  type AudioSttInput,
  type AudioTtsInput,
  type ChatStreamCallbacks,
  type ChatStreamInput,
  type DiscoveredModel,
  type GeneratedMediaAsset,
  type ImageGenInput,
  type MusicGenInput,
  type ProviderAdapter,
  type VideoGenInput,
  type VideoGenResult,
} from './types.ts';

function buildHeaders(provider: ProviderRecord, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${provider.apiKey}`,
    ...provider.customHeaders,
    ...extra,
  };
}

function extractCapabilitiesFromMetadata(raw: Record<string, unknown>): {
  capabilities: ModelCapabilities;
  category: ModelCategory;
  source: DiscoveredModel['capabilitiesSource'];
} {
  const caps: ModelCapabilities = { ...DEFAULT_CAPABILITIES };
  let hasExplicitMeta = false;
  let category: ModelCategory = 'other';

  // 1. Direct capabilities object (e.g., LiteLLM, Respan, OpenRouter, custom gateways)
  const rawCaps = raw.capabilities as Record<string, unknown> | undefined;
  if (rawCaps && typeof rawCaps === 'object') {
    hasExplicitMeta = true;
    if (rawCaps.chat || rawCaps.text || rawCaps.completion) caps.chat = true;
    if (rawCaps.streaming) caps.streaming = true;
    if (rawCaps.vision || rawCaps.image_input) caps.vision = true;
    if (rawCaps.image_generation || rawCaps.imageGen) caps.imageGen = true;
    if (rawCaps.image_edit || rawCaps.imageEdit) caps.imageEdit = true;
    if (rawCaps.inpainting) caps.inpainting = true;
    if (rawCaps.background_removal || rawCaps.backgroundRemoval) caps.backgroundRemoval = true;
    if (rawCaps.video_generation || rawCaps.videoGen) caps.videoGen = true;
    if (rawCaps.audio_tts || rawCaps.tts || rawCaps.text_to_speech) caps.audioTts = true;
    if (rawCaps.audio_stt || rawCaps.stt || rawCaps.transcription) caps.audioStt = true;
    if (rawCaps.music_generation || rawCaps.musicGen) caps.musicGen = true;
    if (rawCaps.function_calling || rawCaps.tools) caps.tools = true;
    if (rawCaps.json_mode || rawCaps.structured_outputs) caps.jsonMode = true;
  }

  // 2. OpenRouter / Respan architecture & modality fields
  const arch = raw.architecture as Record<string, unknown> | undefined;
  if (arch && typeof arch === 'object') {
    hasExplicitMeta = true;
    const inputMods = Array.isArray(arch.input_modalities)
      ? arch.input_modalities.map(String)
      : typeof arch.modality === 'string'
        ? arch.modality.split('->')[0].split('+')
        : [];
    const outputMods = Array.isArray(arch.output_modalities)
      ? arch.output_modalities.map(String)
      : typeof arch.modality === 'string'
        ? (arch.modality.split('->')[1] || '').split('+')
        : [];

    if (inputMods.includes('text') && outputMods.includes('text')) {
      caps.chat = true;
      caps.streaming = true;
    }
    if (inputMods.includes('image')) caps.vision = true;
    if (outputMods.includes('image')) caps.imageGen = true;
    if (outputMods.includes('video')) caps.videoGen = true;
    if (outputMods.includes('audio')) caps.audioTts = true;
    if (inputMods.includes('audio')) caps.audioStt = true;
  }

  // 3. supported_parameters / supported_generation_methods / mode
  const supportedParams = Array.isArray(raw.supported_parameters)
    ? raw.supported_parameters.map(String)
    : [];
  if (supportedParams.length > 0) {
    hasExplicitMeta = true;
    if (supportedParams.includes('tools')) caps.tools = true;
    if (supportedParams.includes('response_format') || supportedParams.includes('structured_outputs')) {
      caps.jsonMode = true;
    }
  }

  const modeStr = typeof raw.mode === 'string' ? raw.mode.toLowerCase() : '';
  if (modeStr) {
    hasExplicitMeta = true;
    if (modeStr === 'chat') {
      caps.chat = true;
      caps.streaming = true;
    } else if (modeStr === 'image_generation') {
      caps.imageGen = true;
    } else if (modeStr === 'audio_speech') {
      caps.audioTts = true;
    } else if (modeStr === 'audio_transcription') {
      caps.audioStt = true;
    } else if (modeStr === 'embedding') {
      category = 'embedding';
    }
  }

  if (caps.imageGen) category = 'image';
  else if (caps.videoGen) category = 'video';
  else if (caps.musicGen) category = 'music';
  else if (caps.audioTts || caps.audioStt) category = 'audio';
  else if (caps.vision) category = 'vision';
  else if (caps.chat) category = 'chat';

  return {
    capabilities: caps,
    category,
    source: hasExplicitMeta ? 'api_metadata' : 'unverified',
  };
}

function parseNumeric(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function parseErrorResponse(res: Response, apiKey: string): Promise<string> {
  const text = await res.text().catch(() => '');
  let detail = text;
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof json.error === 'string') detail = json.error;
    else if (json.error?.message) detail = json.error.message;
    else if (json.message) detail = json.message;
  } catch {
    // keep raw text
  }
  return sanitizeErrorMessage(`HTTP ${res.status}: ${detail || res.statusText}`, [apiKey]);
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  async testConnection(provider: ProviderRecord) {
    const start = Date.now();
    try {
      validateExternalUrl(provider.baseUrl, true);
      const url = joinUrl(provider.baseUrl, resolvePath(provider.customPaths, 'models', '/models'));
      const res = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(provider),
        signal: AbortSignal.timeout(15000),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return { ok: false, latencyMs, error: await parseErrorResponse(res, provider.apiKey) };
      }
      const data = (await res.json()) as { data?: unknown[] };
      const modelCount = Array.isArray(data?.data) ? data.data.length : undefined;
      return { ok: true, latencyMs, modelCount };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: sanitizeErrorMessage(err, [provider.apiKey]),
      };
    }
  }

  async fetchModels(provider: ProviderRecord): Promise<DiscoveredModel[]> {
    validateExternalUrl(provider.baseUrl, true);
    const url = joinUrl(provider.baseUrl, resolvePath(provider.customPaths, 'models', '/models'));
    const res = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(provider),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      throw new Error(await parseErrorResponse(res, provider.apiKey));
    }
    const payload = (await res.json()) as { data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const items = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];

    return items
      .filter((item) => typeof item?.id === 'string' && item.id.trim().length > 0)
      .map((item) => {
        const modelId = String(item.id);
        const displayName = typeof item.name === 'string' && item.name.trim() ? item.name : modelId;
        const { capabilities, category, source } = extractCapabilitiesFromMetadata(item);
        const contextLength =
          parseNumeric(item.context_length) ??
          parseNumeric(item.max_context_tokens) ??
          parseNumeric((item.top_provider as Record<string, unknown> | undefined)?.context_length);

        const pricing = item.pricing as Record<string, unknown> | undefined;
        let pricingPrompt = parseNumeric(pricing?.prompt);
        let pricingCompletion = parseNumeric(pricing?.completion);
        // OpenRouter returns per-token price; normalize small per-token prices to per-1M if < 0.01
        if (pricingPrompt !== null && pricingPrompt > 0 && pricingPrompt < 0.01) {
          pricingPrompt = Number((pricingPrompt * 1_000_000).toFixed(4));
        }
        if (pricingCompletion !== null && pricingCompletion > 0 && pricingCompletion < 0.01) {
          pricingCompletion = Number((pricingCompletion * 1_000_000).toFixed(4));
        }

        return {
          modelId,
          displayName,
          category,
          capabilities,
          capabilitiesSource: source,
          contextLength,
          pricingPrompt,
          pricingCompletion,
          rawMetadata: item,
        };
      });
  }

  async testModel(provider: ProviderRecord, modelId: string) {
    const start = Date.now();
    try {
      validateExternalUrl(provider.baseUrl, true);
      const url = joinUrl(
        provider.baseUrl,
        resolvePath(provider.customPaths, 'chat', '/chat/completions')
      );
      const res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(provider, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 16,
          stream: false,
        }),
        signal: AbortSignal.timeout(25000),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return { ok: false, latencyMs, error: await parseErrorResponse(res, provider.apiKey) };
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const sampleReply = data.choices?.[0]?.message?.content?.trim() || 'OK';
      return {
        ok: true,
        latencyMs,
        sampleReply,
        detectedCapabilities: { chat: true, streaming: true },
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: sanitizeErrorMessage(err, [provider.apiKey]),
      };
    }
  }

  async streamChat(input: ChatStreamInput, callbacks: ChatStreamCallbacks): Promise<void> {
    validateExternalUrl(input.provider.baseUrl, true);
    const url = joinUrl(
      input.provider.baseUrl,
      resolvePath(input.provider.customPaths, 'chat', '/chat/completions')
    );

    const formattedMessages = input.messages.map((m) => {
      const hasImages = m.attachments?.some((a) => a.kind === 'image' && a.base64);
      const docTexts = (m.attachments || [])
        .filter((a) => a.extractedText)
        .map((a) => `[Attached file: ${a.name}]\n${a.extractedText}`)
        .join('\n\n');
      const fullText = docTexts ? `${m.content}\n\n${docTexts}`.trim() : m.content;

      if (!hasImages) {
        return { role: m.role, content: fullText };
      }

      const parts: Array<Record<string, unknown>> = [];
      if (fullText) parts.push({ type: 'text', text: fullText });
      for (const att of m.attachments || []) {
        if (att.kind === 'image' && att.base64) {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${att.mimeType};base64,${att.base64}` },
          });
        }
      }
      return { role: m.role, content: parts };
    });

    const baseBody: Record<string, unknown> = {
      model: input.modelId,
      messages: formattedMessages,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    };

    let res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(input.provider, {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      }),
      body: JSON.stringify(baseBody),
      signal: input.signal,
    });

    // Some OpenAI-compatible gateways reject stream_options; retry seamlessly without it
    if (!res.ok && res.status === 400) {
      delete baseBody.stream_options;
      res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(input.provider, {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        }),
        body: JSON.stringify(baseBody),
        signal: input.signal,
      });
    }

    if (!res.ok) {
      throw new Error(await parseErrorResponse(res, input.provider.apiKey));
    }

    const headerCostRaw = res.headers.get('x-respan-cost') || res.headers.get('x-usage-cost');
    let costAmount: number | null = headerCostRaw ? parseNumeric(headerCostRaw) : null;
    let costCurrency: string | null = costAmount !== null ? 'USD' : null;
    let tokensPrompt: number | null = null;
    let tokensCompletion: number | null = null;
    let tokensTotal: number | null = null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream') && contentType.includes('application/json')) {
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          cost?: number;
        };
      };
      const text = json.choices?.[0]?.message?.content || '';
      if (text) callbacks.onDelta(text);
      if (json.usage) {
        tokensPrompt = parseNumeric(json.usage.prompt_tokens);
        tokensCompletion = parseNumeric(json.usage.completion_tokens);
        tokensTotal = parseNumeric(json.usage.total_tokens);
        if (json.usage.cost !== undefined) {
          costAmount = parseNumeric(json.usage.cost);
          costCurrency = 'USD';
        }
      }
      callbacks.onDone({ tokensPrompt, tokensCompletion, tokensTotal, costAmount, costCurrency });
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('Response stream unavailable');
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;
        const dataStr = line.slice(5).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(dataStr) as {
            choices?: Array<{
              delta?: { content?: string; reasoning_content?: string };
              message?: { content?: string };
            }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
              cost?: number;
            };
          };
          const delta = parsed.choices?.[0]?.delta;
          const content = delta?.content ?? parsed.choices?.[0]?.message?.content;
          if (content) callbacks.onDelta(content);
          if (parsed.usage) {
            tokensPrompt = parseNumeric(parsed.usage.prompt_tokens) ?? tokensPrompt;
            tokensCompletion = parseNumeric(parsed.usage.completion_tokens) ?? tokensCompletion;
            tokensTotal = parseNumeric(parsed.usage.total_tokens) ?? tokensTotal;
            if (parsed.usage.cost !== undefined) {
              costAmount = parseNumeric(parsed.usage.cost);
              costCurrency = 'USD';
            }
          }
        } catch {
          // ignore malformed SSE chunk
        }
      }
    }

    callbacks.onDone({ tokensPrompt, tokensCompletion, tokensTotal, costAmount, costCurrency });
  }

  async generateImage(input: ImageGenInput): Promise<GeneratedMediaAsset[]> {
    validateExternalUrl(input.provider.baseUrl, true);
    const isEdit = input.mode === 'img2img' || input.mode === 'inpaint';
    const url = joinUrl(
      input.provider.baseUrl,
      isEdit
        ? resolvePath(input.provider.customPaths, 'imageEdits', '/images/edits')
        : resolvePath(input.provider.customPaths, 'images', '/images/generations')
    );

    let res: Response;
    if (isEdit && input.referenceImageBase64) {
      const form = new FormData();
      form.append('model', input.modelId);
      form.append('prompt', input.prompt);
      if (input.size) form.append('size', input.size);
      if (input.n) form.append('n', String(input.n));
      const refBuf = Buffer.from(input.referenceImageBase64, 'base64');
      form.append(
        'image',
        new Blob([refBuf], { type: input.referenceImageMime || 'image/png' }),
        'reference.png'
      );
      if (input.maskImageBase64) {
        const maskBuf = Buffer.from(input.maskImageBase64, 'base64');
        form.append(
          'mask',
          new Blob([maskBuf], { type: input.maskImageMime || 'image/png' }),
          'mask.png'
        );
      }
      res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(input.provider),
        body: form,
        signal: AbortSignal.timeout(90000),
      });
    } else {
      const body: Record<string, unknown> = {
        model: input.modelId,
        prompt: input.prompt,
        n: input.n ?? 1,
      };
      if (input.size) body.size = input.size;
      if (input.quality) body.quality = input.quality;
      if (input.negativePrompt) body.negative_prompt = input.negativePrompt;
      if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
      body.response_format = 'b64_json';

      res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(input.provider, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });
    }

    if (!res.ok) {
      throw new Error(await parseErrorResponse(res, input.provider.apiKey));
    }

    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const items = json.data || [];
    const assets: GeneratedMediaAsset[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.b64_json) {
        assets.push({
          buffer: Buffer.from(item.b64_json, 'base64'),
          mimeType: 'image/png',
          filename: `image_${Date.now()}_${i + 1}.png`,
        });
      } else if (item.url) {
        validateExternalUrl(item.url, false);
        const imgRes = await fetch(item.url, { signal: AbortSignal.timeout(30000) });
        if (!imgRes.ok) throw new Error(`Failed downloading generated image (${imgRes.status})`);
        const arr = Buffer.from(await imgRes.arrayBuffer());
        const mime = imgRes.headers.get('content-type') || 'image/png';
        assets.push({
          buffer: arr,
          mimeType: mime,
          filename: `image_${Date.now()}_${i + 1}.${mime.includes('jpeg') ? 'jpg' : 'png'}`,
        });
      }
    }
    if (assets.length === 0) {
      throw new Error('Provider returned no image data.');
    }
    return assets;
  }

  async generateVideo(input: VideoGenInput): Promise<VideoGenResult> {
    validateExternalUrl(input.provider.baseUrl, true);
    const url = joinUrl(
      input.provider.baseUrl,
      resolvePath(input.provider.customPaths, 'videos', '/videos')
    );

    const body: Record<string, unknown> = {
      model: input.modelId,
      prompt: input.prompt,
    };
    if (input.durationSec) body.seconds = input.durationSec;
    if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
    if (input.quality) body.quality = input.quality;
    if (input.referenceBase64) {
      body.image = `data:${input.referenceMime || 'image/png'};base64,${input.referenceBase64}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(input.provider, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      throw new Error(await parseErrorResponse(res, input.provider.apiKey));
    }

    const json = (await res.json()) as {
      id?: string;
      status?: string;
      url?: string;
      data?: Array<{ url?: string; b64_json?: string }>;
    };

    const directUrl = json.url || json.data?.[0]?.url;
    if (directUrl) {
      validateExternalUrl(directUrl, false);
      const vidRes = await fetch(directUrl, { signal: AbortSignal.timeout(60000) });
      const buf = Buffer.from(await vidRes.arrayBuffer());
      return {
        status: 'completed',
        assets: [
          {
            buffer: buf,
            mimeType: vidRes.headers.get('content-type') || 'video/mp4',
            filename: `video_${Date.now()}.mp4`,
          },
        ],
      };
    }

    if (json.id) {
      return {
        status: 'processing',
        remoteJobId: json.id,
      };
    }

    throw new Error('Provider did not return a video URL or async job ID.');
  }

  async pollVideo(provider: ProviderRecord, remoteJobId: string): Promise<VideoGenResult> {
    validateExternalUrl(provider.baseUrl, true);
    const basePath = resolvePath(provider.customPaths, 'videoStatus', '/videos');
    const url = joinUrl(provider.baseUrl, `${basePath.replace(/\/+$/, '')}/${encodeURIComponent(remoteJobId)}`);
    const res = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(provider),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      throw new Error(await parseErrorResponse(res, provider.apiKey));
    }
    const json = (await res.json()) as {
      status?: string;
      url?: string;
      output_url?: string;
      error?: string | { message?: string };
    };
    const state = (json.status || '').toLowerCase();
    if (state === 'failed' || state === 'error' || state === 'cancelled') {
      const msg = typeof json.error === 'string' ? json.error : json.error?.message || 'Video generation failed';
      throw new Error(msg);
    }
    const videoUrl = json.url || json.output_url;
    if ((state === 'completed' || state === 'succeeded' || state === 'done') && videoUrl) {
      validateExternalUrl(videoUrl, false);
      const vidRes = await fetch(videoUrl, { signal: AbortSignal.timeout(60000) });
      const buf = Buffer.from(await vidRes.arrayBuffer());
      return {
        status: 'completed',
        remoteJobId,
        assets: [
          {
            buffer: buf,
            mimeType: vidRes.headers.get('content-type') || 'video/mp4',
            filename: `video_${Date.now()}.mp4`,
          },
        ],
      };
    }
    return { status: 'processing', remoteJobId };
  }

  async textToSpeech(input: AudioTtsInput): Promise<GeneratedMediaAsset> {
    validateExternalUrl(input.provider.baseUrl, true);
    const url = joinUrl(
      input.provider.baseUrl,
      resolvePath(input.provider.customPaths, 'audioSpeech', '/audio/speech')
    );
    const body: Record<string, unknown> = {
      model: input.modelId,
      input: input.text,
      voice: input.voice || 'alloy',
      response_format: input.format || 'mp3',
    };
    if (input.speed) body.speed = input.speed;

    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(input.provider, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      throw new Error(await parseErrorResponse(res, input.provider.apiKey));
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'audio/mpeg';
    return {
      buffer: buf,
      mimeType: mime,
      filename: `speech_${Date.now()}.${input.format || 'mp3'}`,
    };
  }

  async transcribeAudio(input: AudioSttInput): Promise<{ text: string }> {
    validateExternalUrl(input.provider.baseUrl, true);
    const url = joinUrl(
      input.provider.baseUrl,
      resolvePath(input.provider.customPaths, 'audioTranscriptions', '/audio/transcriptions')
    );
    const form = new FormData();
    form.append('model', input.modelId);
    form.append(
      'file',
      new Blob([new Uint8Array(input.audioBuffer)], { type: input.mimeType || 'audio/mpeg' }),
      input.filename
    );
    if (input.language) form.append('language', input.language);
    if (input.responseFormat) form.append('response_format', input.responseFormat);

    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(input.provider),
      body: form,
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) {
      throw new Error(await parseErrorResponse(res, input.provider.apiKey));
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = (await res.json()) as { text?: string };
      return { text: json.text || '' };
    }
    return { text: await res.text() };
  }

  async generateMusic(input: MusicGenInput): Promise<GeneratedMediaAsset[]> {
    validateExternalUrl(input.provider.baseUrl, true);
    const url = joinUrl(
      input.provider.baseUrl,
      resolvePath(input.provider.customPaths, 'music', '/music/generations')
    );
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(input.provider, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model: input.modelId,
        prompt: input.prompt,
        style: input.style,
        instrumental: input.instrumental ?? true,
        duration_seconds: input.durationSec ?? 30,
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) {
      throw new Error(await parseErrorResponse(res, input.provider.apiKey));
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.startsWith('audio/')) {
      return [
        {
          buffer: Buffer.from(await res.arrayBuffer()),
          mimeType: contentType,
          filename: `music_${Date.now()}.mp3`,
        },
      ];
    }
    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      audio_url?: string;
    };
    const assets: GeneratedMediaAsset[] = [];
    const list = json.data || (json.audio_url ? [{ url: json.audio_url }] : []);
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (entry.b64_json) {
        assets.push({
          buffer: Buffer.from(entry.b64_json, 'base64'),
          mimeType: 'audio/mpeg',
          filename: `music_${Date.now()}_${i + 1}.mp3`,
        });
      } else if (entry.url) {
        validateExternalUrl(entry.url, false);
        const audioRes = await fetch(entry.url, { signal: AbortSignal.timeout(60000) });
        assets.push({
          buffer: Buffer.from(await audioRes.arrayBuffer()),
          mimeType: audioRes.headers.get('content-type') || 'audio/mpeg',
          filename: `music_${Date.now()}_${i + 1}.mp3`,
        });
      }
    }
    if (assets.length === 0) throw new Error('Provider returned no audio data.');
    return assets;
  }
}
