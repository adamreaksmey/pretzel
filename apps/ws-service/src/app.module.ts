import { Module } from '@nestjs/common';
import { ApiKeyValidationService } from './api-key-validation.service';
import { PresenceGateway } from './presence.gateway';
import { PresenceService } from './presence.service';

@Module({
  imports: [],
  controllers: [],
  providers: [ApiKeyValidationService, PresenceGateway, PresenceService],
})
export class AppModule {}
