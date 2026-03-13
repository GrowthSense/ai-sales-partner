// Returned by public GET /tenants/:id/widget-config
// Consumed by the visitor JS embed at page load
export interface WidgetConfig {
  tenantId: string;
  agentName: string;
  primaryColor: string;
  logoUrl: string;
  greetingMessage: string;
  widgetKey: string;
}
