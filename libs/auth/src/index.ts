import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

const API_KEY_SEPARATOR = '.';
const API_KEY_SECRET_BYTES = 24;
const API_KEY_SALT_ROUNDS = 10;

export interface StoredApiKeyRecord {
  tenantId: string;
  keyHash: string;
}

export interface ApiKeyValidationResult {
  keyId: string;
  tenantId: string;
}

export type ApiKeyLookup = (keyId: string) => Promise<StoredApiKeyRecord | null>;

export function createApiKeySecret(): string {
  return randomBytes(API_KEY_SECRET_BYTES).toString('hex');
}

export function createPresentedApiKey(keyId: string, secret: string): string {
  return `${keyId}${API_KEY_SEPARATOR}${secret}`;
}

export function parsePresentedApiKey(
  presentedApiKey: string,
): { keyId: string; secret: string } | null {
  const normalizedApiKey = presentedApiKey.trim();
  const separatorIndex = normalizedApiKey.indexOf(API_KEY_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex >= normalizedApiKey.length - 1) {
    return null;
  }

  const keyId = normalizedApiKey.slice(0, separatorIndex).trim();
  const secret = normalizedApiKey.slice(separatorIndex + 1).trim();
  if (!keyId || !secret) {
    return null;
  }

  return { keyId, secret };
}

export async function hashApiKeySecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, API_KEY_SALT_ROUNDS);
}

export async function verifyApiKeySecret(
  secret: string,
  keyHash: string,
): Promise<boolean> {
  return bcrypt.compare(secret, keyHash);
}

export async function validatePresentedApiKey(
  presentedApiKey: string,
  lookupApiKey: ApiKeyLookup,
): Promise<ApiKeyValidationResult | null> {
  const parsedApiKey = parsePresentedApiKey(presentedApiKey);
  if (!parsedApiKey) {
    return null;
  }

  const storedApiKey = await lookupApiKey(parsedApiKey.keyId);
  if (!storedApiKey) {
    return null;
  }

  const isMatch = await verifyApiKeySecret(parsedApiKey.secret, storedApiKey.keyHash);
  if (!isMatch) {
    return null;
  }

  return {
    keyId: parsedApiKey.keyId,
    tenantId: storedApiKey.tenantId,
  };
}
