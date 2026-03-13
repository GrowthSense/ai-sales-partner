import { Injectable, Logger } from '@nestjs/common';
import { SocialPlatform } from '../../common/enums';
import {
  ISocialAdapter,
  RawSocialComment,
  SocialAccountConfig,
} from '../interfaces/social-adapter.interface';

/**
 * InstagramClient
 *
 * Uses the Instagram Graph API (same Graph API endpoint as Facebook)
 * to fetch comments on a Business/Creator account's media.
 *
 * Endpoint: GET /{ig-user-id}/media?fields=comments{...}&since=<unix>
 * Requires: instagram_basic, instagram_manage_comments permissions.
 */
@Injectable()
export class InstagramClient implements ISocialAdapter {
  readonly platform = SocialPlatform.INSTAGRAM;

  private readonly logger = new Logger(InstagramClient.name);
  private readonly apiVersion = 'v19.0';
  private readonly baseUrl = `https://graph.facebook.com/${this.apiVersion}`;

  async getComments(
    config: SocialAccountConfig,
    since: Date | null,
  ): Promise<RawSocialComment[]> {
    const { accessToken, pageId } = config;

    if (!pageId) {
      this.logger.warn('InstagramClient: pageId (IG user ID) missing — skipping');
      return [];
    }

    const sinceUnix = since ? Math.floor(since.getTime() / 1000) : undefined;
    const params = new URLSearchParams({
      fields: 'id,media_url,permalink,comments{id,text,username,timestamp}',
      access_token: accessToken,
      limit: '50',
      ...(sinceUnix ? { since: String(sinceUnix) } : {}),
    });

    const url = `${this.baseUrl}/${pageId}/media?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Instagram API error: ${response.status} ${body}`);
      return [];
    }

    const data = (await response.json()) as {
      data: Array<{
        permalink?: string;
        comments?: {
          data: Array<{
            id: string;
            text: string;
            username?: string;
            timestamp: string;
          }>;
        };
      }>;
    };

    const comments: RawSocialComment[] = [];

    for (const media of data.data ?? []) {
      for (const c of media.comments?.data ?? []) {
        comments.push({
          externalId: c.id,
          text: c.text,
          authorName: c.username ?? 'Unknown',
          authorUsername: c.username ?? null,
          authorEmail: null,
          publishedAt: new Date(c.timestamp),
          postUrl: media.permalink ?? null,
          platform: SocialPlatform.INSTAGRAM,
        });
      }
    }

    this.logger.debug(
      `Instagram: fetched ${comments.length} comments for user ${pageId}`,
    );

    return comments;
  }
}
