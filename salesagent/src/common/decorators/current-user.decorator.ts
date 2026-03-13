import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { RequestUser } from '../../auth/interfaces/jwt-payload.interface';

/**
 * @CurrentUser() — extracts the authenticated user from the request.
 *
 * Populated by JwtStrategy.validate() after a valid access token is verified.
 *
 * Usage:
 *   @Get('/me')
 *   getMe(@CurrentUser() user: RequestUser) {
 *     return { userId: user.userId, role: user.role };
 *   }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user: RequestUser }>();
    return request.user;
  },
);
