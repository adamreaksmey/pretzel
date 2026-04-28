import { Module } from '@nestjs/common';
import { PresenceGateway } from './presence.gateway';
import { PresenceService } from './presence.service';

@Module({
  imports: [],
  controllers: [],
  providers: [PresenceGateway, PresenceService],
})
export class AppModule {}
