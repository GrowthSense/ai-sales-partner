import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../services/auth.service';

/**
 * LocalStrategy — Passport strategy for POST /auth/login.
 *
 * Extracts `email` and `password` from request body (not query/params).
 * Delegates credential validation to AuthService.validateUser().
 *
 * On success: attaches the validated User to request.user (used by AuthController.login()).
 * On failure: throws UnauthorizedException (401).
 */
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string) {
    const user = await this.authService.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user; // attached to request.user
  }
}
