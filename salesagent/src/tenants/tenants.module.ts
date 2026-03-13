import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Tenant } from './entities/tenant.entity';
import { TenantMember } from './entities/tenant-member.entity';

import { TenantsService } from './services/tenants.service';
import { TenantsController, WidgetConfigController } from './controllers/tenants.controller';

/**
 * TenantsModule
 *
 * Tenant lifecycle management and public widget configuration.
 *
 * Endpoints:
 *   POST   /tenants               — create tenant (super-admin)
 *   GET    /tenants               — list all tenants (super-admin)
 *   GET    /tenants/me            — current tenant (JWT)
 *   GET    /tenants/:id           — tenant detail
 *   PATCH  /tenants/:id           — update settings
 *   POST   /tenants/:id/rotate-widget-key — security: rotate embed key
 *   GET    /widget-config/:widgetKey      — public widget bootstrap config
 *
 * TenantsService is exported so other modules (auth, websocket guards,
 * agent orchestrator) can look up tenants by widgetKey or id.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TenantMember])],
  controllers: [TenantsController, WidgetConfigController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
