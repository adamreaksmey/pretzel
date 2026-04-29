import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { redisClient } from '@pretzel/redis';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  createApiKeySecret,
  createPresentedApiKey,
  hashApiKeySecret,
  validatePresentedApiKey,
} from '@pretzel/auth';
import { Repository } from 'typeorm';
import { TenantEntity } from '../tenant/tenant.entity';
import { ApiKeyEntity } from './api-key.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(getRepositoryToken(ApiKeyEntity))
    private readonly apiKeyRepository: Repository<ApiKeyEntity>,
    @Inject(getRepositoryToken(TenantEntity))
    private readonly tenantRepository: Repository<TenantEntity>,
  ) {}

  async issueApiKey(
    tenantId: string,
  ): Promise<{ apiKey: string; tenantId: string }> {
    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found.');
    }

    const apiKeySecret = createApiKeySecret();
    const hashed = await hashApiKeySecret(apiKeySecret);

    await this.apiKeyRepository.upsert(
      {
        tenantId,
        key: hashed,
      },
      ['tenantId'], // conflict target
    );

    const apiKeyEntity = await this.apiKeyRepository.findOneOrFail({
      where: { tenantId },
    });

    return {
      apiKey: createPresentedApiKey(apiKeyEntity.id, apiKeySecret),
      tenantId,
    };
  }

  async resolveTenantIdFromApiKey(apiKey: string): Promise<string | null> {
    const validatedApiKey = await validatePresentedApiKey(
      apiKey,
      async (keyId) => {
        const storedApiKey = await this.apiKeyRepository.findOne({
          where: { id: keyId },
        });
        if (!storedApiKey) {
          return null;
        }
        return {
          tenantId: storedApiKey.tenantId,
          keyHash: storedApiKey.key,
        };
      },
    );
    return validatedApiKey?.tenantId ?? null;
  }

  async revokeApiKey(tenantId: string): Promise<{ tenantId: string }> {
    const deleteResult = await this.apiKeyRepository.delete({ tenantId });
    if (!deleteResult.affected) {
      throw new NotFoundException('API key not found for tenant.');
    }

    await this.withRedisTimeout('publish auth revocation', () =>
      redisClient.publish(
        'auth.revoked',
        JSON.stringify({
          tenantId,
          revokedAt: new Date().toISOString(),
        }),
      ),
    );
    return { tenantId };
  }

  private async withRedisTimeout<T>(
    operationName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const redisTimeoutMs = 3000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Redis operation timed out: ${operationName}`));
      }, redisTimeoutMs);
    });

    try {
      return await Promise.race([operation(), timeoutPromise]);
    } catch (error) {
      this.logger.error(
        `Redis operation failed: ${operationName}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new Error(`Redis operation failed: ${operationName}`);
    }
  }
}
