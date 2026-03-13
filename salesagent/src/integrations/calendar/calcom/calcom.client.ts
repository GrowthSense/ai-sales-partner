import { Injectable, Logger } from '@nestjs/common';
import { ICalendarAdapter, CalendarConfig, BookingOptions, TimeSlot } from '../../interfaces/calendar-adapter.interface';

const BASE_URL = 'https://api.cal.com/v1';

/**
 * CalcomClient — implements ICalendarAdapter using Cal.com API v1.
 *
 * Auth: API key via query param `apiKey`.
 * config.apiKey — Cal.com API key
 * config.eventTypeId — numeric event type ID
 *
 * Booking links are generated without a server round-trip (direct URL).
 * Available slots use GET /slots.
 */
@Injectable()
export class CalcomClient implements ICalendarAdapter {
  private readonly logger = new Logger(CalcomClient.name);

  async createBookingLink(config: CalendarConfig, options?: BookingOptions): Promise<string> {
    // Cal.com booking URLs: https://cal.com/<username>/<event-slug>
    const username = config.username ?? 'team';
    const eventSlug = config.eventTypeId ?? 'demo';

    const baseUrl = `https://cal.com/${encodeURIComponent(username)}/${encodeURIComponent(eventSlug)}`;

    const params = new URLSearchParams();
    if (options?.name) params.set('name', options.name);
    if (options?.email) params.set('email', options.email);
    if (options?.preferredDate) params.set('date', options.preferredDate);

    return params.size > 0 ? `${baseUrl}?${params.toString()}` : baseUrl;
  }

  async getAvailableSlots(config: CalendarConfig, date: string): Promise<TimeSlot[]> {
    if (!config.eventTypeId) return [];

    const response = await this.request(
      'GET',
      `/slots?eventTypeId=${encodeURIComponent(config.eventTypeId)}&startTime=${date}T00:00:00Z&endTime=${date}T23:59:59Z`,
      config,
    );

    const slots = response.slots as Record<string, Array<{ time: string }>> ?? {};

    return Object.values(slots)
      .flat()
      .map((slot) => ({
        startTime: slot.time,
        endTime: this.addMinutes(slot.time, 30),
        available: true,
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
    const separator = path.includes('?') ? '&' : '?';
    const url = `${BASE_URL}${path}${separator}apiKey=${encodeURIComponent(config.apiKey)}`;

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      this.logger.error(`Cal.com ${method} ${path} → ${response.status}: ${err.slice(0, 300)}`);
      throw new Error(`Cal.com API error ${response.status}: ${err.slice(0, 200)}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }
}
