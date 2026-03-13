import { SocialPlatform } from '../../common/enums';

/**
 * A single raw comment as returned by any social platform adapter.
 */
export interface RawSocialComment {
  /** Platform-assigned comment ID. */
  externalId: string;
  text: string;
  authorName: string;
  authorUsername: string | null;
  authorEmail: string | null;
  publishedAt: Date;
  postUrl: string | null;
  platform: SocialPlatform;
}

/**
 * Non-secret config stored in SocialAccount.config (JSONB).
 * Each adapter reads the fields it cares about.
 */
export interface SocialAccountConfig {
  /** Encrypted credentials are decrypted server-side before calling the adapter. */
  accessToken: string;
  /** Facebook/Instagram: page or business account ID. */
  pageId?: string;
  /** LinkedIn: organisation URN (urn:li:organization:<id>). */
  organizationUrn?: string;
  /** Twitter: user ID whose mentions/replies to monitor. */
  twitterUserId?: string;
}

/**
 * ISocialAdapter — contract every platform adapter must implement.
 *
 * getComments() must be idempotent — the same comment returned twice will
 * be deduped by the worker via the (externalId, platform) unique index.
 */
export interface ISocialAdapter {
  readonly platform: SocialPlatform;

  /**
   * Fetch comments published between since (exclusive) and now.
   * If since is null, fetch the most recent 200 comments.
   */
  getComments(
    config: SocialAccountConfig,
    since: Date | null,
  ): Promise<RawSocialComment[]>;
}
