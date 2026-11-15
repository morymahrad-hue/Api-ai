import { DEFAULT_CAPABILITIES, type ProviderRecord } from '../db.ts';
import { sanitizeErrorMessage, validateExternalUrl } from '../crypto.ts';
import type { ModelCapabilities } from '../../src/types.ts';
import {
  joinUrl,
  resolvePath,
  type ChatStreamCallbacks,
  type ChatStreamInput,
  type DiscoveredModel,
  type ProviderAdapter,
} from './types.ts';

function anthropicHeaders(provider: ProviderRecord): Record<string, string> {
  return {
    'x-api-key': provider.apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
    ...provider.customHeaders,
  };
}

export class AnthropicAdapter implements ProviderAdapter {
  async testConnection(provider: ProviderRecord) {
    const start = Date.now();
    try {
      validateExternalUrl(provider.baseUrl, true);
      const url = joinUrl(provider.baseUrl, resolvePath(provider.customPaths, 'models', '/models'));
      const res = await fetch(url, {
        headers: anthropicHeaders(provider),
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
      const data = (await res.json()) as { data?: unknown[] };
      return {
        ok: true,
        latencyMs,
        modelCount: Array.isArray(data.data) ? data.data.length : undefined,
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
    validateExternalUrl(provider.baseUrl, true);
    const url = joinUrl(provider.baseUrl, resolvePath(provider.customPaths, 'models', '/models'));
    const res = await fetch(url, {
      headers: anthropicHeaders(provider),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(sanitizeErrorMessage(`HTTP ${res.status}: ${text}`, [provider.apiKey]));
    }
    const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const items = Array.isArray(json.data) ? json.data : [];
    return items.map((item) => {
      const modelId = String(item.id || '');
      const caps: ModelCapabilities = {
        ...DEFAULT_CAPABILITIES,
        chat: true,
        streaming: true,
        vision: true,
        tools: true,
      };
      return {
        modelId,
        displayName: String(item.display_name || modelId),
        category: 'chat',
        capabilities: caps,
        capabilitiesSource: 'api_metadata',
        contextLength: typeof item.max_tokens === 'number' ? item.max_tokens : null,
        pricingPrompt: null,
        pricingCompletion: null,
        rawMetadata: item,
      };
    });
  }

  async testModel(provider: ProviderRecord, modelId: string) {
    const start = Date.now();
    try {
      validateExternalUrl(provider.baseUrl, true);
      const url = joinUrl(provider.baseUrl, resolvePath(provider.customPaths, 'chat', '/messages'));
      const res = await fetch(url, {
        method: 'POST',
        headers: anthropicHeaders(provider),
        body: JSON.stringify({
          model: modelId,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
        }),
        signal: AbortSignal.timeout(25000),
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
      const data = (await res.json()) as { content?: Array<{ text?: string }> };
      return {
        ok: true,
        latencyMs,
        sampleReply: data.content?.[0]?.text || 'OK',
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
      resolvePath(input.provider.customPaths, 'chat', '/messages')
    );

    const systemText = input.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const messages = input.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        const docTexts = (m.attachments || [])
          .filter((a) => a.extractedText)
          .map((a) => `[Attached file: ${a.name}]\n${a.extractedText}`)
          .join('\n\n');
        const text = docTexts ? `${m.content}\n\n${docTexts}`.trim() : m.content;
        const blocks: Array<Record<string, unknown>> = [];
        for (const att of m.attachments || []) {
          if (att.kind === 'image' && att.base64) {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: att.mimeType,
                data: att.base64,
              },
            });
          }
        }
        if (text) blocks.push({ type: 'text', text });
        return { role: m.role, content: blocks.length ? blocks : text };
      });

    const res = await fetch(url, {
      method: 'POST',
      headers: anthropicHeaders(input.provider),
      body: JSON.stringify({
        model: input.modelId,
        system: systemText || undefined,
        messages,
        max_tokens: input.maxTokens || 4096,
        temperature: input.temperature,
        stream: true,
      }),
      signal: input.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(sanitizeErrorMessage(`HTTP ${res.status}: ${text}`, [input.provider.apiKey]));
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('Response stream unavailable');
    const decoder = new TextDecoder();
    let buffer = '';
    let tokensPrompt: number | null = null;
    let tokensCompletion: number | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        try {
          const event = JSON.parse(line.slice(5).trim()) as {
            type?: string;
            delta?: { text?: string };
            message?: { usage?: { input_tokens?: number } };
            usage?: { output_tokens?: number };
          };
          if (event.type === 'content_block_delta' && event.delta?.text) {
            callbacks.onDelta(event.delta.text);
          }
          if (event.message?.usage?.input_tokens !== undefined) {
            tokensPrompt = event.message.usage.input_tokens;
          }
          if (event.usage?.output_tokens !== undefined) {
            tokensCompletion = event.usage.output_tokens;
          }
        } catch {
          // ignore
        }
      }
    }

    const tokensTotal =
      tokensPrompt !== null || tokensCompletion !== null
        ? (tokensPrompt || 0) + (tokensCompletion || 0)
        : null;

    callbacks.onDone({
      tokensPrompt,
      tokensCompletion,
      tokensTotal,
      costAmount: null,
      costCurrency: null,
    });
  }
}
