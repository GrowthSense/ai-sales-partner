import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { RequestUser } from '../interfaces/jwt-payload.interface';

/**
 * SuperAdminGuard — restricts routes to platform super-admins only.
 *
 * Super-admin status is encoded in the JWT payload (isSuperAdmin: true).
 * AuthService.login() sets this flag if the user's email matches
 * the SUPER_ADMIN_EMAIL environment variable.
 *
 * Used on:
 *   POST   /tenants          — create tenant
 *   GET    /tenants          — list all tenants
 *   DELETE /tenants/:id      — delete tenant
 *
 * Apply as: @UseGuards(JwtAuthGuard, SuperAdminGuard)
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user: RequestUser }>();
    const user = request.user;

    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('This endpoint requires super-admin privileges');
    }

    return true;
  }
}
