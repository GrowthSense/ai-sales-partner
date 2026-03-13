import { Injectable, Logger } from '@nestjs/common';
import { SocialPlatform } from '../../common/enums';
import {
  ISocialAdapter,
  RawSocialComment,
  SocialAccountConfig,
} from '../interfaces/social-adapter.interface';

/**
 * LinkedInClient
 *
 * Uses the LinkedIn Community Management API to fetch comments on
 * organisation posts.
 *
 * Endpoint: GET /rest/socialActions/{ugcPostUrn}/comments
 * Requires: r_organization_social, w_organization_social OAuth 2.0 scopes.
 *
 * We first list recent posts (GET /rest/posts?author=urn:li:organization:*)
 * then fetch their comments. LinkedIn uses cursor pagination (start/count).
 */
@Injectable()
export class LinkedInClient implements ISocialAdapter {
  readonly platform = SocialPlatform.LINKEDIN;

  private readonly logger = new Logger(LinkedInClient.name);
  private readonly baseUrl = 'https://api.linkedin.com/rest';

  async getComments(
    config: SocialAccountConfig,
    since: Date | null,
  ): Promise<RawSocialComment[]> {
    const { accessToken, organizationUrn } = config;

    if (!organizationUrn) {
      this.logger.warn('LinkedInClient: organizationUrn missing — skipping');
      return [];
    }

    const posts = await this.fetchRecentPosts(accessToken, organizationUrn, since);
    const allComments: RawSocialComment[] = [];

    for (const post of posts) {
      const comments = await this.fetchCommentsForPost(accessToken, post.urn, post.url);
      allComments.push(...comments);
    }

    this.logger.debug(
      `LinkedIn: fetched ${allComments.length} comments for org ${organizationUrn}`,
    );

    return allComments;
  }

  private async fetchRecentPosts(
    accessToken: string,
    organizationUrn: string,
    since: Date | null,
  ): Promise<Array<{ urn: string; url: string }>> {
    const params = new URLSearchParams({
      author: organizationUrn,
      count: '20',
      sortBy: 'LAST_MODIFIED',
    });

    const response = await fetch(`${this.baseUrl}/posts?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': '202401',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`LinkedIn posts API error: ${response.status} ${body}`);
      return [];
    }

    const data = (await response.json()) as {
      elements?: Array<{
        id: string;
        lastModifiedAt?: number;
      }>;
    };

    return (data.elements ?? [])
      .filter((p) => {
        if (!since || !p.lastModifiedAt) return true;
        return new Date(p.lastModifiedAt) > since;
      })
      .map((p) => ({
        urn: p.id,
        url: `https://www.linkedin.com/feed/update/${p.id}`,
      }));
  }

  private async fetchCommentsForPost(
    accessToken: string,
    postUrn: string,
    postUrl: string,
  ): Promise<RawSocialComment[]> {
    const encodedUrn = encodeURIComponent(postUrn);
    const response = await fetch(
      `${this.baseUrl}/socialActions/${encodedUrn}/comments?count=50`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'LinkedIn-Version': '202401',
        },
      },
    );

    if (!response.ok) {
      this.logger.warn(
        `LinkedIn comments API error for post ${postUrn}: ${response.status}`,
      );
      return [];
    }

    const data = (await response.json()) as {
      elements?: Array<{
        id: string;
        message?: { text: string };
        actor?: string;
        created?: { time: number };
        commenter?: { com$actor?: string };
      }>;
    };

    return (data.elements ?? []).map((c) => ({
      externalId: c.id,
      text: c.message?.text ?? '',
      authorName: c.actor ?? 'LinkedIn User',
      authorUsername: null,
      authorEmail: null,
      publishedAt: c.created?.time ? new Date(c.created.time) : new Date(),
      postUrl,
      platform: SocialPlatform.LINKEDIN,
    }));
  }
}
