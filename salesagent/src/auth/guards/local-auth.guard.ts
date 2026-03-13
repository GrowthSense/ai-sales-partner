import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * LocalAuthGuard — triggers the Passport local strategy for POST /auth/login.
 *
 * The local strategy calls AuthService.validateUser(email, password).
 * On success, attaches the validated User to request.user.
 * On failure, throws UnauthorizedException (401).
 *
 * Apply only to POST /auth/login — all other routes use JwtAuthGuard.
 */
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}
