import { Injectable, Logger } from '@nestjs/common';
import { ICalendarAdapter, CalendarConfig, BookingOptions, TimeSlot } from '../../interfaces/calendar-adapter.interface';

const MS_TOKEN_URL = 'https://login.microsoftonline.com';
const MS_GRAPH_API = 'https://graph.microsoft.com/v1.0';

/**
 * MicrosoftTeamsClient — creates Microsoft Teams online meetings via Microsoft Graph API.
 *
 * Auth: OAuth 2.0 client credentials flow (app-only, no user sign-in required).
 *   Requires an Azure AD app registration with OnlineMeetings.ReadWrite.All (application permission).
 *
 * credentials stored: { apiKey (clientSecret), clientId, tenantId, organizerEmail }
 *
 * createBookingLink: Creates an online meeting → returns joinWebUrl (Teams meeting link).
 * getAvailableSlots: Not implemented (returns empty — scheduling agreed in conversation).
 */
@Injectable()
export class MicrosoftTeamsClient implements ICalendarAdapter {
  private readonly logger = new Logger(MicrosoftTeamsClient.name);

  async createBookingLink(config: CalendarConfig, options?: BookingOptions): Promise<string> {
    const accessToken = await this.getAccessToken(config);
    const organizerEmail = config.organizerEmail;
    if (!organizerEmail) throw new Error('Microsoft Teams: organizerEmail is required');

    // Default: 1 hour from now, or on preferredDate at 09:00
    const startDate = options?.preferredDate
      ? new Date(`${options.preferredDate}T09:00:00`)
      : new Date(Date.now() + 60 * 60 * 1000);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

    const meeting: Record<string, unknown> = {
      subject: `Demo Meeting${options?.name ? ` with ${options.name}` : ''}`,
      startDateTime: startDate.toISOString(),
      endDateTime: endDate.toISOString(),
    };

    // Create the online meeting on behalf of the organizer
    const response = await fetch(
      `${MS_GRAPH_API}/users/${encodeURIComponent(organizerEmail)}/onlineMeetings`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(meeting),
      },
    );

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      this.logger.error(`Microsoft Graph API error ${response.status}: ${err.slice(0, 300)}`);
      throw new Error(`Microsoft Graph API error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json() as Record<string, any>;
    const joinUrl: string = data.joinWebUrl ?? data.joinUrl;

    this.logger.debug(`Teams meeting created: ${joinUrl}`);
    return joinUrl;
  }

  async getAvailableSlots(_config: CalendarConfig, _date: string): Promise<TimeSlot[]> {
    return [];
  }

  // ─── Connection test ────────────────────────────────────────────────────────

  async testConnection(config: CalendarConfig): Promise<boolean> {
    try {
      const accessToken = await this.getAccessToken(config);
      // Verify we can reach Graph API with this token
      const res = await fetch(`${MS_GRAPH_API}/organization?$select=id&$top=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ─── OAuth client credentials ───────────────────────────────────────────────

  private async getAccessToken(config: CalendarConfig): Promise<string> {
    const tenantId = config.tenantId;
    const clientId = config.clientId;
    const clientSecret = config.apiKey; // stored as apiKey (the credential secret)

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error('Microsoft Teams: tenantId, clientId, and clientSecret are required');
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const res = await fetch(`${MS_TOKEN_URL}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Microsoft Teams token request failed: ${err.slice(0, 200)}`);
    }

    const data = await res.json() as { access_token: string };
    return data.access_token;
  }
}
