import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RefreshToken } from './entities/refresh-token.entity';
import { AuthService } from './services/auth.service';
import { AuthController } from './controllers/auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { WidgetJwtStrategy } from './strategies/widget-jwt.strategy';

import { UsersModule } from '../users/users.module';
import { TenantsModule } from '../tenants/tenants.module';

/**
 * AuthModule
 *
 * Handles all authentication and session concerns.
 *
 * ─── Token model ─────────────────────────────────────────────────────────────
 *   Access token (JWT, 15m)   — stateless, validated by JwtStrategy
 *   Refresh token (JWT, 7d)   — hashed in DB, rotated on use
 *   Widget token (JWT, 24h)   — visitor sessions, separate secret
 *
 * ─── Passport strategies ─────────────────────────────────────────────────────
 *   'local'       — email+password for POST /auth/login (LocalStrategy)
 *   'jwt'         — Bearer access token for all admin routes (JwtStrategy)
 *   'widget-jwt'  — Visitor token for WS /chat namespace (WidgetJwtStrategy)
 *
 * ─── Exports ─────────────────────────────────────────────────────────────────
 *   JwtModule     — so other modules (WebsocketModule) can sign/verify tokens
 *   AuthService   — for WS guards that need issueWidgetSession
 *
 * ─── Global guard registration ───────────────────────────────────────────────
 *   JwtAuthGuard is registered globally in AppModule via APP_GUARD token.
 *   This protects every route by default. @Public() routes are exempted.
 *   RolesGuard is NOT global — it must be explicitly added to controllers
 *   or routes that require role enforcement.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),

    // Access token JwtModule — default strategy
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
        },
      }),
    }),

    TypeOrmModule.forFeature([RefreshToken]),

    UsersModule,
    TenantsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    LocalStrategy,
    WidgetJwtStrategy,
  ],
  exports: [
    JwtModule,
    AuthService,
  ],
})
export class AuthModule {}
