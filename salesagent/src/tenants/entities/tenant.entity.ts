import {
  Entity,
  Column,
  Index,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { TenantPlan } from '../../common/enums';
import { TenantMember } from './tenant-member.entity';
import { TenantIntegration } from './tenant-integration.entity';

export interface TenantBranding {
  primaryColor: string;
  logoUrl: string | null;
  agentName: string;
  greetingMessage: string;
}

export interface TenantSettings {
  branding: TenantBranding;
  allowedDomains: string[];          // domains where the widget embed is permitted
  timezone: string;                  // IANA timezone, e.g. 'America/New_York'
  conversationRetentionDays: number;
  leadNotificationEmail: string | null;
}

@Entity('tenants')
@Index(['plan'])
@Index(['isActive'])
export class Tenant extends BaseEntity {
  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true, nullable: false })
  slug: string;

  /**
   * Embedded in the visitor JS widget.
   * Separate from `id` so it can be rotated (e.g. after a security incident)
   * without changing the tenant's primary key or cascading updates.
   */
  @Column({ type: 'uuid', name: 'widget_key', unique: true, nullable: false })
  widgetKey: string;

  @Column({
    type: 'enum',
    enum: TenantPlan,
    default: TenantPlan.FREE,
    nullable: false,
  })
  plan: TenantPlan;

  @Column({ type: 'boolean', name: 'is_active', default: true, nullable: false })
  isActive: boolean;

  /**
   * Non-sensitive tenant settings: branding, domain allowlist, timezone.
   * Secrets (API keys, OAuth tokens) are stored in TenantIntegration.credentials (encrypted).
   */
  @Column({ type: 'jsonb', nullable: false, default: '{}' })
  settings: TenantSettings;

  // ─── Relations ──────────────────────────────────────────────────────────────
  @OneToMany(() => TenantMember, (member) => member.tenant)
  members: TenantMember[];

  @OneToMany(() => TenantIntegration, (integration) => integration.tenant)
  integrations: TenantIntegration[];
}
