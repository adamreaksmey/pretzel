import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { UserPresence } from '@pretzel/types';
import { AppService } from './app.service';

const TENANT_ID_HEADER = 'x-tenant-id';
const API_KEY_HEADER = 'x-api-key';
const TENANT_API_KEY_PREFIX = 'tenant:';

class PresenceBatchBodyDto {
  userIds!: string[];
}

class UserPresenceDto {
  userId!: string;
  status!: 'online' | 'offline';
  last_seen!: string | null;
}

@ApiTags('presence')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: 'Get presence for a single user' })
  @ApiParam({ name: 'userId', description: 'Target user id' })
  @ApiHeader({
    name: TENANT_ID_HEADER,
    required: false,
    description: 'Tenant scope header',
  })
  @ApiHeader({
    name: API_KEY_HEADER,
    required: false,
    description: 'Tenant API key in format tenant:<tenantId>',
  })
  @ApiOkResponse({ type: UserPresenceDto })
  @Get('presence/:userId')
  getPresence(
    @Headers(TENANT_ID_HEADER) tenantHeader: string | undefined,
    @Headers(API_KEY_HEADER) apiKeyHeader: string | undefined,
    @Param('userId') userId: string,
  ): Promise<UserPresence> {
    const tenantId = this.resolveTenantId(tenantHeader, apiKeyHeader);
    const normalizedUserId = this.normalizeRequiredValue(userId, 'userId');
    return this.appService.getPresence(tenantId, normalizedUserId);
  }

  @ApiOperation({ summary: 'Get presence for multiple users' })
  @ApiHeader({
    name: TENANT_ID_HEADER,
    required: false,
    description: 'Tenant scope header',
  })
  @ApiHeader({
    name: API_KEY_HEADER,
    required: false,
    description: 'Tenant API key in format tenant:<tenantId>',
  })
  @ApiBody({ type: PresenceBatchBodyDto })
  @ApiOkResponse({ type: UserPresenceDto, isArray: true })
  @Post('presence/batch')
  async getPresenceBatch(
    @Headers(TENANT_ID_HEADER) tenantHeader: string | undefined,
    @Headers(API_KEY_HEADER) apiKeyHeader: string | undefined,
    @Body() requestBody: PresenceBatchBodyDto,
  ): Promise<UserPresence[]> {
    const tenantId = this.resolveTenantId(tenantHeader, apiKeyHeader);
    const userIds = this.normalizeUserIds(requestBody);
    const presenceBatch: unknown = await this.appService.getPresenceBatch(
      tenantId,
      userIds,
    );
    if (!this.isUserPresenceArray(presenceBatch)) {
      throw new BadRequestException('Presence batch response is invalid.');
    }
    return presenceBatch;
  }

  private resolveTenantId(
    tenantHeader: string | undefined,
    apiKeyHeader: string | undefined,
  ): string {
    const tenantId = this.readOptionalText(tenantHeader);
    if (tenantId) {
      return tenantId;
    }

    const apiKey = this.readOptionalText(apiKeyHeader);
    if (apiKey?.startsWith(TENANT_API_KEY_PREFIX)) {
      const resolvedTenantId = apiKey
        .slice(TENANT_API_KEY_PREFIX.length)
        .trim();
      if (resolvedTenantId) {
        return resolvedTenantId;
      }
    }

    throw new BadRequestException(
      'A tenant identifier is required via x-tenant-id or x-api-key.',
    );
  }

  private normalizeUserIds(requestBody: PresenceBatchBodyDto): string[] {
    if (!requestBody || !Array.isArray(requestBody.userIds)) {
      throw new BadRequestException('Request body must include userIds array.');
    }

    if (requestBody.userIds.length === 0) {
      throw new BadRequestException(
        'userIds must include at least one user id.',
      );
    }

    return requestBody.userIds.map((userId) =>
      this.normalizeRequiredValue(userId, 'userIds'),
    );
  }

  private normalizeRequiredValue(value: unknown, fieldName: string): string {
    const normalizedValue = this.readOptionalText(value);
    if (normalizedValue) {
      return normalizedValue;
    }

    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }

  private readOptionalText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalizedValue = value.trim();
    return normalizedValue || null;
  }

  private isUserPresenceArray(value: unknown): value is UserPresence[] {
    if (!Array.isArray(value)) {
      return false;
    }
    return value.every((entry) => this.isUserPresence(entry));
  }

  private isUserPresence(value: unknown): value is UserPresence {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    const hasValidUserId = typeof candidate.userId === 'string';
    const hasValidStatus =
      candidate.status === 'online' || candidate.status === 'offline';
    const hasValidLastSeen =
      typeof candidate.last_seen === 'string' || candidate.last_seen === null;
    return hasValidUserId && hasValidStatus && hasValidLastSeen;
  }
}
