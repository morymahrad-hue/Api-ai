import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const KEY_FILE = path.join(DATA_DIR, '.master.key');

function getMasterKey(): Buffer {
  if (process.env.ENCRYPTION_SECRET && process.env.ENCRYPTION_SECRET.length >= 16) {
    return crypto.createHash('sha256').update(process.env.ENCRYPTION_SECRET).digest();
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(KEY_FILE)) {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (hex.length === 64) {
      return Buffer.from(hex, 'hex');
    }
  }
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, generated.toString('hex'), { mode: 0o600 });
  return generated;
}

export function encryptSecret(plainText: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  if (!payload) return '';
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format');
  }
  const [ivHex, tagHex, dataHex] = parts;
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function maskApiKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (!trimmed) return '••••••••';
  if (trimmed.length <= 8) return '••••' + trimmed.slice(-2);
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export function sanitizeErrorMessage(err: unknown, secretsToRedact: string[] = []): string {
  let msg = err instanceof Error ? err.message : String(err || 'Unknown error');
  for (const secret of secretsToRedact) {
    if (secret && secret.length >= 6) {
      msg = msg.split(secret).join('[REDACTED_KEY]');
    }
  }
  // Redact common Bearer / sk- token patterns
  msg = msg.replace(/Bearer\s+[A-Za-z0-9._\-]{10,}/gi, 'Bearer [REDACTED]');
  msg = msg.replace(/\bsk-[A-Za-z0-9_\-]{10,}\b/g, 'sk-[REDACTED]');
  return msg;
}

export function validateExternalUrl(rawUrl: string, allowLocalhost = true): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid URL format. Must start with http:// or https://');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Unsupported URL protocol. Only http and https are allowed.');
  }
  const host = parsed.hostname.toLowerCase();
  // Block cloud metadata endpoints & link-local addresses
  if (
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    host.startsWith('169.254.') ||
    host === '0.0.0.0'
  ) {
    throw new Error('Access to internal metadata addresses is blocked.');
  }
  if (!allowLocalhost && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) {
    throw new Error('Localhost addresses are not permitted for this operation.');
  }
  return parsed;
}
