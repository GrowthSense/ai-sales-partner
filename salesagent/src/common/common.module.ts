import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EncryptionService } from './services/encryption.service';

/**
 * CommonModule
 *
 * Provides shared infrastructure services used across multiple modules.
 * Import this module (not re-exporting individual services) to keep
 * the dependency graph clean.
 *
 * Provides:
 *   EncryptionService — AES-256-GCM for credential storage
 */
@Module({
  imports: [ConfigModule],
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CommonModule {}
