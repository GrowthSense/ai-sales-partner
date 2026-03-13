import { IsUUID, IsOptional } from 'class-validator';

export class WidgetSessionDto {
  @IsUUID()
  widgetKey: string;

  /**
   * Optional: pass an existing visitorId to resume a prior session.
   * If omitted, a new anonymous UUID is generated.
   */
  @IsOptional()
  @IsUUID()
  visitorId?: string;
}

export class WidgetSessionResponseDto {
  /** JWT signed with JWT_WIDGET_SECRET — attach to WS handshake */
  visitorToken: string;
  visitorId: string;
  tenantId: string;
  /** Widget token TTL in seconds */
  expiresIn: number;
}
