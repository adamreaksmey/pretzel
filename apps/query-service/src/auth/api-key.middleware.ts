import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './authenticated-request';

const API_KEY_HEADER = 'x-api-key';

@Injectable()
export class ApiKeyMiddleware implements NestMiddleware {
  constructor(private readonly authService: AuthService) {}

  async use(
    request: AuthenticatedRequest,
    _response: Response,
    next: NextFunction,
  ): Promise<void> {
    const apiKeyHeaderValue = request.headers[API_KEY_HEADER];
    const apiKey =
      typeof apiKeyHeaderValue === 'string' ? apiKeyHeaderValue.trim() : '';
    if (!apiKey) {
      throw new UnauthorizedException('x-api-key header is required.');
    }

    const tenantId = await this.authService.resolveTenantIdFromApiKey(apiKey);
    if (!tenantId) {
      throw new UnauthorizedException('Invalid API key.');
    }

    request.tenantId = tenantId;
    next();
  }
}
