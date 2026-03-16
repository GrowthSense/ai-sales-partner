export interface ICalendarAdapter {
  createBookingLink(config: CalendarConfig, options?: BookingOptions): Promise<string>;
  getAvailableSlots(config: CalendarConfig, date: string): Promise<TimeSlot[]>;
}

export interface CalendarConfig {
  provider: 'calendly' | 'calcom' | 'google_meet' | 'microsoft_teams';
  apiKey: string;
  eventTypeId?: string;
  username?: string;
  // Google Meet
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  calendarId?: string;
  // Microsoft Teams
  tenantId?: string;
  organizerEmail?: string;
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
