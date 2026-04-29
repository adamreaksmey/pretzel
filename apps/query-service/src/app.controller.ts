import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { UserPresence } from '@pretzel/types';
import type { AuthenticatedRequest } from './auth/authenticated-request';
import { PresenceService } from './app.service';

class PresenceBatchBodyDto {
  @ApiProperty({
    type: [String],
    example: ['user-123', 'user-456'],
    description: 'List of user IDs to query presence for.',
  })
  userIds!: string[];
}

class UserPresenceDto {
  @ApiProperty({ example: 'user-123' })
  userId!: string;

  @ApiProperty({ enum: ['online', 'offline'], example: 'online' })
  status!: 'online' | 'offline';

  @ApiProperty({
    nullable: true,
    example: '2026-04-29T03:40:00.000Z',
    description: 'ISO timestamp when the user was last seen, null if online.',
  })
  last_seen!: string | null;
}

@ApiTags('presence')
@Controller()
export class AppController {
  constructor(private readonly appService: PresenceService) {}

  @ApiOperation({ summary: 'Get presence for a single user' })
  @ApiParam({ name: 'userId', description: 'Target user id' })
  @ApiHeader({ name: 'x-api-key', required: true })
  @ApiOkResponse({ type: UserPresenceDto })
  @Get('presence/:userId')
  getPresence(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ): Promise<UserPresence> {
    const tenantId = this.readTenantId(request);
    const normalizedUserId = this.normalizeRequiredValue(userId, 'userId');
    return this.appService.getPresence(tenantId, normalizedUserId);
  }

  @ApiOperation({ summary: 'Get presence for multiple users' })
  @ApiHeader({ name: 'x-api-key', required: true })
  @ApiBody({ type: PresenceBatchBodyDto })
  @ApiOkResponse({ type: UserPresenceDto, isArray: true })
  @Post('presence/batch')
  async getPresenceBatch(
    @Req() request: AuthenticatedRequest,
    @Body() requestBody: PresenceBatchBodyDto,
  ): Promise<UserPresence[]> {
    const tenantId = this.readTenantId(request);
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

  private readTenantId(request: AuthenticatedRequest): string {
    const tenantId = this.readOptionalText(request.tenantId);
    if (tenantId) {
      return tenantId;
    }

    throw new BadRequestException('Tenant resolution failed for request.');
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
