import { Injectable, Logger } from '@nestjs/common';
import { SocialPlatform } from '../../common/enums';
import {
  ISocialAdapter,
  RawSocialComment,
  SocialAccountConfig,
} from '../interfaces/social-adapter.interface';

/**
 * FacebookClient
 *
 * Uses the Facebook Graph API to fetch comments on a Page's posts.
 * Endpoint: GET /{page-id}/feed?fields=comments{...}&since=<unix>
 *
 * Rate limit: ~200 calls/hour per access token (standard tier).
 * We fetch incrementally (since lastSyncedAt) to stay within limits.
 */
@Injectable()
export class FacebookClient implements ISocialAdapter {
  readonly platform = SocialPlatform.FACEBOOK;

  private readonly logger = new Logger(FacebookClient.name);
  private readonly apiVersion = 'v19.0';
  private readonly baseUrl = `https://graph.facebook.com/${this.apiVersion}`;

  async getComments(
    config: SocialAccountConfig,
    since: Date | null,
  ): Promise<RawSocialComment[]> {
    const { accessToken, pageId } = config;

    if (!pageId) {
      this.logger.warn('FacebookClient: pageId missing in config — skipping');
      return [];
    }

    const sinceUnix = since ? Math.floor(since.getTime() / 1000) : undefined;
    const fields =
      'comments{id,message,from,created_time},created_time,permalink_url';
    const params = new URLSearchParams({
      fields,
      access_token: accessToken,
      limit: '100',
      ...(sinceUnix ? { since: String(sinceUnix) } : {}),
    });

    const url = `${this.baseUrl}/${pageId}/feed?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Facebook API error: ${response.status} ${body}`);
      return [];
    }

    const data = (await response.json()) as {
      data: Array<{
        permalink_url?: string;
        comments?: {
          data: Array<{
            id: string;
            message: string;
            from?: { name: string; id: string };
            created_time: string;
          }>;
        };
      }>;
    };

    const comments: RawSocialComment[] = [];

    for (const post of data.data ?? []) {
      for (const c of post.comments?.data ?? []) {
        comments.push({
          externalId: c.id,
          text: c.message,
          authorName: c.from?.name ?? 'Unknown',
          authorUsername: c.from?.id ?? null,
          authorEmail: null,
          publishedAt: new Date(c.created_time),
          postUrl: post.permalink_url ?? null,
          platform: SocialPlatform.FACEBOOK,
        });
      }
    }

    this.logger.debug(
      `Facebook: fetched ${comments.length} comments for page ${pageId}`,
    );

    return comments;
  }
}
