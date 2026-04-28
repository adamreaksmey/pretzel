import { Module } from '@nestjs/common';
import { AppController } from '../app.controller';
import { PresenceService } from '../app.service';

@Module({
  controllers: [AppController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
