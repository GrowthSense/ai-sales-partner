import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { RedisModule } from '@nestjs-modules/ioredis';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { configSchema } from './config/config.schema';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TenantsModule } from './tenants/tenants.module';
import { AgentsModule } from './agents/agents.module';
import { ConversationsModule } from './conversations/conversations.module';
import { LeadsModule } from './leads/leads.module';
import { SkillsModule } from './skills/skills.module';
import { ToolsModule } from './tools/tools.module';
import { McpModule } from './mcp/mcp.module';
import { RagModule } from './rag/rag.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { WebsocketModule } from './websocket/websocket.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { SocialMediaModule } from './social-media/social-media.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    // ─── Configuration ───────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: configSchema,
      validationOptions: {
        abortEarly: false,   // Report all invalid vars at once
        allowUnknown: true,  // Ignore vars not in the schema (OS env, CI vars)
      },
    }),

    // ─── Database (PostgreSQL + pgvector) ────────────────────────────────────
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        ssl: config.get<boolean>('DATABASE_SSL', false)
          ? { rejectUnauthorized: false }
          : false,
        autoLoadEntities: true,
        synchronize: false, // Always use migrations in production
        logging: config.get('NODE_ENV') === 'development',
      }),
    }),

    // ─── Redis (IORedis — used by UsageTracker, McpProxy, WS adapter) ────────
    RedisModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'single',
        url: config.get<string>('REDIS_URL'),
      }),
    }),

    // ─── Redis / BullMQ ──────────────────────────────────────────────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL'),
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 500,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      }),
    }),

    // ─── Feature Modules ─────────────────────────────────────────────────────
    AuthModule,
    UsersModule,
    TenantsModule,
    AgentsModule,
    ConversationsModule,
    LeadsModule,
    SkillsModule,
    ToolsModule,
    McpModule,
    RagModule,
    KnowledgeModule,
    WorkflowsModule,
    IntegrationsModule,
    WebsocketModule,
    AnalyticsModule,
    SocialMediaModule,
    WhatsAppModule,
  ],
  providers: [
    // ─── Global guards ────────────────────────────────────────────────────────
    // JwtAuthGuard protects every HTTP route by default.
    // Routes opt-out via @Public(). Role enforcement is NOT global —
    // apply RolesGuard explicitly on controllers/routes that need it.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
