import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db.js";

export interface AuthFile {
  /** Root shared secret for locally-issued clients (legacy / bootstrap). */
  rootToken: string;
  /** Version of the auth file format. */
  v: 1;
}

/**
 * Ensure `auth.json` exists. Returns the parsed file.
 * Creates a fresh root token on first run.
 */
export function ensureAuthFile(authPath: string): AuthFile {
  try {
    const raw = fs.readFileSync(authPath, "utf8");
    const parsed = JSON.parse(raw) as AuthFile;
    if (parsed.v === 1 && typeof parsed.rootToken === "string") return parsed;
  } catch {
    // fall through and create
  }
  const fresh: AuthFile = { v: 1, rootToken: crypto.randomBytes(32).toString("hex") };
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.writeFileSync(authPath, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  return fresh;
}

export interface PairResult {
  clientId: string;
  token: string;
}

export function pairClient(db: DB, label: string | null): PairResult {
  const token = crypto.randomBytes(32).toString("hex");
  const clientId = crypto.randomUUID();
  const tokenHash = hashToken(token);
  db.prepare(
    "INSERT INTO clients (id, label, token_hash, paired_at, source) VALUES (?, ?, ?, ?, ?)",
  ).run(clientId, label, tokenHash, Date.now(), "local");
  return { clientId, token };
}

export function verifyToken(
  db: DB,
  rootToken: string,
  presented: string,
): { clientId: string; label: string | null } | null {
  if (timingSafeEquals(presented, rootToken)) {
    return { clientId: "root", label: "root" };
  }
  const hash = hashToken(presented);
  const row = db
    .prepare("SELECT id, label FROM clients WHERE token_hash = ?")
    .get(hash) as { id: string; label: string | null } | undefined;
  if (!row) return null;
  db.prepare("UPDATE clients SET last_seen = ? WHERE id = ?").run(Date.now(), row.id);
  return { clientId: row.id, label: row.label };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function timingSafeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
