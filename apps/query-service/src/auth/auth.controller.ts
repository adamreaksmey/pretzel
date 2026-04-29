import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';

class IssueApiKeyBodyDto {
  @ApiProperty({ description: 'Tenant id that will own the API key.' })
  tenantId!: string;
}

class IssueApiKeyResponseDto {
  @ApiProperty({ description: 'Presented API key returned once.' })
  apiKey!: string;

  @ApiProperty({ description: 'Tenant id linked to the key.' })
  tenantId!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Issue a new API key for a tenant' })
  @ApiBody({ type: IssueApiKeyBodyDto })
  @ApiCreatedResponse({ type: IssueApiKeyResponseDto })
  @Post('keys')
  issueApiKey(@Body() body: IssueApiKeyBodyDto) {
    const tenantId =
      typeof body?.tenantId === 'string' ? body.tenantId.trim() : '';
    if (!tenantId) {
      throw new BadRequestException('tenantId must be a non-empty string.');
    }

    return this.authService.issueApiKey(tenantId);
  }

  @ApiOperation({ summary: 'Revoke API key for a tenant' })
  @ApiParam({ name: 'tenantId', description: 'Tenant id owning the API key.' })
  @ApiNoContentResponse({ description: 'API key revoked and sockets drained.' })
  @Delete('keys/:tenantId')
  async revokeApiKey(@Param('tenantId') tenantIdParam: string): Promise<void> {
    const tenantId =
      typeof tenantIdParam === 'string' ? tenantIdParam.trim() : '';
    if (!tenantId) {
      throw new BadRequestException('tenantId must be a non-empty string.');
    }

    await this.authService.revokeApiKey(tenantId);
  }
}
