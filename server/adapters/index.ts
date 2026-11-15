import type { AdapterType } from '../../src/types.ts';
import { AnthropicAdapter } from './anthropicAdapter.ts';
import { GoogleGeminiAdapter } from './geminiAdapter.ts';
import { OpenAICompatibleAdapter } from './openaiAdapter.ts';
import type { ProviderAdapter } from './types.ts';

const openaiAdapter = new OpenAICompatibleAdapter();
const geminiAdapter = new GoogleGeminiAdapter();
const anthropicAdapter = new AnthropicAdapter();

export function getAdapter(type: AdapterType): ProviderAdapter {
  switch (type) {
    case 'google_gemini':
      return geminiAdapter;
    case 'anthropic':
      return anthropicAdapter;
    case 'openai_compatible':
    case 'custom_http':
    default:
      return openaiAdapter;
  }
}
