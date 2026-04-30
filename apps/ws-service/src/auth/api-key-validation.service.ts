import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { validatePresentedApiKey } from '@pretzel/auth';
import { Pool } from 'pg';

function getRequiredDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return databaseUrl;
  }

  throw new Error('DATABASE_URL environment variable is required.');
}

@Injectable()
export class ApiKeyValidationService implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: getRequiredDatabaseUrl(),
  });

  async validateApiKey(apiKey: string): Promise<string | null> {
    const validatedApiKey = await validatePresentedApiKey(
      apiKey,
      async (keyId) => {
        const queryResult = await this.pool.query<{
          tenant_id: string;
          key: string;
        }>('SELECT tenant_id, key FROM api_keys WHERE id = $1 LIMIT 1', [
          keyId,
        ]);
        if (queryResult.rowCount !== 1) {
          return null;
        }
        const row = queryResult.rows[0];
        return { tenantId: row.tenant_id, keyHash: row.key };
      },
    );
    return validatedApiKey?.tenantId ?? null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
