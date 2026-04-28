import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from './tenant.entity';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity])],
  providers: [TenantService],
  controllers: [TenantController],
  exports: [TenantService, TypeOrmModule],
})
export class TenantModule {}
