import { Injectable, Logger } from '@nestjs/common';
import { ICalendarAdapter, CalendarConfig, BookingOptions, TimeSlot } from '../../interfaces/calendar-adapter.interface';

const BASE_URL = 'https://api.calendly.com';

/**
 * CalendlyClient — implements ICalendarAdapter using Calendly v2 API.
 *
 * Auth: Personal Access Token (Bearer).
 * config.apiKey — personal access token
 * config.username — Calendly username slug (e.g. "acme-sales")
 * config.eventTypeId — UUID of the event type (e.g. "30min-demo")
 *
 * createBookingLink returns a scheduling URL with pre-filled visitor info.
 * getAvailableSlots uses GET /event_type_available_times.
 */
@Injectable()
export class CalendlyClient implements ICalendarAdapter {
  private readonly logger = new Logger(CalendlyClient.name);

  async createBookingLink(config: CalendarConfig, options?: BookingOptions): Promise<string> {
    // Calendly scheduling links embed visitor info as query params
    const username = config.username ?? 'me';
    const eventSlug = config.eventTypeId ?? 'demo';

    const baseUrl = `https://calendly.com/${encodeURIComponent(username)}/${encodeURIComponent(eventSlug)}`;

    const params = new URLSearchParams();
    if (options?.name) params.set('name', options.name);
    if (options?.email) params.set('email', options.email);
    if (options?.preferredDate) params.set('month', options.preferredDate.slice(0, 7));

    return params.size > 0 ? `${baseUrl}?${params.toString()}` : baseUrl;
  }

  async getAvailableSlots(config: CalendarConfig, date: string): Promise<TimeSlot[]> {
    if (!config.eventTypeId) return [];

    // Resolve event type URI from the eventTypeId
    const eventTypeUri = `${BASE_URL}/event_types/${encodeURIComponent(config.eventTypeId)}`;

    const startTime = `${date}T00:00:00.000000Z`;
    const endTime = `${date}T23:59:59.000000Z`;

    const response = await this.request(
      'GET',
      `/event_type_available_times?event_type=${encodeURIComponent(eventTypeUri)}&start_time=${startTime}&end_time=${endTime}`,
      config,
    );

    const collection = response.collection as Array<{
      start_time: string;
      invitees_remaining: number;
    }> ?? [];

    return collection.map((slot) => ({
      startTime: slot.start_time,
      endTime: this.addMinutes(slot.start_time, 30), // default 30-min slots
      available: slot.invitees_remaining > 0,
    }));
  }

  private addMinutes(isoTime: string, minutes: number): string {
    const d = new Date(isoTime);
    d.setMinutes(d.getMinutes() + minutes);
    return d.toISOString();
  }

  private async request(
    method: string,
    path: string,
    config: CalendarConfig,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      this.logger.error(`Calendly ${method} ${path} → ${response.status}: ${err.slice(0, 300)}`);
      throw new Error(`Calendly API error ${response.status}: ${err.slice(0, 200)}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }
}
