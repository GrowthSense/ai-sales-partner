import { SetMetadata } from '@nestjs/common';
import { TenantMemberRole } from '../enums';

export const ROLES_KEY = 'roles';

/**
 * @Roles(...roles) — restricts a route to users with one of the specified roles.
 *
 * Must be used together with RolesGuard (applied after JwtAuthGuard).
 * Super-admins bypass all role checks regardless of specified roles.
 *
 * Role hierarchy (highest to lowest):
 *   OWNER  — can do everything including delete tenant, transfer ownership
 *   ADMIN  — full CRUD on all resources within the tenant
 *   MEMBER — read-only access to conversations and leads
 *
 * Usage:
 *   @Roles(TenantMemberRole.OWNER, TenantMemberRole.ADMIN)
 *   @Delete('/agents/:id')
 *   deleteAgent(...) {}
 *
 * To require super-admin (platform-level):
 *   @UseGuards(SuperAdminGuard)
 */
export const Roles = (...roles: TenantMemberRole[]) => SetMetadata(ROLES_KEY, roles);
