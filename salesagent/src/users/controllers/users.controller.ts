import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/interfaces/jwt-payload.interface';
import { UsersService, InviteUserDto, UpdateUserDto } from '../services/users.service';
import { TenantMemberRole } from '../../common/enums';

/**
 * UsersController
 *
 * Tenant-scoped user management.
 * All routes require:
 *   - Valid access token (JwtAuthGuard)
 *   - ADMIN or OWNER role (RolesGuard) — except GET routes which allow MEMBER
 *
 * GET    /users             — list active members (all roles)
 * POST   /users/invite      — invite a user to the tenant (ADMIN+)
 * GET    /users/:id         — get member details (all roles)
 * PATCH  /users/:id         — update name (all roles, own profile; ADMIN+ for others)
 * PATCH  /users/:id/role    — change role (OWNER only)
 * DELETE /users/:id         — deactivate membership (ADMIN+)
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(
    @TenantId() tenantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.findAll(tenantId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Post('invite')
  @Roles(TenantMemberRole.ADMIN, TenantMemberRole.OWNER)
  async invite(
    @Body() dto: InviteUserDto,
    @TenantId() tenantId: string,
  ) {
    return this.usersService.invite(dto, tenantId);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.usersService.findById(id, tenantId);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @TenantId() tenantId: string,
  ) {
    return this.usersService.update(id, dto, tenantId);
  }

  @Patch(':id/role')
  @Roles(TenantMemberRole.OWNER)
  async updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('role') role: TenantMemberRole,
    @TenantId() tenantId: string,
    @CurrentUser() requestingUser: RequestUser,
  ) {
    return this.usersService.updateRole(id, role, tenantId, requestingUser.userId);
  }

  @Delete(':id')
  @Roles(TenantMemberRole.ADMIN, TenantMemberRole.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() requestingUser: RequestUser,
  ) {
    await this.usersService.deactivate(id, tenantId, requestingUser.userId);
  }
}
