import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

class IssueApiKeyBodyDto {
  tenantId!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('keys')
  issueApiKey(@Body() body: IssueApiKeyBodyDto) {
    const tenantId =
      typeof body?.tenantId === 'string' ? body.tenantId.trim() : '';
    if (!tenantId) {
      throw new BadRequestException('tenantId must be a non-empty string.');
    }

    return this.authService.issueApiKey(tenantId);
  }
}
