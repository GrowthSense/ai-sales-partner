import { Injectable, Logger } from '@nestjs/common';
import { ICalendarAdapter, CalendarConfig, BookingOptions, TimeSlot } from '../../interfaces/calendar-adapter.interface';

/**
 * MockCalendarClient — no-op calendar adapter for development and testing.
 *
 * Returns a fake booking URL and synthetic available slots without any
 * HTTP calls. Used when no real calendar integration is configured.
 */
@Injectable()
export class MockCalendarClient implements ICalendarAdapter {
  private readonly logger = new Logger(MockCalendarClient.name);

  async createBookingLink(_config: CalendarConfig, options?: BookingOptions): Promise<string> {
    const params = new URLSearchParams();
    if (options?.name) params.set('name', options.name);
    if (options?.email) params.set('email', options.email);

    const link = `https://demo.salesagent.dev/book/demo?${params.toString()}`;
    this.logger.debug(`[mock-calendar] createBookingLink: ${link}`);
    return link;
  }

  async getAvailableSlots(_config: CalendarConfig, date: string): Promise<TimeSlot[]> {
    // Return 3 mock slots during business hours
    const slots: TimeSlot[] = ['10:00', '14:00', '16:00'].map((time) => ({
      startTime: `${date}T${time}:00.000Z`,
      endTime: `${date}T${time.replace(/(\d+):/, (_, h) => `${parseInt(h) + 1}:`)}:00.000Z`,
      available: true,
    }));
    this.logger.debug(`[mock-calendar] getAvailableSlots: ${date} → ${slots.length} slots`);
    return slots;
  }
}
