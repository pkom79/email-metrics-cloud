import crypto from 'crypto';

// AES-256-GCM helpers for encrypting per-account secrets
// Key is derived from INTEGRATIONS_ENC_KEY via SHA-256

function getKey() {
  const raw = process.env.INTEGRATIONS_ENC_KEY || '';
  if (!raw) throw new Error('INTEGRATIONS_ENC_KEY not set');
  return crypto.createHash('sha256').update(raw).digest(); // 32 bytes
}

export function encryptSecret(plain: string) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = {
    v: 1,
    iv: iv.toString('base64'),
    ct: ciphertext.toString('base64'),
    tag: tag.toString('base64')
  };
  return JSON.stringify(blob);
}

export function decryptSecret(blob: string): string {
  const key = getKey();
  let parsed: any;
  try { parsed = JSON.parse(blob); } catch { throw new Error('Invalid secret blob'); }
  const iv = Buffer.from(String(parsed.iv || ''), 'base64');
  const ct = Buffer.from(String(parsed.ct || ''), 'base64');
  const tag = Buffer.from(String(parsed.tag || ''), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString('utf8');
}

