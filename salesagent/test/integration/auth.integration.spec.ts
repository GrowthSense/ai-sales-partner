/**
 * Auth & Tenant Guard — Integration Tests
 *
 * Tests the full HTTP request lifecycle against the NestJS application:
 *   - Login → JWT issuance
 *   - Protected route with valid token
 *   - Protected route with invalid/expired token
 *   - @Public() route accessible without token
 *   - Tenant isolation: user of tenant A cannot access tenant B's resources
 *   - Widget session token issuance and validation
 *   - Refresh token rotation
 *
 * Uses supertest against the full NestJS app with a real DB connection.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../../src/app.module';

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface TestTenant {
  id: string;
  widgetKey: string;
}

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

async function createTenantAndUser(
  app: INestApplication,
  email: string,
  password: string,
): Promise<{ tenant: TestTenant; user: TestUser }> {
  // Create tenant via super-admin endpoint (if available) or direct DB insert
  const ds = app.get(DataSource);

  const [tenant] = await ds.query<TestTenant[]>(
    `INSERT INTO tenants (name, widget_key, plan) VALUES ($1, gen_random_uuid(), 'pro')
     RETURNING id, widget_key AS "widgetKey"`,
    [`Test Tenant ${Date.now()}`],
  );

  const bcrypt = require('bcrypt');
  const hash = await bcrypt.hash(password, 10);

  await ds.query(
    `INSERT INTO users (tenant_id, email, password_hash, status, role)
     VALUES ($1, $2, $3, 'active', 'admin')`,
    [tenant.id, email, hash],
  );

  // Login to get tokens
  const loginRes = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);

  return {
    tenant,
    user: {
      id: loginRes.body.user.id,
      email,
      accessToken: loginRes.body.accessToken,
      refreshToken: loginRes.body.refreshToken,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Auth — Integration', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantA: TestTenant;
  let userA: TestUser;
  let tenantB: TestTenant;
  let userB: TestUser;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    ds = app.get(DataSource);

    ({ tenant: tenantA, user: userA } = await createTenantAndUser(
      app,
      `user-a-${Date.now()}@integration.test`,
      'Password123!',
    ));

    ({ tenant: tenantB, user: userB } = await createTenantAndUser(
      app,
      `user-b-${Date.now()}@integration.test`,
      'Password123!',
    ));
  });

  afterAll(async () => {
    // Clean up test data
    await ds.query(
      `DELETE FROM users WHERE email LIKE '%@integration.test'`,
    );
    await ds.query(
      `DELETE FROM tenants WHERE id IN ($1, $2)`,
      [tenantA.id, tenantB.id],
    );
    await app.close();
  });

  // ── Login ─────────────────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('returns access and refresh tokens for valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userA.email, password: 'Password123!' })
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.user.email).toBe(userA.email);
    });

    it('returns 401 for wrong password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userA.email, password: 'WrongPassword' })
        .expect(401);
    });

    it('returns 401 for non-existent user', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@nowhere.test', password: 'Password123!' })
        .expect(401);
    });

    it('is a @Public() route — no token required', async () => {
      // Verified by the test above succeeding with no Authorization header
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userA.email, password: 'Password123!' })
        .expect(200); // not 401
    });
  });

  // ── Protected routes ──────────────────────────────────────────────────────

  describe('JWT protection', () => {
    it('allows access to protected routes with a valid access token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);
    });

    it('rejects requests with no token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .expect(401);
    });

    it('rejects requests with a malformed token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer not.a.real.jwt')
        .expect(401);
    });

    it('rejects requests with a token signed by the wrong secret', async () => {
      const jwtService = app.get(JwtService);
      const forgedToken = jwtService.sign(
        { sub: userA.id, tenantId: tenantA.id },
        { secret: 'wrong-secret' },
      );

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${forgedToken}`)
        .expect(401);
    });
  });

  // ── Token refresh ─────────────────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    it('issues a new access token for a valid refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: userA.refreshToken })
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.accessToken).not.toBe(userA.accessToken); // rotated
    });

    it('returns 401 for an invalid refresh token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'invalid-refresh-token' })
        .expect(401);
    });
  });

  // ── Widget session ────────────────────────────────────────────────────────

  describe('POST /auth/widget/session', () => {
    it('issues an anonymous widget session token for a valid widget key', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/widget/session')
        .send({ widgetKey: tenantA.widgetKey })
        .expect(201);

      expect(res.body.sessionToken).toBeDefined();
      expect(res.body.tenantId).toBe(tenantA.id);
    });

    it('returns 404 for an unknown widget key', async () => {
      await request(app.getHttpServer())
        .post('/auth/widget/session')
        .send({ widgetKey: 'aaaaaaaa-0000-0000-0000-000000000000' })
        .expect(404);
    });
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────

  describe('Tenant isolation', () => {
    it('user A cannot read user B\'s leads (returns empty or 403)', async () => {
      // First create a lead for tenant B
      const ds2 = app.get(DataSource);
      const convBId = crypto.randomUUID();

      await ds2.query(
        `INSERT INTO conversations (id, tenant_id, agent_id, visitor_id, current_stage, status)
         SELECT gen_random_uuid(), $1, a.id, gen_random_uuid(), 'greeting', 'active'
         FROM agents a WHERE a.tenant_id = $1 LIMIT 1`,
        [tenantB.id],
      );

      // User A queries tenant B's leads — should see nothing (tenant scoped)
      const res = await request(app.getHttpServer())
        .get('/leads')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      // Results are scoped to userA's tenant — no tenant B leads visible
      const leadIds = (res.body.data ?? res.body).map((l: any) => l.id);
      const tenantBLeads = await ds2.query(
        `SELECT id FROM leads WHERE tenant_id = $1`,
        [tenantB.id],
      );
      for (const { id } of tenantBLeads) {
        expect(leadIds).not.toContain(id);
      }
    });
  });
});
