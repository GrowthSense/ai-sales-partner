import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;      // 96-bit IV recommended for GCM
const AUTH_TAG_BYTES = 16;

export interface EncryptedPayload {
  encryptedData: string; // hex
  iv: string;            // hex
  authTag: string;       // hex
}

/**
 * EncryptionService — AES-256-GCM symmetric encryption.
 *
 * Used for:
 *  - TenantIntegration.credentials (CRM API keys, OAuth tokens)
 *  - MCPProvider.authConfig (MCP server bearer tokens)
 *
 * Key: ENCRYPTION_KEY env var — must be exactly 32 bytes (64 hex chars).
 * Each encrypt() call generates a fresh random IV so ciphertexts are unique
 * even for identical plaintexts.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    const keyHex = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    if (keyHex.length !== 64) {
      throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    this.key = Buffer.from(keyHex, 'hex');
  }

  encrypt(plaintext: string): EncryptedPayload {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return {
      encryptedData: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      authTag: cipher.getAuthTag().toString('hex'),
    };
  }

  decrypt(payload: EncryptedPayload): string {
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(payload.iv, 'hex'),
    );

    decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));

    return (
      decipher.update(payload.encryptedData, 'hex', 'utf8') +
      decipher.final('utf8')
    );
  }

  /** Encrypt a JSON-serialisable object. */
  encryptJson(data: Record<string, unknown>): EncryptedPayload {
    return this.encrypt(JSON.stringify(data));
  }

  /** Decrypt to a typed object. Throws if decryption fails (tampered data). */
  decryptJson<T = Record<string, unknown>>(payload: EncryptedPayload): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }
}
