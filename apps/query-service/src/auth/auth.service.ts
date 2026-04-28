import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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

    const apiKeyEntity = await this.apiKeyRepository.save(
      this.apiKeyRepository.create({ tenantId, key: 'pending' }),
    );
    const apiKeySecret = createApiKeySecret();
    apiKeyEntity.key = await hashApiKeySecret(apiKeySecret);
    await this.apiKeyRepository.save(apiKeyEntity);
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
}
