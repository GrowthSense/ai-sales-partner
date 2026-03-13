import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * JwtAuthGuard — global guard applied to all HTTP routes.
 *
 * Behaviour:
 *   - Routes decorated with @Public() are passed through without JWT validation.
 *   - All other routes require a valid Bearer access token.
 *
 * Registration:
 *   In AppModule or the relevant feature module, register as a global guard:
 *
 *     { provide: APP_GUARD, useClass: JwtAuthGuard }
 *
 *   This way every controller is protected by default.
 *   Only explicitly @Public() routes are exempted.
 *
 * Note: This guard only validates JWT authenticity and expiry.
 * Role-based access control is handled by the separate RolesGuard.
 * Tenant isolation is the service layer's responsibility (always filter by tenantId).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    return super.canActivate(context);
  }
}
