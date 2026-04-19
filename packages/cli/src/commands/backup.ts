import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { getArcDir, getConfigPath } from "../paths.js";
import { success, error, info, warn } from "../display.js";

/**
 * Custom archive format (gzipped):
 *
 *   MAGIC = "ARCBAK01"            (8 bytes, fixed)
 *   repeat per entry:
 *     pathLen      (4 bytes, big-endian uint32)
 *     path         (pathLen bytes, UTF-8, POSIX-style relative path)
 *     sizeLen      (8 bytes, big-endian uint64; actually stored as BigInt)
 *     contents     (sizeLen bytes, raw file bytes)
 *
 * Plain files only. Directories are implicit (recreated from paths during restore).
 * Symlinks are skipped (reported as a warning).
 *
 * The whole blob is gzipped before being written to disk.
 */

const MAGIC = Buffer.from("ARCBAK01", "utf-8");

interface ArchiveEntry {
  relPath: string;
  contents: Buffer;
}

interface WalkOptions {
  root: string;
  skipDirs: Set<string>;
}

function walkFiles(opts: WalkOptions): string[] {
  const results: string[] = [];

  function recurse(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (opts.skipDirs.has(path.resolve(full))) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        // Skip symlinks to avoid escaping the archive root.
        continue;
      }

      if (entry.isDirectory()) {
        recurse(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
      // Skip sockets, fifos, block/char devices.
    }
  }

  recurse(opts.root);
  return results;
}

function toPosixRelative(base: string, full: string): string {
  const rel = path.relative(base, full);
  return rel.split(path.sep).join("/");
}

function writeUint32BE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value >>> 0, 0);
  return buf;
}

function writeBigUint64BE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(value, 0);
  return buf;
}

function encodeArchive(entries: ArchiveEntry[]): Buffer {
  const chunks: Buffer[] = [MAGIC];
  for (const entry of entries) {
    const pathBuf = Buffer.from(entry.relPath, "utf-8");
    chunks.push(writeUint32BE(pathBuf.length));
    chunks.push(pathBuf);
    chunks.push(writeBigUint64BE(BigInt(entry.contents.length)));
    chunks.push(entry.contents);
  }
  return Buffer.concat(chunks);
}

function decodeArchive(buf: Buffer): ArchiveEntry[] {
  if (buf.length < MAGIC.length || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Invalid archive: missing or wrong magic header (expected ARCBAK01).");
  }
  const entries: ArchiveEntry[] = [];
  let offset = MAGIC.length;

  while (offset < buf.length) {
    if (offset + 4 > buf.length) {
      throw new Error("Corrupt archive: truncated path length header.");
    }
    const pathLen = buf.readUInt32BE(offset);
    offset += 4;

    if (offset + pathLen > buf.length) {
      throw new Error("Corrupt archive: truncated path data.");
    }
    const relPath = buf.subarray(offset, offset + pathLen).toString("utf-8");
    offset += pathLen;

    if (offset + 8 > buf.length) {
      throw new Error("Corrupt archive: truncated size header.");
    }
    const sizeBig = buf.readBigUInt64BE(offset);
    offset += 8;

    if (sizeBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Corrupt archive: entry "${relPath}" declares impossibly large size.`);
    }
    const size = Number(sizeBig);

    if (offset + size > buf.length) {
      throw new Error(`Corrupt archive: truncated contents for "${relPath}".`);
    }
    const contents = Buffer.from(buf.subarray(offset, offset + size));
    offset += size;

    entries.push({ relPath, contents });
  }

  return entries;
}

function isoTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function handleBackupCreate(opts: {
  out?: string;
  excludeCredentials?: boolean;
}): Promise<void> {
  const arcDir = getArcDir();

  if (!fs.existsSync(arcDir)) {
    error(`ARC directory not found at ${arcDir}. Nothing to back up.`);
    process.exit(1);
  }

  const backupsDir = path.join(arcDir, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });

  const outPath =
    opts.out !== undefined
      ? path.resolve(opts.out)
      : path.join(backupsDir, `arc-backup-${isoTimestamp()}.tar.gz`);

  // Ensure output parent exists.
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const skipDirs = new Set<string>();
  // Never recurse into the backups directory (don't archive our own output).
  skipDirs.add(path.resolve(backupsDir));
  // By default exclude credentials (hot-swap snapshots are sensitive).
  const excludeCreds = opts.excludeCredentials !== false;
  if (excludeCreds) {
    skipDirs.add(path.resolve(path.join(arcDir, "credentials")));
  }

  const files = walkFiles({ root: arcDir, skipDirs });

  if (files.length === 0) {
    warn("No files to archive (ARC directory is effectively empty).");
  }

  const entries: ArchiveEntry[] = [];
  for (const full of files) {
    let contents: Buffer;
    try {
      contents = fs.readFileSync(full);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warn(`Skipping unreadable file "${full}": ${msg}`);
      continue;
    }
    entries.push({ relPath: toPosixRelative(arcDir, full), contents });
  }

  const raw = encodeArchive(entries);
  const gz = zlib.gzipSync(raw, { level: zlib.constants.Z_BEST_COMPRESSION });

  try {
    fs.writeFileSync(outPath, gz);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed to write archive to "${outPath}": ${msg}`);
    process.exit(1);
  }

  success(`Backup written: ${outPath}`);
  info(
    `Archived ${entries.length} file(s), ${formatSize(raw.length)} uncompressed, ${formatSize(gz.length)} compressed.`,
  );
  if (excludeCreds) {
    info("Note: ~/.arc/credentials/ was excluded. Pass --include-credentials to change (not yet exposed).");
  }
}

export async function handleBackupRestore(
  file: string,
  opts: { force?: boolean },
): Promise<void> {
  const archivePath = path.resolve(file);
  if (!fs.existsSync(archivePath)) {
    error(`Archive file not found: ${archivePath}`);
    process.exit(1);
  }

  const arcDir = getArcDir();
  const configPath = getConfigPath();

  if (fs.existsSync(configPath) && !opts.force) {
    warn(`Existing ARC config detected at ${configPath}.`);
    warn("Restore is destructive — it overwrites files in-place.");
    error("Refusing to continue without --force.");
    process.exit(1);
  }

  let gz: Buffer;
  try {
    gz = fs.readFileSync(archivePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed to read archive: ${msg}`);
    process.exit(1);
  }

  let raw: Buffer;
  try {
    raw = zlib.gunzipSync(gz);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed to gunzip archive: ${msg}`);
    process.exit(1);
  }

  let entries: ArchiveEntry[];
  try {
    entries = decodeArchive(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(msg);
    process.exit(1);
  }

  fs.mkdirSync(arcDir, { recursive: true });
  const arcDirResolved = path.resolve(arcDir);

  const restored: string[] = [];
  for (const entry of entries) {
    // Validate path: must be a relative POSIX-style path with no absolute/traversal parts.
    if (
      entry.relPath.length === 0 ||
      entry.relPath.startsWith("/") ||
      entry.relPath.includes("\\") ||
      /^[a-zA-Z]:/.test(entry.relPath)
    ) {
      warn(`Skipping unsafe absolute path in archive: "${entry.relPath}"`);
      continue;
    }

    const segments = entry.relPath.split("/");
    if (segments.some((seg) => seg === "..")) {
      warn(`Skipping path with traversal components: "${entry.relPath}"`);
      continue;
    }

    const destFull = path.resolve(arcDirResolved, ...segments);
    const relCheck = path.relative(arcDirResolved, destFull);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
      warn(`Skipping path that escapes ARC dir: "${entry.relPath}"`);
      continue;
    }

    try {
      fs.mkdirSync(path.dirname(destFull), { recursive: true });
      fs.writeFileSync(destFull, entry.contents);
      restored.push(entry.relPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warn(`Failed to write "${entry.relPath}": ${msg}`);
    }
  }

  success(`Restored ${restored.length} file(s) to ${arcDir}.`);
  const preview = restored.slice(0, 10);
  for (const p of preview) {
    console.log(`  ${p}`);
  }
  if (restored.length > preview.length) {
    console.log(`  ... and ${restored.length - preview.length} more`);
  }
}

export async function handleBackupList(): Promise<void> {
  const backupsDir = path.join(getArcDir(), "backups");

  if (!fs.existsSync(backupsDir)) {
    info(`No backups directory yet (${backupsDir}).`);
    info("Create one with: arc backup create");
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(backupsDir, { withFileTypes: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed to read ${backupsDir}: ${msg}`);
    process.exit(1);
  }

  const files = entries
    .filter((e) => e.isFile())
    .map((e) => {
      const full = path.join(backupsDir, e.name);
      const stat = fs.statSync(full);
      return { name: e.name, full, size: stat.size, mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  if (files.length === 0) {
    info(`No backup files found in ${backupsDir}.`);
    return;
  }

  console.log();
  for (const f of files) {
    const when = f.mtime.toISOString();
    const size = formatSize(f.size).padStart(10);
    console.log(`  ${size}  ${when}  ${f.name}`);
  }
  console.log();
  info(`${files.length} backup(s) in ${backupsDir}`);
}
