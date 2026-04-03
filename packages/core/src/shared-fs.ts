import fs from "node:fs";
import path from "node:path";

export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof base[key] === "object" &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(
        base[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function writeJsonObject(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export function isDirectoryLink(dirPath: string): boolean {
  try {
    return fs.lstatSync(dirPath).isSymbolicLink();
  } catch {
    return false;
  }
}

export function createDirectoryLink(targetDir: string, linkPath: string): void {
  fs.mkdirSync(targetDir, { recursive: true });

  if (fs.existsSync(linkPath) || isDirectoryLink(linkPath)) {
    if (isDirectoryLink(linkPath)) {
      fs.rmSync(linkPath, { recursive: true, force: true });
    } else {
      const existing = fs.readdirSync(linkPath);
      for (const file of existing) {
        const src = path.join(linkPath, file);
        const dest = path.join(targetDir, file);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
        }
      }
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
  }

  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(targetDir, linkPath, linkType);
}

export function removeDirectoryLink(targetDir: string, linkPath: string): void {
  if (!isDirectoryLink(linkPath)) return;

  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.mkdirSync(linkPath, { recursive: true });

  if (!fs.existsSync(targetDir)) return;
  for (const file of fs.readdirSync(targetDir)) {
    const src = path.join(targetDir, file);
    const dest = path.join(linkPath, file);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  }
}
