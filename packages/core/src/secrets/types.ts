/**
 * Type definitions for the encrypted secret store.
 */

/** Metadata about a stored secret — never contains the actual value. */
export interface SecretMetadata {
  name: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** Internal representation of a secret entry (value + metadata). */
export interface SecretEntry {
  value: string;
  createdAt: string;
  updatedAt: string;
}

/** Vault binary header parsed from the file. */
export interface VaultHeader {
  magic: string; // 'ARCV'
  version: number;
  salt: Buffer;
}

/** Options for creating a SecretStore instance. */
export interface SecretStoreOptions {
  /** Callback to obtain the master password (e.g. interactive prompt). */
  getPassword: () => Promise<string>;
  /** Optional ARC profile name for audit context. */
  profile?: string;
  /** Override vault file path (default: getArcDir()/secrets/vault.enc). */
  vaultPath?: string;
}
