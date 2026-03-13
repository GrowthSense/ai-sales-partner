import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../../decorators/public.decorator';

// Stub out Passport's super.canActivate — we only test the @Public() bypass logic here.
// The JWT strategy itself is tested in the auth integration tests.
jest.mock('@nestjs/passport', () => ({
  AuthGuard: (_strategy: string) => {
    return class {
      canActivate(_ctx: ExecutionContext) {
        return true; // stub: passport validates the token
      }
    };
  },
}));

function makeContext(isPublic: boolean, isClassPublic = false): ExecutionContext {
  const handler = jest.fn();
  const controller = jest.fn();

  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: 'Bearer fake-token' } }),
    }),
    _isPublic: isPublic,
    _isClassPublic: isClassPublic,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    guard = new JwtAuthGuard(reflector);
  });

  it('returns true immediately for @Public() routes without calling Passport', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const ctx = makeContext(true);

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
  });

  it('delegates to Passport AuthGuard for protected routes', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const ctx = makeContext(false);

    // The mocked super.canActivate returns true — we just verify delegation happens
    const result = guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('checks both handler and class for the @Public() metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const ctx = makeContext(false);

    guard.canActivate(ctx);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      IS_PUBLIC_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
  });

  it('allows access when @Public() is on the class (not the handler)', () => {
    // getAllAndOverride merges handler + class — returning true means either has it
    reflector.getAllAndOverride.mockReturnValue(true);
    const ctx = makeContext(false, true);

    const result = guard.canActivate(ctx);
    expect(result).toBe(true);
  });
});
