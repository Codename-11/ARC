/**
 * Argon2id KDF wrapper for deriving encryption keys from passwords.
 *
 * Primary: Node v24 native crypto.argon2 (callback-based).
 * Fallback: `argon2` npm package (optional dependency).
 * If neither is available, throws at key derivation time.
 */
import crypto from "node:crypto";

// ─── Feature detection ───────────────────────────────────────────────

const hasNativeArgon2 = typeof (crypto as any).argon2 === "function";

let argon2Npm: any = null;
let argon2NpmChecked = false;

async function loadArgon2Npm(): Promise<any> {
  if (argon2NpmChecked) return argon2Npm;
  argon2NpmChecked = true;
  try {
    // Dynamic import — argon2 is an optional dependency, may not be installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    argon2Npm = await import(/* webpackIgnore: true */ "argon2" as string);
    return argon2Npm;
  } catch {
    argon2Npm = null;
    return null;
  }
}

// ─── KDF Parameters ──────────────────────────────────────────────────

const KDF_MEMORY = 65536; // 64 MiB
const KDF_PASSES = 3;
const KDF_PARALLELISM = 1;
const KDF_TAG_LENGTH = 32; // 256-bit key

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Derive a 32-byte encryption key from a password and salt using Argon2id.
 *
 * @param password  Master password (plaintext string).
 * @param salt      16-byte random salt (unique per vault).
 * @returns         32-byte derived key as a Buffer.
 */
export async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  const message = Buffer.from(password, "utf-8");

  // ── Native Node v24 crypto.argon2 (preferred) ──
  // In Node v24's API, `nonce` maps to Argon2's salt parameter.
  // The `salt` parameter maps to associated data. We pass our vault
  // salt as `nonce` so the KDF output actually varies with the salt.
  if (hasNativeArgon2) {
    // The API requires nonce to be at least 16 bytes; pad salt if needed.
    const nonce = salt.length >= 16 ? salt : Buffer.concat([salt, Buffer.alloc(16 - salt.length)]);
    return new Promise<Buffer>((resolve, reject) => {
      (crypto as any).argon2(
        "argon2id",
        {
          message,
          salt: Buffer.alloc(16), // associated data (not the primary salt)
          nonce,
          memory: KDF_MEMORY,
          passes: KDF_PASSES,
          parallelism: KDF_PARALLELISM,
          tagLength: KDF_TAG_LENGTH,
        },
        (err: Error | null, result: Buffer) => {
          if (err) reject(err);
          else resolve(result);
        },
      );
    });
  }

  // ── npm argon2 fallback ──
  const mod = await loadArgon2Npm();
  if (mod) {
    // argon2 npm returns a hash string by default; use raw hash
    const hash: Buffer = await mod.hash(message, {
      type: 2, // argon2id
      salt,
      memoryCost: KDF_MEMORY,
      timeCost: KDF_PASSES,
      parallelism: KDF_PARALLELISM,
      hashLength: KDF_TAG_LENGTH,
      raw: true,
    });
    return hash;
  }

  throw new Error(
    "Argon2id is not available: neither Node native crypto.argon2 nor the 'argon2' npm package could be loaded.",
  );
}

/**
 * Generate a cryptographically random 16-byte salt for vault creation.
 */
export function generateSalt(): Buffer {
  return crypto.randomBytes(16);
}
