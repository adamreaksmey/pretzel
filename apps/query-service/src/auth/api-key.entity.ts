import {
  CreateDateColumn,
  Index,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';
import { TenantEntity } from '../tenant/tenant.entity';
@Entity({ name: 'api_keys' })
@Index('UQ_api_keys_tenant_id', ['tenantId'], { unique: true })
@Index('IDX_api_key', ['key'])
export class ApiKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, (tenant) => tenant.apiKeys, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: TenantEntity;

  @Column({ name: 'key', type: 'varchar', length: 255 })
  key!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
