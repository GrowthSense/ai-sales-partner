import { Injectable, Logger } from '@nestjs/common';
import { SocialPlatform } from '../../common/enums';
import {
  ISocialAdapter,
  RawSocialComment,
  SocialAccountConfig,
} from '../interfaces/social-adapter.interface';

/**
 * TwitterClient
 *
 * Uses Twitter API v2 to fetch mentions and replies directed at the account.
 * Endpoint: GET /2/users/:id/mentions
 * Requires: tweet.read, users.read, offline.access OAuth 2.0 scopes.
 *
 * Free tier: 500,000 tweet reads/month. We use start_time to fetch
 * incrementally and keep within limits.
 */
@Injectable()
export class TwitterClient implements ISocialAdapter {
  readonly platform = SocialPlatform.TWITTER;

  private readonly logger = new Logger(TwitterClient.name);
  private readonly baseUrl = 'https://api.twitter.com/2';

  async getComments(
    config: SocialAccountConfig,
    since: Date | null,
  ): Promise<RawSocialComment[]> {
    const { accessToken, twitterUserId } = config;

    if (!twitterUserId) {
      this.logger.warn('TwitterClient: twitterUserId missing in config — skipping');
      return [];
    }

    const params = new URLSearchParams({
      'tweet.fields': 'created_at,author_id,text,entities',
      'user.fields': 'name,username',
      expansions: 'author_id',
      max_results: '100',
      ...(since ? { start_time: since.toISOString() } : {}),
    });

    const url = `${this.baseUrl}/users/${twitterUserId}/mentions?${params.toString()}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Twitter API error: ${response.status} ${body}`);
      return [];
    }

    const data = (await response.json()) as {
      data?: Array<{
        id: string;
        text: string;
        author_id: string;
        created_at: string;
      }>;
      includes?: {
        users?: Array<{ id: string; name: string; username: string }>;
      };
    };

    const userMap = new Map(
      (data.includes?.users ?? []).map((u) => [u.id, u]),
    );

    const comments: RawSocialComment[] = (data.data ?? []).map((tweet) => {
      const author = userMap.get(tweet.author_id);
      return {
        externalId: tweet.id,
        text: tweet.text,
        authorName: author?.name ?? 'Unknown',
        authorUsername: author?.username ?? null,
        authorEmail: null,
        publishedAt: new Date(tweet.created_at),
        postUrl: author?.username
          ? `https://twitter.com/${author.username}/status/${tweet.id}`
          : null,
        platform: SocialPlatform.TWITTER,
      };
    });

    this.logger.debug(
      `Twitter: fetched ${comments.length} mentions for user ${twitterUserId}`,
    );

    return comments;
  }
}
