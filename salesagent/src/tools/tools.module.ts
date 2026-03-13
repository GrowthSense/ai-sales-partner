import { Module } from '@nestjs/common';
import { ToolRegistryService } from './services/tool-registry.service';
import { ToolExecutorService } from './services/tool-executor.service';

/**
 * ToolsModule
 *
 * Provides the tool registry and executor used across the platform.
 * Tools are internal-only — not exposed via REST and not LLM-visible.
 *
 * Integration adapters (HubSpot, Calendly, etc.) are wired in
 * IntegrationsModule, which imports ToolsModule and registers tools
 * with ToolRegistryService.
 */
@Module({
  providers: [ToolRegistryService, ToolExecutorService],
  exports: [ToolRegistryService, ToolExecutorService],
})
export class ToolsModule {}
