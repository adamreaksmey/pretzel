import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Body,
} from '@nestjs/common';
import { TenantService } from './tenant.service';

class CreateTenantBodyDto {
  name!: string;
}

@Controller('tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post()
  createTenant(@Body() body: CreateTenantBodyDto) {
    const tenantName = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!tenantName) {
      throw new BadRequestException('name must be a non-empty string.');
    }

    return this.tenantService.createTenant(tenantName);
  }

  @Get(':id')
  getTenant(@Param('id') tenantId: string) {
    const normalizedTenantId =
      typeof tenantId === 'string' ? tenantId.trim() : '';
    if (!normalizedTenantId) {
      throw new BadRequestException('id must be provided.');
    }

    return this.tenantService.getTenant(normalizedTenantId);
  }
}
