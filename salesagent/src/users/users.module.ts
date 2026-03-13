import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from './entities/user.entity';
import { TenantMember } from '../tenants/entities/tenant-member.entity';

import { UsersService } from './services/users.service';
import { UsersController } from './controllers/users.controller';

/**
 * UsersModule
 *
 * Manages User records and TenantMember memberships.
 *
 * Key design:
 *   - User is a global identity (email is globally unique)
 *   - TenantMember is the authoritative source for role within a tenant
 *   - UsersService is exported so AuthModule can call findByEmailForAuth()
 *     and findMembership() without a circular dependency
 *
 * Endpoints (all JWT-protected, tenant-scoped):
 *   GET    /users              — list active members
 *   POST   /users/invite       — invite user to tenant (ADMIN+)
 *   GET    /users/:id          — get member by id
 *   PATCH  /users/:id          — update profile
 *   PATCH  /users/:id/role     — change role (OWNER only)
 *   DELETE /users/:id          — deactivate membership (ADMIN+)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, TenantMember]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
