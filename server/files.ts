import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import AdmZip from 'adm-zip';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import type { AttachmentRef, LibraryFileDTO, LibraryFolder } from '../src/types.ts';
import { db, getLibraryFile } from './db.ts';

const require = createRequire(import.meta.url);

const STORAGE_ROOT = path.resolve(process.cwd(), 'data', 'storage');
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb', '.swift', '.kt', '.sql',
  '.sh', '.bash', '.yaml', '.yml', '.toml', '.ini', '.env.example', '.css',
  '.scss', '.html', '.vue', '.svelte', '.md', '.txt', '.log', '.json', '.xml', '.csv',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.txt', '.json', '.xml', '.zip',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
  '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.webm',
  '.mp4', '.mov', '.avi', '.mkv',
  ...CODE_EXTENSIONS,
]);

export function ensureStorageDir(folder: LibraryFolder): string {
  const dir = path.join(STORAGE_ROOT, folder);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name || 'file').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_');
  return base.slice(0, 140) || 'file';
}

export function validateUploadFile(originalName: string, sizeBytes: number): void {
  if (sizeBytes <= 0) {
    throw new Error('Uploaded file is empty.');
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds maximum size limit of ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }
  const ext = path.extname(originalName).toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File extension "${ext || 'unknown'}" is not permitted.`);
  }
}

export function classifyAttachmentKind(mimeType: string, ext: string): AttachmentRef['kind'] {
  if (mimeType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
    return 'image';
  }
  if (mimeType.startsWith('audio/') || ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'].includes(ext)) {
    return 'audio';
  }
  if (mimeType.startsWith('video/') || ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) {
    return 'video';
  }
  if (ext === '.zip') return 'archive';
  if (['.pdf', '.doc', '.docx', '.xlsx', '.xls', '.csv'].includes(ext)) return 'document';
  return 'code';
}

export function saveBufferToLibrary(params: {
  buffer: Buffer;
  folder: LibraryFolder;
  name: string;
  originalName: string;
  mimeType: string;
  metadata?: Record<string, unknown>;
}): LibraryFileDTO {
  const id = crypto.randomUUID();
  const dir = ensureStorageDir(params.folder);
  const safeName = sanitizeFilename(params.name);
  const ext = path.extname(safeName) || guessExtFromMime(params.mimeType);
  const diskFilename = `${id}${ext}`;
  const fullPath = path.join(dir, diskFilename);
  fs.writeFileSync(fullPath, params.buffer);

  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO library_files
     (id, folder, name, original_name, mime_type, size_bytes, storage_path, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.folder,
    safeName,
    sanitizeFilename(params.originalName),
    params.mimeType,
    params.buffer.length,
    fullPath,
    JSON.stringify(params.metadata || {}),
    createdAt
  );

  const saved = getLibraryFile(id)!;
  const { storagePath: _sp, ...dto } = saved;
  return dto;
}

function guessExtFromMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes('png')) return '.png';
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('webp')) return '.webp';
  if (m.includes('mp4')) return '.mp4';
  if (m.includes('webm')) return '.webm';
  if (m.includes('mpeg') || m.includes('mp3')) return '.mp3';
  if (m.includes('wav')) return '.wav';
  if (m.includes('ogg')) return '.ogg';
  if (m.includes('pdf')) return '.pdf';
  if (m.includes('json')) return '.json';
  if (m.includes('csv')) return '.csv';
  if (m.includes('zip')) return '.zip';
  return '.bin';
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string | undefined> {
  const ext = path.extname(filename).toLowerCase();

  try {
    if (ext === '.pdf' || mimeType === 'application/pdf') {
      const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
        buf: Buffer
      ) => Promise<{ text: string; numpages: number }>;
      const parsed = await pdfParse(buffer);
      const text = (parsed.text || '').trim();
      return text
        ? `[PDF Extracted · ${parsed.numpages} pages]\n${text.slice(0, 60000)}`
        : '[PDF contains no selectable text; use a vision/OCR model for scanned pages.]';
    }

    if (ext === '.docx' || ext === '.doc') {
      const res = await mammoth.extractRawText({ buffer });
      const text = (res.value || '').trim();
      return text ? text.slice(0, 60000) : '[Empty Word document]';
    }

    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sections: string[] = [];
      for (const sheetName of wb.SheetNames.slice(0, 8)) {
        const ws = wb.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(ws);
        sections.push(`### Sheet: ${sheetName}\n${csv.slice(0, 20000)}`);
      }
      return sections.join('\n\n').slice(0, 60000);
    }

    if (ext === '.zip') {
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();
      const lines: string[] = [`[ZIP Archive · ${entries.length} entries]`];
      let extractedBytes = 0;
      const MAX_UNZIPPED = 5 * 1024 * 1024;
      for (const entry of entries.slice(0, 50)) {
        if (entry.isDirectory) {
          lines.push(`DIR  ${entry.entryName}`);
          continue;
        }
        const entryExt = path.extname(entry.entryName).toLowerCase();
        lines.push(`FILE ${entry.entryName} (${entry.header.size} bytes)`);
        if (
          CODE_EXTENSIONS.has(entryExt) &&
          entry.header.size < 200_000 &&
          extractedBytes + entry.header.size <= MAX_UNZIPPED
        ) {
          extractedBytes += entry.header.size;
          const content = entry.getData().toString('utf8').slice(0, 6000);
          lines.push(`--- ${entry.entryName} ---\n${content}`);
        }
      }
      return lines.join('\n').slice(0, 60000);
    }

    if (CODE_EXTENSIONS.has(ext) || mimeType.startsWith('text/')) {
      return buffer.toString('utf8').slice(0, 60000);
    }
  } catch (err) {
    return `[Extraction note: ${err instanceof Error ? err.message : 'Unable to extract text'}]`;
  }
  return undefined;
}
