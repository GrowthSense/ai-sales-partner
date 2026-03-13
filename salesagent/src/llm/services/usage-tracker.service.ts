import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { IUsageTracker, UsageRecord } from '../interfaces/usage-tracker.interface';

/**
 * Redis-backed usage tracker.
 *
 * Storage layout (all keys prefixed `llm:usage:`):
 *
 *   llm:usage:{tenantId}:tokens:{YYYY-MM-DD}  →  INCRBY (daily token counter)
 *   llm:usage:{tenantId}:reqs:{YYYY-MM-DD}    →  INCR   (daily request counter)
 *
 * Each key TTL = 32 days so 30-day window lookups always have data.
 *
 * This intentionally does NOT write to Postgres — high-frequency increments
 * would create write pressure. Aggregate totals are readable via getUsage().
 * If you need per-session breakdowns, write a background job to flush Redis
 * aggregates to a usage_records table nightly.
 */
@Injectable()
export class UsageTrackerService implements IUsageTracker {
  private readonly logger = new Logger(UsageTrackerService.name);
  private readonly TTL_SECONDS = 32 * 24 * 60 * 60; // 32 days

  constructor(@InjectRedis() private readonly redis: Redis) {}

  async record(rec: UsageRecord): Promise<void> {
    try {
      const day = rec.timestamp.toISOString().slice(0, 10); // YYYY-MM-DD
      const tokenKey = `llm:usage:${rec.tenantId}:tokens:${day}`;
      const reqKey = `llm:usage:${rec.tenantId}:reqs:${day}`;

      await this.redis
        .multi()
        .incrby(tokenKey, rec.usage.totalTokens)
        .expire(tokenKey, this.TTL_SECONDS)
        .incr(reqKey)
        .expire(reqKey, this.TTL_SECONDS)
        .exec();
    } catch (err) {
      // Never throw — usage tracking must not break the main request path
      this.logger.error('Failed to record LLM usage', err);
    }
  }

  async getUsage(
    tenantId: string,
    windowDays: number,
  ): Promise<{ totalTokens: number; totalRequests: number }> {
    const today = new Date();
    const keys: string[] = [];
    const reqKeys: string[] = [];

    for (let i = 0; i < windowDays; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const day = d.toISOString().slice(0, 10);
      keys.push(`llm:usage:${tenantId}:tokens:${day}`);
      reqKeys.push(`llm:usage:${tenantId}:reqs:${day}`);
    }

    const [tokenValues, reqValues] = await Promise.all([
      this.redis.mget(...keys),
      this.redis.mget(...reqKeys),
    ]);

    const totalTokens = tokenValues.reduce(
      (sum, v) => sum + (v ? parseInt(v, 10) : 0),
      0,
    );
    const totalRequests = reqValues.reduce(
      (sum, v) => sum + (v ? parseInt(v, 10) : 0),
      0,
    );

    return { totalTokens, totalRequests };
  }
}
