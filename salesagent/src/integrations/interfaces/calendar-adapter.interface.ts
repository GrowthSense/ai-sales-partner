export interface ICalendarAdapter {
  createBookingLink(config: CalendarConfig, options?: BookingOptions): Promise<string>;
  getAvailableSlots(config: CalendarConfig, date: string): Promise<TimeSlot[]>;
}

export interface CalendarConfig {
  provider: 'calendly' | 'calcom';
  apiKey: string;
  eventTypeId?: string;
  username?: string;
}

export interface BookingOptions {
  name?: string;
  email?: string;
  preferredDate?: string;
}

export interface TimeSlot {
  startTime: string;
  endTime: string;
  available: boolean;
}
