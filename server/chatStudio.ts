import fs from 'node:fs';
import type { AttachmentRef, ModelDTO, StudioSettings } from '../src/types.ts';
import { getAdapter } from './adapters/index.ts';
import {
  getLibraryFile,
  getModelByKey,
  getProviderWithKey,
  listModels,
  logApiCall,
} from './db.ts';
import { sanitizeErrorMessage } from './crypto.ts';
import {
  materializeStudioFile,
  materializeStudioProjectZip,
} from './fileGenerator.ts';
import { classifyAttachmentKind, saveBufferToLibrary } from './files.ts';

export function resolveStudioModel(
  modality: 'image' | 'video' | 'tts' | 'music' | 'stt',
  settings: StudioSettings,
  fallbackKey?: string
): ModelDTO | null {
  const prefMap: Record<typeof modality, string | undefined> = {
    image: settings.preferredImageModelKey,
    video: settings.preferredVideoModelKey,
    tts: settings.preferredTtsModelKey,
    music: settings.preferredMusicModelKey,
    stt: settings.preferredSttModelKey,
  };

  const preferred = prefMap[modality];
  if (preferred) {
    const m = getModelByKey(preferred);
    if (m && m.isEnabled) return m;
  }

  const enabled = listModels({ enabledOnly: true });
  const match = enabled.find((m) => {
    if (modality === 'image') return m.capabilities.imageGen || m.category === 'image';
    if (modality === 'video') return m.capabilities.videoGen || m.category === 'video';
    if (modality === 'tts') return m.capabilities.audioTts || m.category === 'audio';
    if (modality === 'music') return m.capabilities.musicGen || m.category === 'music';
    if (modality === 'stt') return m.capabilities.audioStt || m.category === 'audio';
    return false;
  });

  if (match) return match;
  if (fallbackKey) {
    const fb = getModelByKey(fallbackKey);
    if (fb && fb.isEnabled) return fb;
  }
  return null;
}

export function buildUnifiedStudioSystemAddendum(settings: StudioSettings): string {
  const imgModel = resolveStudioModel('image', settings);
  const vidModel = resolveStudioModel('video', settings);
  const ttsModel = resolveStudioModel('tts', settings);
  const musicModel = resolveStudioModel('music', settings);

  const lines = [
    '',
    '=== MAHRAD UNIFIED STUDIO & FILE GENERATION PROTOCOL ===',
    'You operate inside MAHRAD AI STUDIO Unified Smart Chat.',
    '1. DOWNLOADABLE FILES: Whenever the user asks you to create, export, or give them ANY file (Word .docx, Excel .xlsx, PDF .pdf, CSV .csv, JSON .json, XML .xml, HTML .html, SVG .svg, Markdown .md, TXT .txt, SRT/VTT subtitles, Python/TypeScript/JS/SQL/CSS code file), output its exact full content inside:',
    '[[STUDIO_FILE:exact_filename.ext]]',
    '...file content...',
    '[[/STUDIO_FILE]]',
    'Note: For .xlsx files, put valid JSON array of row objects or CSV inside [[STUDIO_FILE:name.xlsx]]. For .docx or .pdf files, put clean structured text/markdown inside [[STUDIO_FILE:name.docx]] or [[STUDIO_FILE:name.pdf]].',
    '2. MULTI-FILE ZIP PROJECTS: Whenever the user asks for a complete project or multiple files as a ZIP archive, output:',
    '[[STUDIO_PROJECT:project-name.zip]]',
    '### FILE: path/to/file.ext',
    '```lang',
    '...code...',
    '```',
    '[[/STUDIO_PROJECT]]',
  ];

  if (imgModel) {
    lines.push(
      `3. IMAGE STUDIO (Connected model: ${imgModel.displayName}): When the user asks to generate/draw/create an image, include on its own line: [[STUDIO_IMAGE:detailed visual prompt in English]]`
    );
  }
  if (vidModel) {
    lines.push(
      `4. VIDEO STUDIO (Connected model: ${vidModel.displayName}): When the user asks to generate a video, include on its own line: [[STUDIO_VIDEO:detailed video scene and motion prompt in English]]`
    );
  }
  if (ttsModel) {
    lines.push(
      `5. VOICE / TTS STUDIO (Connected model: ${ttsModel.displayName}): When the user asks to convert text to speech / voice audio, include: [[STUDIO_TTS:exact text to synthesize]]`
    );
  }
  if (musicModel) {
    lines.push(
      `6. MUSIC STUDIO (Connected model: ${musicModel.displayName}): When the user asks to generate music, beat, or sound effect, include: [[STUDIO_MUSIC:musical style, tempo, and mood prompt in English]]`
    );
  }

  lines.push(
    'If the user asks for image/video/audio/music generation and NO compatible model is listed above, inform them clearly to connect or enable a compatible model in Settings / Models rather than pretending.'
  );

  return lines.join('\n');
}

export async function runDirectStudioAction(params: {
  mode: 'image' | 'video' | 'tts' | 'music';
  prompt: string;
  settings: StudioSettings;
  fallbackModelKey?: string;
  userAttachments?: AttachmentRef[];
  onProgress?: (statusText: string) => void;
}): Promise<{ summaryText: string; attachments: AttachmentRef[]; modelUsed: string }> {
  const modality = params.mode;
  const targetModel = resolveStudioModel(modality, params.settings, params.fallbackModelKey);
  if (!targetModel) {
    throw new Error(`No enabled model found for ${modality} studio. Enable one in Models or Studio Models.`);
  }
  const provider = getProviderWithKey(targetModel.providerId);
  if (!provider || !provider.isActive) {
    throw new Error('Provider for the selected studio model is inactive.');
  }
  const adapter = getAdapter(provider.adapterType);
  const start = Date.now();

  if (modality === 'image') {
    if (!adapter.generateImage) throw new Error('Provider adapter does not support image generation.');
    const refImg = params.userAttachments?.find((a) => a.kind === 'image');
    let refBase64: string | undefined;
    let refMime: string | undefined;
    if (refImg) {
      const rec = getLibraryFile(refImg.fileId);
      if (rec && fs.existsSync(rec.storagePath)) {
        refBase64 = fs.readFileSync(rec.storagePath).toString('base64');
        refMime = rec.mimeType;
      }
    }
    params.onProgress?.(`Generating image via ${targetModel.displayName}...`);
    const assets = await adapter.generateImage({
      provider,
      modelId: targetModel.modelId,
      prompt: params.prompt,
      n: 1,
      size: '1024x1024',
      mode: refBase64 ? 'img2img' : 'txt2img',
      referenceImageBase64: refBase64,
      referenceImageMime: refMime,
    });
    const atts: AttachmentRef[] = assets.map((a) => {
      const saved = saveBufferToLibrary({
        buffer: a.buffer,
        folder: 'images',
        name: a.filename,
        originalName: a.filename,
        mimeType: a.mimeType,
        metadata: { prompt: params.prompt, modelKey: targetModel.id, generatedInChat: true },
      });
      return {
        fileId: saved.id,
        name: saved.name,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
        previewUrl: saved.url,
        kind: 'image',
      };
    });
    logApiCall({
      providerId: provider.id,
      providerName: provider.name,
      modelId: targetModel.modelId,
      endpoint: 'chatStudio:image',
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
    return {
      summaryText: `Generated image using **${targetModel.displayName}**.`,
      attachments: atts,
      modelUsed: targetModel.id,
    };
  }

  if (modality === 'video') {
    if (!adapter.generateVideo) throw new Error('Provider adapter does not support video generation.');
    const refMedia = params.userAttachments?.find((a) => a.kind === 'image' || a.kind === 'video');
    let refBase64: string | undefined;
    let refMime: string | undefined;
    if (refMedia) {
      const rec = getLibraryFile(refMedia.fileId);
      if (rec && fs.existsSync(rec.storagePath)) {
        refBase64 = fs.readFileSync(rec.storagePath).toString('base64');
        refMime = rec.mimeType;
      }
    }
    params.onProgress?.(`Submitting video job to ${targetModel.displayName}...`);
    let result = await adapter.generateVideo({
      provider,
      modelId: targetModel.modelId,
      prompt: params.prompt,
      mode: refBase64 ? (refMedia?.kind === 'video' ? 'vid2vid' : 'img2vid') : 'txt2vid',
      durationSec: 5,
      aspectRatio: '16:9',
      referenceBase64: refBase64,
      referenceMime: refMime,
    });

    let attempts = 0;
    while (result.status === 'processing' && result.remoteJobId && adapter.pollVideo && attempts < 36) {
      attempts++;
      params.onProgress?.(`Rendering video (${attempts * 4}s)...`);
      await new Promise((r) => setTimeout(r, 4000));
      result = await adapter.pollVideo(provider, result.remoteJobId, targetModel.modelId);
    }

    if (result.status !== 'completed' || !result.assets?.length) {
      throw new Error(
        result.remoteJobId
          ? `Video job ${result.remoteJobId} is still processing on provider. Check Video Studio history shortly.`
          : 'Video generation did not return video output.'
      );
    }

    const atts: AttachmentRef[] = result.assets.map((a) => {
      const saved = saveBufferToLibrary({
        buffer: a.buffer,
        folder: 'videos',
        name: a.filename,
        originalName: a.filename,
        mimeType: a.mimeType,
        metadata: { prompt: params.prompt, modelKey: targetModel.id, generatedInChat: true },
      });
      return {
        fileId: saved.id,
        name: saved.name,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
        previewUrl: saved.url,
        kind: 'video',
      };
    });
    logApiCall({
      providerId: provider.id,
      providerName: provider.name,
      modelId: targetModel.modelId,
      endpoint: 'chatStudio:video',
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
    return {
      summaryText: `Generated video using **${targetModel.displayName}**.`,
      attachments: atts,
      modelUsed: targetModel.id,
    };
  }

  if (modality === 'tts') {
    if (!adapter.textToSpeech) throw new Error('Provider adapter does not support Text-to-Speech.');
    params.onProgress?.(`Synthesizing speech via ${targetModel.displayName}...`);
    const asset = await adapter.textToSpeech({
      provider,
      modelId: targetModel.modelId,
      text: params.prompt,
      voice: 'alloy',
      format: 'mp3',
    });
    const saved = saveBufferToLibrary({
      buffer: asset.buffer,
      folder: 'audio',
      name: asset.filename,
      originalName: asset.filename,
      mimeType: asset.mimeType,
      metadata: { text: params.prompt.slice(0, 200), modelKey: targetModel.id, generatedInChat: true },
    });
    logApiCall({
      providerId: provider.id,
      providerName: provider.name,
      modelId: targetModel.modelId,
      endpoint: 'chatStudio:tts',
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
    return {
      summaryText: `Generated speech audio using **${targetModel.displayName}**.`,
      attachments: [
        {
          fileId: saved.id,
          name: saved.name,
          mimeType: saved.mimeType,
          sizeBytes: saved.sizeBytes,
          previewUrl: saved.url,
          kind: classifyAttachmentKind(saved.mimeType, '.mp3'),
        },
      ],
      modelUsed: targetModel.id,
    };
  }

  // music
  if (!adapter.generateMusic) throw new Error('Provider adapter does not support music generation.');
  params.onProgress?.(`Generating music via ${targetModel.displayName}...`);
  const assets = await adapter.generateMusic({
    provider,
    modelId: targetModel.modelId,
    prompt: params.prompt,
    durationSec: 30,
    mode: 'music',
  });
  const atts: AttachmentRef[] = assets.map((a) => {
    const saved = saveBufferToLibrary({
      buffer: a.buffer,
      folder: 'music',
      name: a.filename,
      originalName: a.filename,
      mimeType: a.mimeType,
      metadata: { prompt: params.prompt, modelKey: targetModel.id, generatedInChat: true },
    });
    return {
      fileId: saved.id,
      name: saved.name,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      previewUrl: saved.url,
      kind: 'audio',
    };
  });
  return {
    summaryText: `Generated audio/music using **${targetModel.displayName}**.`,
    attachments: atts,
    modelUsed: targetModel.id,
  };
}

export async function processUnifiedChatDirectives(params: {
  rawText: string;
  settings: StudioSettings;
  fallbackModelKey?: string;
  userAttachments?: AttachmentRef[];
  onProgress?: (statusText: string) => void;
}): Promise<{ cleanedText: string; attachments: AttachmentRef[] }> {
  let text = params.rawText;
  const attachments: AttachmentRef[] = [];

  // 1. [[STUDIO_FILE:filename.ext]] ... [[/STUDIO_FILE]]
  const fileMatches = [...text.matchAll(/\[\[STUDIO_FILE:([^\]]+)\]\]\s*\n?([\s\S]*?)\[\[\/STUDIO_FILE\]\]/g)];
  for (const m of fileMatches) {
    const filename = m[1].trim();
    let body = m[2].trim();
    // Strip outer markdown fence if model wrapped the inner file in ```lang ... ```
    const fenceMatch = body.match(/^```[\w+-]*\n([\s\S]*?)```$/);
    if (fenceMatch) body = fenceMatch[1];

    try {
      const att = await materializeStudioFile(filename, body);
      attachments.push(att);
      text = text.replace(m[0], `**${att.name}** (${Math.max(1, Math.round(att.sizeBytes / 1024))} KB)`);
    } catch (err) {
      text = text.replace(m[0], `File generation error (${filename}): ${sanitizeErrorMessage(err)}`);
    }
  }

  // 2. [[STUDIO_PROJECT:archive.zip]] ... [[/STUDIO_PROJECT]]
  const projMatches = [...text.matchAll(/\[\[STUDIO_PROJECT:([^\]]+)\]\]\s*\n?([\s\S]*?)\[\[\/STUDIO_PROJECT\]\]/g)];
  for (const m of projMatches) {
    const zipName = m[1].trim();
    const body = m[2].trim();
    try {
      const att = materializeStudioProjectZip(zipName, body);
      attachments.push(att);
      text = text.replace(m[0], `**${att.name}**`);
    } catch (err) {
      text = text.replace(m[0], `Project ZIP error (${zipName}): ${sanitizeErrorMessage(err)}`);
    }
  }

  // 3. Media studio directives: [[STUDIO_IMAGE:...]], [[STUDIO_VIDEO:...]], [[STUDIO_TTS:...]], [[STUDIO_MUSIC:...]]
  const mediaTags: Array<{
    regex: RegExp;
    mode: 'image' | 'video' | 'tts' | 'music';
  }> = [
    { regex: /\[\[STUDIO_IMAGE:([^\]]+)\]\]/g, mode: 'image' },
    { regex: /\[\[STUDIO_VIDEO:([^\]]+)\]\]/g, mode: 'video' },
    { regex: /\[\[STUDIO_TTS:([^\]]+)\]\]/g, mode: 'tts' },
    { regex: /\[\[STUDIO_MUSIC:([^\]]+)\]\]/g, mode: 'music' },
  ];

  for (const spec of mediaTags) {
    const matches = [...text.matchAll(spec.regex)];
    for (const m of matches) {
      const prompt = m[1].trim();
      try {
        const res = await runDirectStudioAction({
          mode: spec.mode,
          prompt,
          settings: params.settings,
          fallbackModelKey: params.fallbackModelKey,
          userAttachments: params.userAttachments,
          onProgress: params.onProgress,
        });
        attachments.push(...res.attachments);
        text = text.replace(m[0], '');
      } catch (err) {
        text = text.replace(m[0], `\n> ${sanitizeErrorMessage(err)}\n`);
      }
    }
  }

  return { cleanedText: text.trim(), attachments };
}
