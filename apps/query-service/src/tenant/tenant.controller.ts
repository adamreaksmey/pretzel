import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Body,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { TenantService } from './tenant.service';

class CreateTenantBodyDto {
  @ApiProperty({ description: 'Human-readable tenant name.' })
  name!: string;
}

class TenantResponseDto {
  @ApiProperty({ description: 'Tenant id.' })
  id!: string;

  @ApiProperty({ description: 'Tenant display name.' })
  name!: string;

  @ApiProperty({ description: 'Creation timestamp (ISO-8601).' })
  createdAt!: Date;
}

@ApiTags('tenants')
@Controller('tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @ApiOperation({ summary: 'Create a tenant' })
  @ApiBody({ type: CreateTenantBodyDto })
  @ApiCreatedResponse({ type: TenantResponseDto })
  @Post()
  createTenant(@Body() body: CreateTenantBodyDto) {
    const tenantName = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!tenantName) {
      throw new BadRequestException('name must be a non-empty string.');
    }

    return this.tenantService.createTenant(tenantName);
  }

  @ApiOperation({ summary: 'Get a tenant by id' })
  @ApiParam({ name: 'id', description: 'Tenant id' })
  @ApiOkResponse({ type: TenantResponseDto })
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
