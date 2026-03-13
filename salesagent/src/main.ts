// Node 18 CJS doesn't expose Web Crypto as a global — needed by @nestjs/schedule
import { webcrypto } from 'crypto';
if (!global.crypto) {
  (global as any).crypto = webcrypto;
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  // Global validation pipe — strip unknown properties, transform types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Socket.io adapter for WebSocket support
  app.useWebSocketAdapter(new IoAdapter(app));

  // CORS — restrict to tenant widget domains in production via config
  app.enableCors({
    origin: configService.get<string>('CORS_ORIGINS', '*'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Global prefix for REST API
  app.setGlobalPrefix('api/v1');

  // Swagger / OpenAPI documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Salesagent API')
    .setDescription('Multi-tenant AI sales agent SaaS — REST API reference')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addTag('auth', 'Authentication — login, refresh, widget session')
    .addTag('users', 'Tenant user management')
    .addTag('tenants', 'Tenant lifecycle and configuration')
    .addTag('agents', 'Agent configuration and the reasoning loop')
    .addTag('conversations', 'Conversation and message history')
    .addTag('leads', 'Lead profiles and CRM sync')
    .addTag('skills', 'Skill catalog and tenant activation')
    .addTag('knowledge', 'Knowledge base documents and RAG search')
    .addTag('integrations', 'CRM, calendar and email integrations')
    .addTag('mcp', 'MCP server registry and tool proxy')
    .addTag('workflows', 'Automated follow-up workflows')
    .addTag('analytics', 'Tenant dashboard analytics')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  await app.listen(port);
  console.log(`Salesagent API running on: http://localhost:${port}/api/v1`);
  console.log(`Swagger docs:             http://localhost:${port}/api/docs`);
}

bootstrap();
