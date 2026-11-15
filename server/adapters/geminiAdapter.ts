import { GoogleGenAI, type Part } from '@google/genai';
import { DEFAULT_CAPABILITIES, type ProviderRecord } from '../db.ts';
import { sanitizeErrorMessage, validateExternalUrl } from '../crypto.ts';
import type { ModelCapabilities, ModelCategory } from '../../src/types.ts';
import type {
  AudioSttInput,
  AudioTtsInput,
  ChatStreamCallbacks,
  ChatStreamInput,
  DiscoveredModel,
  GeneratedMediaAsset,
  ImageGenInput,
  ProviderAdapter,
} from './types.ts';

function createGeminiClient(provider: ProviderRecord): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: provider.apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
        ...provider.customHeaders,
      },
    },
  });
}

function getGeminiApiBase(provider: ProviderRecord): string {
  const base = provider.baseUrl?.trim();
  if (base && base.startsWith('http')) {
    validateExternalUrl(base, true);
    return base.replace(/\/+$/, '');
  }
  return 'https://generativelanguage.googleapis.com/v1beta';
}

export class GoogleGeminiAdapter implements ProviderAdapter {
  async testConnection(provider: ProviderRecord) {
    const start = Date.now();
    try {
      const base = getGeminiApiBase(provider);
      const res = await fetch(`${base}/models?pageSize=100`, {
        headers: {
          'x-goog-api-key': provider.apiKey,
          ...provider.customHeaders,
        },
        signal: AbortSignal.timeout(15000),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return {
          ok: false,
          latencyMs,
          error: sanitizeErrorMessage(`HTTP ${res.status}: ${text}`, [provider.apiKey]),
        };
      }
      const data = (await res.json()) as { models?: unknown[] };
      return {
        ok: true,
        latencyMs,
        modelCount: Array.isArray(data.models) ? data.models.length : undefined,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: sanitizeErrorMessage(err, [provider.apiKey]),
      };
    }
  }

  async fetchModels(provider: ProviderRecord): Promise<DiscoveredModel[]> {
    const base = getGeminiApiBase(provider);
    const res = await fetch(`${base}/models?pageSize=200`, {
      headers: {
        'x-goog-api-key': provider.apiKey,
        ...provider.customHeaders,
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(sanitizeErrorMessage(`HTTP ${res.status}: ${text}`, [provider.apiKey]));
    }
    const json = (await res.json()) as {
      models?: Array<Record<string, unknown>>;
    };
    const models = Array.isArray(json.models) ? json.models : [];
    return models.map((m) => {
      const fullName = String(m.name || '');
      const modelId = fullName.replace(/^models\//, '');
      const displayName = String(m.displayName || modelId);
      const methods = Array.isArray(m.supportedGenerationMethods)
        ? m.supportedGenerationMethods.map(String)
        : [];
      const caps: ModelCapabilities = { ...DEFAULT_CAPABILITIES };
      if (methods.includes('generateContent')) {
        caps.chat = true;
        caps.streaming = true;
        caps.vision = true;
        caps.tools = true;
        caps.jsonMode = true;
      }
      if (methods.includes('predict') || methods.includes('generateImages')) {
        caps.imageGen = true;
      }
      let category: ModelCategory = 'other';
      if (caps.imageGen && !caps.chat) category = 'image';
      else if (methods.includes('embedContent')) category = 'embedding';
      else if (caps.chat) category = 'chat';

      return {
        modelId,
        displayName,
        category,
        capabilities: caps,
        capabilitiesSource: methods.length > 0 ? 'api_metadata' : 'unverified',
        contextLength: typeof m.inputTokenLimit === 'number' ? m.inputTokenLimit : null,
        pricingPrompt: null,
        pricingCompletion: null,
        rawMetadata: m,
      };
    });
  }

  async testModel(provider: ProviderRecord, modelId: string) {
    const start = Date.now();
    try {
      const ai = createGeminiClient(provider);
      const response = await ai.models.generateContent({
        model: modelId,
        contents: 'Reply with OK.',
      });
      return {
        ok: true,
        latencyMs: Date.now() - start,
        sampleReply: response.text?.trim() || 'OK',
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
    const ai = createGeminiClient(input.provider);
    const systemMessages = input.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const contents = input.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        const parts: Part[] = [];
        const docTexts = (m.attachments || [])
          .filter((a) => a.extractedText)
          .map((a) => `[Attached file: ${a.name}]\n${a.extractedText}`)
          .join('\n\n');
        const text = docTexts ? `${m.content}\n\n${docTexts}`.trim() : m.content;
        if (text) parts.push({ text });
        for (const att of m.attachments || []) {
          if (att.base64 && (att.kind === 'image' || att.kind === 'audio' || att.kind === 'video')) {
            parts.push({
              inlineData: {
                mimeType: att.mimeType,
                data: att.base64,
              },
            });
          }
        }
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts,
        };
      });

    const stream = await ai.models.generateContentStream({
      model: input.modelId,
      contents,
      config: systemMessages ? { systemInstruction: systemMessages } : undefined,
    });

    let tokensPrompt: number | null = null;
    let tokensCompletion: number | null = null;
    let tokensTotal: number | null = null;

    for await (const chunk of stream) {
      if (input.signal.aborted) break;
      if (chunk.text) callbacks.onDelta(chunk.text);
      if (chunk.usageMetadata) {
        tokensPrompt = chunk.usageMetadata.promptTokenCount ?? tokensPrompt;
        tokensCompletion = chunk.usageMetadata.candidatesTokenCount ?? tokensCompletion;
        tokensTotal = chunk.usageMetadata.totalTokenCount ?? tokensTotal;
      }
    }

    callbacks.onDone({
      tokensPrompt,
      tokensCompletion,
      tokensTotal,
      costAmount: null,
      costCurrency: null,
    });
  }

  async generateImage(input: ImageGenInput): Promise<GeneratedMediaAsset[]> {
    const ai = createGeminiClient(input.provider);
    const parts: Part[] = [{ text: input.prompt }];
    if (input.referenceImageBase64) {
      parts.unshift({
        inlineData: {
          mimeType: input.referenceImageMime || 'image/png',
          data: input.referenceImageBase64,
        },
      });
    }
    const response = await ai.models.generateContent({
      model: input.modelId,
      contents: { parts },
    });
    const assets: GeneratedMediaAsset[] = [];
    const candidates = response.candidates || [];
    for (const cand of candidates) {
      for (const part of cand.content?.parts || []) {
        if (part.inlineData?.data) {
          assets.push({
            buffer: Buffer.from(part.inlineData.data, 'base64'),
            mimeType: part.inlineData.mimeType || 'image/png',
            filename: `gemini_image_${Date.now()}_${assets.length + 1}.png`,
          });
        }
      }
    }
    if (assets.length === 0) {
      throw new Error('Selected Gemini model did not return image bytes.');
    }
    return assets;
  }

  async transcribeAudio(input: AudioSttInput): Promise<{ text: string }> {
    const ai = createGeminiClient(input.provider);
    const prompt = input.responseFormat === 'srt'
      ? 'Transcribe this audio accurately and output standard SRT subtitles with timestamps.'
      : input.responseFormat === 'vtt'
        ? 'Transcribe this audio accurately and output standard WebVTT subtitles with timestamps.'
        : `Transcribe this audio accurately${input.language ? ` in ${input.language}` : ''}. Output only the transcription.`;

    const response = await ai.models.generateContent({
      model: input.modelId,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: input.mimeType || 'audio/mpeg',
              data: input.audioBuffer.toString('base64'),
            },
          },
          { text: prompt },
        ],
      },
    });
    return { text: response.text || '' };
  }

  async textToSpeech(input: AudioTtsInput): Promise<GeneratedMediaAsset> {
    const ai = createGeminiClient(input.provider);
    const response = await ai.models.generateContent({
      model: input.modelId,
      contents: input.text,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: input.voice
          ? {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: input.voice },
              },
            }
          : undefined,
      },
    });
    const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) {
      throw new Error('Selected Gemini model did not return audio data.');
    }
    return {
      buffer: Buffer.from(part.inlineData.data, 'base64'),
      mimeType: part.inlineData.mimeType || 'audio/wav',
      filename: `gemini_speech_${Date.now()}.wav`,
    };
  }
}
