const TENANT_API_KEY_PREFIX = 'tenant:';

export function resolveTenantIdFromApiKey(apiKey: string): string | null {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey.startsWith(TENANT_API_KEY_PREFIX)) {
    return null;
  }

  const tenantId = normalizedApiKey.slice(TENANT_API_KEY_PREFIX.length).trim();
  return tenantId || null;
}
