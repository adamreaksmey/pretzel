import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantEntity } from './tenant.entity';

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
  ) {}

  async createTenant(name: string): Promise<TenantEntity> {
    const tenant = this.tenantRepository.create({ name });
    return this.tenantRepository.save(tenant);
  }

  async getTenant(tenantId: string): Promise<TenantEntity> {
    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId },
    });
    if (tenant) {
      return tenant;
    }

    throw new NotFoundException('Tenant not found.');
  }
}
