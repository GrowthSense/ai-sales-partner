import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { McpServer, McpAuthConfig } from '../entities/mcp-server.entity';
import { EncryptionService } from '../../common/services/encryption.service';
import { MCPProviderStatus } from '../../common/enums';

const MCP_CALL_TIMEOUT_MS = 10_000;
const MCP_MAX_RESPONSE_BYTES = 50 * 1024; // 50 KB
const RATE_LIMIT_WINDOW_SECONDS = 60;

export class McpCallError extends Error {
  constructor(
    message: string,
    public readonly serverId: string,
    public readonly toolName: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'McpCallError';
  }
}

export interface McpDecryptedAuth {
  authType: 'bearer' | 'api-key' | 'basic' | 'none';
  token?: string;
  username?: string;
}

/**
 * McpProxyService
 *
 * Executes tool calls against registered MCP servers. All calls are
 * server-side only — credentials never reach the client browser.
 *
 * Per-call guarantees:
 *  - 10s timeout enforced via AbortController
 *  - 50KB response cap (anything larger is rejected)
 *  - Per-server rate limiting via Redis sliding window (rateLimitRpm)
 *  - Auth credentials loaded + decrypted only at call time
 *  - Any error updates the server's status to SYNC_ERROR
 */
@Injectable()
export class McpProxyService {
  private readonly logger = new Logger(McpProxyService.name);

  constructor(
    @InjectRepository(McpServer)
    private readonly serverRepo: Repository<McpServer>,

    private readonly encryption: EncryptionService,

    @InjectRedis()
    private readonly redis: Redis,
  ) {}

  // ─── Tool call ────────────────────────────────────────────────────────────

  async call(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    tenantId: string,
  ): Promise<unknown> {
    // Load server record (with encrypted auth config)
    const server = await this.serverRepo
      .createQueryBuilder('s')
      .addSelect('s.auth_config')
      .where('s.id = :id', { id: serverId })
      .andWhere('s.tenant_id = :tenantId', { tenantId })
      .getOne();

    if (!server) {
      throw new McpCallError('MCP server not found', serverId, toolName);
    }

    if (!server.isActive || server.status === MCPProviderStatus.INACTIVE) {
      throw new McpCallError('MCP server is inactive', serverId, toolName);
    }

    // Rate limit check
    await this.enforceRateLimit(serverId, server.rateLimitRpm);

    // Build auth header
    const authHeader = server.authConfig
      ? this.buildAuthHeader(server.authConfig)
      : undefined;

    // POST to MCP endpoint
    const url = `${server.endpoint.replace(/\/$/, '')}/tools/${encodeURIComponent(toolName)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MCP_CALL_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify({ args }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new McpCallError(
          `MCP server returned HTTP ${response.status}: ${body.slice(0, 200)}`,
          serverId,
          toolName,
          response.status,
        );
      }

      // Enforce response size cap
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MCP_MAX_RESPONSE_BYTES) {
        throw new McpCallError(
          `MCP response exceeds 50KB cap (content-length=${contentLength})`,
          serverId,
          toolName,
        );
      }

      const text = await response.text();
      if (text.length > MCP_MAX_RESPONSE_BYTES) {
        throw new McpCallError(
          `MCP response body exceeds 50KB cap (actual=${text.length} bytes)`,
          serverId,
          toolName,
        );
      }

      return JSON.parse(text) as unknown;
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      if (err instanceof McpCallError) {
        await this.markServerError(serverId, err.message);
        throw err;
      }

      const message =
        err instanceof Error && err.name === 'AbortError'
          ? `MCP call timed out after ${MCP_CALL_TIMEOUT_MS}ms`
          : err instanceof Error
            ? err.message
            : String(err);

      await this.markServerError(serverId, message);
      throw new McpCallError(message, serverId, toolName);
    }
  }

  // ─── Tool schema discovery ────────────────────────────────────────────────

  /**
   * Fetches the tool list from the MCP server's GET /tools endpoint.
   * Used by McpRegistryService during sync.
   */
  async fetchToolSchemas(serverId: string, tenantId: string): Promise<unknown[]> {
    const server = await this.serverRepo
      .createQueryBuilder('s')
      .addSelect('s.auth_config')
      .where('s.id = :id', { id: serverId })
      .andWhere('s.tenant_id = :tenantId', { tenantId })
      .getOne();

    if (!server) {
      throw new McpCallError('MCP server not found', serverId, 'tool-discovery');
    }

    const authHeader = server.authConfig
      ? this.buildAuthHeader(server.authConfig)
      : undefined;

    const url = `${server.endpoint.replace(/\/$/, '')}/tools`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MCP_CALL_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new McpCallError(
          `GET /tools returned HTTP ${response.status}`,
          serverId,
          'tool-discovery',
          response.status,
        );
      }

      const body = await response.json() as unknown;
      return Array.isArray(body) ? body : (body as { tools?: unknown[] }).tools ?? [];
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      throw err instanceof McpCallError ? err : new McpCallError(
        err instanceof Error ? err.message : String(err),
        serverId,
        'tool-discovery',
      );
    }
  }

  // ─── Auth header builder ──────────────────────────────────────────────────

  private buildAuthHeader(encryptedAuth: McpAuthConfig): string | undefined {
    const { encryptedData, iv, authTag, authType } = encryptedAuth;

    if (authType === 'none') return undefined;

    const decrypted = this.encryption.decryptJson<McpDecryptedAuth>({
      encryptedData,
      iv,
      authTag,
    });

    switch (decrypted.authType) {
      case 'bearer':
        return `Bearer ${decrypted.token}`;
      case 'api-key':
        return `ApiKey ${decrypted.token}`;
      case 'basic': {
        const creds = Buffer.from(`${decrypted.username}:${decrypted.token}`).toString('base64');
        return `Basic ${creds}`;
      }
      default:
        return undefined;
    }
  }

  // ─── Rate limiting ────────────────────────────────────────────────────────

  private async enforceRateLimit(serverId: string, rpm: number): Promise<void> {
    const key = `mcp:rate:${serverId}`;
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_SECONDS * 1000;

    // Sliding window using sorted set
    await this.redis
      .multi()
      .zremrangebyscore(key, '-inf', windowStart)
      .zadd(key, now, `${now}-${Math.random()}`)
      .expire(key, RATE_LIMIT_WINDOW_SECONDS + 1)
      .exec();

    const count = await this.redis.zcard(key);

    if (count > rpm) {
      throw new McpCallError(
        `Rate limit exceeded: ${count}/${rpm} calls/min for server ${serverId}`,
        serverId,
        'rate-limit',
      );
    }
  }

  // ─── Status helpers ───────────────────────────────────────────────────────

  private async markServerError(serverId: string, message: string): Promise<void> {
    await this.serverRepo.update(serverId, {
      status: MCPProviderStatus.SYNC_ERROR,
      lastError: message.slice(0, 500),
    });
    this.logger.warn(`MCP server ${serverId} marked as SYNC_ERROR: ${message}`);
  }
}
