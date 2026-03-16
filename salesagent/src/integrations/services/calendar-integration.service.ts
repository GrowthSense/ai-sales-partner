import { Injectable, Logger } from '@nestjs/common';
import { IntegrationConfigService } from './integration-config.service';
import { CalendlyClient } from '../calendar/calendly/calendly.client';
import { CalcomClient } from '../calendar/calcom/calcom.client';
import { GoogleMeetClient } from '../calendar/google-meet/google-meet.client';
import { MicrosoftTeamsClient } from '../calendar/microsoft-teams/microsoft-teams.client';
import { MockCalendarClient } from '../calendar/mock/mock-calendar.client';
import { ICalendarAdapter, CalendarConfig, BookingOptions, TimeSlot } from '../interfaces/calendar-adapter.interface';
import { IntegrationType } from '../../common/enums';

/**
 * CalendarIntegrationService — facade over Calendly and Cal.com adapters.
 *
 * Resolves the active calendar provider from tenant integration config.
 * Skills call via SkillContext.services.invokeIntegration('calendar', 'getBookingLink', args).
 */
@Injectable()
export class CalendarIntegrationService {
  private readonly logger = new Logger(CalendarIntegrationService.name);

  constructor(
    private readonly configService: IntegrationConfigService,
    private readonly calendly: CalendlyClient,
    private readonly calcom: CalcomClient,
    private readonly googleMeet: GoogleMeetClient,
    private readonly microsoftTeams: MicrosoftTeamsClient,
    private readonly mockCalendar: MockCalendarClient,
  ) {}

  async getBookingLink(
    tenantId: string,
    options?: BookingOptions,
  ): Promise<string> {
    const provider = await this.resolveProvider(tenantId);
    const link = await provider.adapter.createBookingLink(provider.config, options);

    this.logger.debug(`Booking link generated: tenantId=${tenantId} provider=${provider.name}`);
    return link;
  }

  async getAvailableSlots(tenantId: string, date: string): Promise<TimeSlot[]> {
    const provider = await this.resolveProvider(tenantId);
    return provider.adapter.getAvailableSlots(provider.config, date);
  }

  // ─── Provider resolution ──────────────────────────────────────────────────

  private async resolveProvider(tenantId: string): Promise<{
    name: string;
    adapter: ICalendarAdapter;
    config: CalendarConfig;
  }> {
    const hasCalendly = await this.configService.isConnected(tenantId, IntegrationType.CALENDAR_CALENDLY);
    if (hasCalendly) {
      const { record, credentials } = await this.configService.getConfigAndCredentials(
        tenantId,
        IntegrationType.CALENDAR_CALENDLY,
      );
      return {
        name: 'calendly',
        adapter: this.calendly,
        config: {
          provider: 'calendly',
          apiKey: credentials.apiKey,
          eventTypeId: record.config['eventTypeId'] as string | undefined,
          username: record.config['username'] as string | undefined,
        },
      };
    }

    const hasCalcom = await this.configService.isConnected(tenantId, IntegrationType.CALENDAR_CALCOM);
    if (hasCalcom) {
      const { record, credentials } = await this.configService.getConfigAndCredentials(
        tenantId,
        IntegrationType.CALENDAR_CALCOM,
      );
      return {
        name: 'calcom',
        adapter: this.calcom,
        config: {
          provider: 'calcom',
          apiKey: credentials.apiKey,
          eventTypeId: record.config['eventTypeId'] as string | undefined,
          username: record.config['username'] as string | undefined,
        },
      };
    }

    const hasGoogleMeet = await this.configService.isConnected(tenantId, IntegrationType.CALENDAR_GOOGLE_MEET);
    if (hasGoogleMeet) {
      const { record, credentials } = await this.configService.getConfigAndCredentials(
        tenantId,
        IntegrationType.CALENDAR_GOOGLE_MEET,
      );
      return {
        name: 'google_meet',
        adapter: this.googleMeet,
        config: {
          provider: 'google_meet',
          apiKey: credentials.refreshToken as string,
          clientId: credentials.clientId as string,
          clientSecret: credentials.clientSecret as string,
          refreshToken: credentials.refreshToken as string,
          calendarId: record.config['calendarId'] as string | undefined,
        },
      };
    }

    const hasTeams = await this.configService.isConnected(tenantId, IntegrationType.CALENDAR_MICROSOFT_TEAMS);
    if (hasTeams) {
      const { record, credentials } = await this.configService.getConfigAndCredentials(
        tenantId,
        IntegrationType.CALENDAR_MICROSOFT_TEAMS,
      );
      return {
        name: 'microsoft_teams',
        adapter: this.microsoftTeams,
        config: {
          provider: 'microsoft_teams',
          apiKey: credentials.clientSecret as string,
          clientId: credentials.clientId as string,
          tenantId: credentials.tenantId as string,
          organizerEmail: record.config['organizerEmail'] as string | undefined,
        },
      };
    }

    this.logger.warn(`No calendar integration connected for tenant ${tenantId} — using mock`);
    return {
      name: 'mock',
      adapter: this.mockCalendar,
      config: { provider: 'calendly', apiKey: 'mock' },
    };
  }
}
