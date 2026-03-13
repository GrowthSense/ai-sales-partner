import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { TenantMemberRole } from '../enums';
import { RequestUser } from '../../auth/interfaces/jwt-payload.interface';

/**
 * RolesGuard — enforces role-based access control on routes decorated with @Roles().
 *
 * Must be applied AFTER JwtAuthGuard (request.user must already be populated).
 *
 * Checks:
 *   1. If no @Roles() metadata → allow (guard is a no-op)
 *   2. If user.isSuperAdmin → allow (bypasses all role requirements)
 *   3. If user.role is in the allowed roles list → allow
 *   4. Otherwise → ForbiddenException (403)
 *
 * Usage (method-level):
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles(TenantMemberRole.OWNER, TenantMemberRole.ADMIN)
 *   @Delete('/agents/:id')
 *   deleteAgent() {}
 *
 * Usage (controller-level):
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles(TenantMemberRole.ADMIN)  ← applies to all routes in controller
 *   @Controller('agents')
 *   export class AgentsController {}
 *
 *   Individual routes can then override with a stricter @Roles() decorator.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Merge handler-level and controller-level metadata (handler takes precedence)
    const requiredRoles = this.reflector.getAllAndOverride<TenantMemberRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator — this guard is a no-op
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user: RequestUser }>();
    const user = request.user;

    if (!user) return false;

    // Super-admins bypass all role requirements
    if (user.isSuperAdmin) return true;

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Insufficient role. Required: [${requiredRoles.join(', ')}], got: ${user.role}`,
      );
    }

    return true;
  }
}
