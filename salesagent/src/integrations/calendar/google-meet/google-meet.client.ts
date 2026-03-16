import { Injectable, Logger } from '@nestjs/common';
import { ICalendarAdapter, CalendarConfig, BookingOptions, TimeSlot } from '../../interfaces/calendar-adapter.interface';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/**
 * GoogleMeetClient — creates Google Calendar events with Google Meet links.
 *
 * Auth: OAuth 2.0 refresh token flow.
 * credentials stored: { clientId, clientSecret, refreshToken, calendarId? }
 *
 * createBookingLink: Creates a Calendar event with conferenceData (Meet link),
 *   adds the visitor as an attendee, returns the Google Meet join URL.
 * getAvailableSlots: Not implemented (returns empty — use Calendly/Cal.com for slot picking).
 */
@Injectable()
export class GoogleMeetClient implements ICalendarAdapter {
  private readonly logger = new Logger(GoogleMeetClient.name);

  async createBookingLink(config: CalendarConfig, options?: BookingOptions): Promise<string> {
    const accessToken = await this.getAccessToken(config);
    const calendarId = config.calendarId ?? 'primary';

    // Default: schedule 1 hour from now if no preferredDate provided
    const startDate = options?.preferredDate
      ? new Date(`${options.preferredDate}T09:00:00`)
      : new Date(Date.now() + 60 * 60 * 1000);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour

    const event: Record<string, unknown> = {
      summary: `Demo Meeting${options?.name ? ` with ${options.name}` : ''}`,
      description: 'GrowthSense AI Sales Partner — Demo Call',
      start: { dateTime: startDate.toISOString(), timeZone: 'UTC' },
      end: { dateTime: endDate.toISOString(), timeZone: 'UTC' },
      conferenceData: {
        createRequest: {
          requestId: `growthsense-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    if (options?.email) {
      event.attendees = [{ email: options.email, displayName: options.name ?? options.email }];
    }

    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      },
    );

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      this.logger.error(`Google Calendar API error ${response.status}: ${err.slice(0, 300)}`);
      throw new Error(`Google Calendar API error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json() as Record<string, any>;

    // Extract the Meet link from conferenceData
    const entryPoints: Array<{ entryPointType: string; uri: string }> =
      data.conferenceData?.entryPoints ?? [];
    const meetEntry = entryPoints.find((e) => e.entryPointType === 'video');
    const meetUrl = meetEntry?.uri ?? data.hangoutLink ?? data.htmlLink;

    this.logger.debug(`Google Meet event created: ${meetUrl}`);
    return meetUrl as string;
  }

  async getAvailableSlots(_config: CalendarConfig, _date: string): Promise<TimeSlot[]> {
    // Slot availability requires Google Calendar freebusy API — not needed for MVP.
    // The AI shares a Meet link; scheduling is agreed in conversation.
    return [];
  }

  // ─── OAuth helpers ──────────────────────────────────────────────────────────

  async testConnection(config: CalendarConfig): Promise<boolean> {
    try {
      const accessToken = await this.getAccessToken(config);
      const res = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList?maxResults=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async getAccessToken(config: CalendarConfig): Promise<string> {
    if (!config.clientId || !config.clientSecret || !config.refreshToken) {
      throw new Error('Google Meet: clientId, clientSecret, and refreshToken are required');
    }

    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    });

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Google OAuth token refresh failed: ${err.slice(0, 200)}`);
    }

    const data = await res.json() as { access_token: string };
    return data.access_token;
  }
}
