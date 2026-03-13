import { Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';

/**
 * Abstract base for all tenant-scoped entities.
 * Every subclass automatically carries tenantId and a FK to Tenant.
 *
 * RULE: Every query on a subclass MUST include WHERE tenant_id = :tenantId.
 * The @Index on tenantId ensures this is fast and the DB can enforce isolation.
 */
export abstract class TenantScopedEntity extends BaseEntity {
  @Column({ type: 'uuid', name: 'tenant_id' })
  @Index()
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
