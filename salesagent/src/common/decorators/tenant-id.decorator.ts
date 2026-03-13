import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { RequestUser } from '../../auth/interfaces/jwt-payload.interface';

/**
 * @TenantId() — extracts tenantId from the authenticated JWT claim.
 *
 * RULE: ALWAYS source tenantId from the JWT, NEVER from the request body
 * or URL parameters. Accepting tenantId from the client would allow
 * cross-tenant data access.
 *
 * Usage:
 *   @Get('/agents')
 *   list(@TenantId() tenantId: string) {
 *     return this.agentsService.findByTenant(tenantId);
 *   }
 *
 * In services: pass tenantId into EVERY query. This is the primary
 * multi-tenant isolation mechanism at the application layer.
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request & { user: RequestUser }>();
    return request.user.tenantId;
  },
);
