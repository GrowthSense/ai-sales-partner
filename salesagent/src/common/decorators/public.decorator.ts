import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * @Public() — marks a route as unauthenticated, bypassing JwtAuthGuard.
 *
 * Used on:
 *   POST /auth/login
 *   POST /auth/refresh
 *   POST /auth/widget/session
 *   GET  /widget-config/:widgetKey
 *
 * The global JwtAuthGuard checks for this metadata before calling Passport.
 * Apply at method level, not controller level, to avoid accidentally
 * exposing all routes on a controller.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
