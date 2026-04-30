import { Module } from '@nestjs/common';
import { ApiKeyValidationService } from './auth/api-key-validation.service';
import { PresenceGateway } from './presence/presence.gateway';
import { PresenceService } from './presence/presence.service';

@Module({
  imports: [],
  controllers: [],
  providers: [ApiKeyValidationService, PresenceGateway, PresenceService],
})
export class AppModule {}
