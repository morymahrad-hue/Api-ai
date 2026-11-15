import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import type { AttachmentRef, LibraryFolder } from '../src/types.ts';
import { classifyAttachmentKind, sanitizeFilename, saveBufferToLibrary } from './files.ts';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hasRtlChars(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

export function createDocxBuffer(content: string): Buffer {
  const zip = new AdmZip();

  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/contenttypes">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
      'utf8'
    )
  );

  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
      'utf8'
    )
  );

  zip.addFile(
    'word/_rels/document.xml.rels',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
      'utf8'
    )
  );

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const paragraphsXml = lines
    .map((rawLine) => {
      const trimmed = rawLine.trim();
      const isHeading = /^#{1,3}\s+/.test(trimmed);
      const cleanLine = trimmed.replace(/^#{1,6}\s+/, '').replace(/\*\*(.*?)\*\*/g, '$1');
      const rtl = hasRtlChars(cleanLine);
      const pPr = rtl ? '<w:pPr><w:bidi/></w:pPr>' : '';
      const rPr = isHeading
        ? `<w:rPr><w:b/><w:sz w:val="28"/>${rtl ? '<w:rtl/>' : ''}</w:rPr>`
        : rtl
          ? '<w:rPr><w:rtl/></w:rPr>'
          : '';
      return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(cleanLine)}</w:t></w:r></w:p>`;
    })
    .join('\n');

  zip.addFile(
    'word/document.xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphsXml}
    <w:sectPr/>
  </w:body>
</w:document>`,
      'utf8'
    )
  );

  return zip.toBuffer();
}

export function createXlsxBuffer(rawContent: string): Buffer {
  let rows: Array<Record<string, unknown>> = [];
  const trimmed = rawContent.trim();

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      rows = [];
    }
  }

  if (rows.length === 0 && trimmed.includes('|')) {
    // Parse Markdown table
    const tableLines = trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('|') && !/^\|[\s\-:|]+\|$/.test(l));
    if (tableLines.length >= 2) {
      const headers = tableLines[0]
        .split('|')
        .slice(1, -1)
        .map((h) => h.trim());
      rows = tableLines.slice(1).map((line) => {
        const cols = line
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          obj[h || `col_${i + 1}`] = cols[i] ?? '';
        });
        return obj;
      });
    }
  }

  const wb = XLSX.utils.book_new();
  let ws: XLSX.WorkSheet;
  if (rows.length > 0) {
    ws = XLSX.utils.json_to_sheet(rows);
  } else {
    const csvWb = XLSX.read(trimmed, { type: 'string' });
    ws = csvWb.Sheets[csvWb.SheetNames[0]] || XLSX.utils.aoa_to_sheet([[trimmed]]);
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export async function createPdfBuffer(content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    if (fs.existsSync(fontPath)) {
      doc.font(fontPath);
    }

    const lines = content.replace(/\r\n/g, '\n').split('\n');
    for (const line of lines) {
      const clean = line.replace(/^#{1,6}\s+/, '').replace(/\*\*(.*?)\*\*/g, '$1');
      if (!clean.trim()) {
        doc.moveDown(0.5);
        continue;
      }
      const isRtl = hasRtlChars(clean);
      doc.fontSize(/^#{1,3}\s+/.test(line.trim()) ? 14 : 11).text(clean, {
        align: isRtl ? 'right' : 'left',
      });
    }
    doc.end();
  });
}

function guessMimeForExtension(ext: string): string {
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.csv':
      return 'text/csv; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.xml':
      return 'application/xml; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.md':
      return 'text/markdown; charset=utf-8';
    case '.zip':
      return 'application/zip';
    default:
      return 'text/plain; charset=utf-8';
  }
}

export async function materializeStudioFile(
  rawFilename: string,
  rawBody: string
): Promise<AttachmentRef> {
  const safeName = sanitizeFilename(rawFilename || `output_${Date.now()}.txt`);
  const ext = path.extname(safeName).toLowerCase() || '.txt';
  let buffer: Buffer;
  let folder: LibraryFolder = 'documents';

  if (ext === '.docx' || ext === '.doc') {
    buffer = createDocxBuffer(rawBody);
  } else if (ext === '.xlsx' || ext === '.xls') {
    buffer = createXlsxBuffer(rawBody);
  } else if (ext === '.pdf') {
    buffer = await createPdfBuffer(rawBody);
  } else {
    buffer = Buffer.from(rawBody, 'utf8');
    if (['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.html', '.css', '.sql', '.sh'].includes(ext)) {
      folder = 'projects';
    }
  }

  const mimeType = guessMimeForExtension(ext);
  const saved = saveBufferToLibrary({
    buffer,
    folder,
    name: safeName,
    originalName: safeName,
    mimeType,
    metadata: { generatedInChat: true },
  });

  return {
    fileId: saved.id,
    name: saved.name,
    mimeType: saved.mimeType,
    sizeBytes: saved.sizeBytes,
    previewUrl: saved.url,
    kind: classifyAttachmentKind(saved.mimeType, ext),
  };
}

export function materializeStudioProjectZip(
  rawArchiveName: string,
  body: string
): AttachmentRef {
  const safeName = sanitizeFilename(
    rawArchiveName.endsWith('.zip') ? rawArchiveName : `${rawArchiveName}.zip`
  );
  const zip = new AdmZip();
  const fileRegex = /###?\s*FILE:\s*([^\n]+)\n+```[\w+-]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = fileRegex.exec(body)) !== null) {
    const cleanPath = match[1].trim().replace(/^\/+/, '').replace(/\.\.\//g, '');
    if (cleanPath) {
      zip.addFile(cleanPath, Buffer.from(match[2], 'utf8'));
      count++;
    }
  }
  if (count === 0) {
    zip.addFile('README.md', Buffer.from(body, 'utf8'));
  }
  const saved = saveBufferToLibrary({
    buffer: zip.toBuffer(),
    folder: 'projects',
    name: safeName,
    originalName: safeName,
    mimeType: 'application/zip',
    metadata: { generatedInChat: true, fileCount: count },
  });
  return {
    fileId: saved.id,
    name: saved.name,
    mimeType: saved.mimeType,
    sizeBytes: saved.sizeBytes,
    previewUrl: saved.url,
    kind: 'archive',
  };
}
