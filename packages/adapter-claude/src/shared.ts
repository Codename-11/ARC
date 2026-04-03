import fs from "node:fs";
import path from "node:path";
import { getSharedDir } from "@axiom-labs/arc-core";

const SHARED_FILE = "CLAUDE.md";
const START = "<!-- arc:shared:start -->";
const END = "<!-- arc:shared:end -->";

function removeSharedBlock(content: string): string {
  const startIdx = content.indexOf(START);
  const endIdx = content.indexOf(END);
  if (startIdx === -1 || endIdx === -1) {
    return content;
  }

  const tail = content.slice(endIdx + END.length).replace(/^\n/, "");
  return (content.slice(0, startIdx) + tail).trimStart();
}

function getSharedClaudeMdPath(): string {
  return path.join(getSharedDir(), SHARED_FILE);
}

export function syncSharedClaudeMd(profileConfigDir: string): boolean {
  const sharedPath = getSharedClaudeMdPath();
  if (!fs.existsSync(sharedPath)) {
    return false;
  }

  const sharedContent = fs.readFileSync(sharedPath, "utf-8").trim();
  if (!sharedContent) {
    return false;
  }

  const profilePath = path.join(profileConfigDir, SHARED_FILE);
  const existingContent = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, "utf-8") : "";
  const injected =
    `${START}\n${sharedContent}\n${END}\n` +
    (removeSharedBlock(existingContent) ? `\n${removeSharedBlock(existingContent)}` : "");

  fs.writeFileSync(profilePath, injected, "utf-8");
  return true;
}

export function removeSharedClaudeMd(profileConfigDir: string): void {
  const profilePath = path.join(profileConfigDir, SHARED_FILE);
  if (!fs.existsSync(profilePath)) {
    return;
  }

  const cleaned = removeSharedBlock(fs.readFileSync(profilePath, "utf-8"));
  if (cleaned.trim()) {
    fs.writeFileSync(profilePath, cleaned, "utf-8");
  } else {
    fs.unlinkSync(profilePath);
  }
}

export function pullSharedClaudeMd(profileConfigDir: string): boolean {
  const profilePath = path.join(profileConfigDir, SHARED_FILE);
  if (!fs.existsSync(profilePath)) {
    return false;
  }

  const cleaned = removeSharedBlock(fs.readFileSync(profilePath, "utf-8")).trim();
  if (!cleaned) {
    return false;
  }

  fs.mkdirSync(getSharedDir(), { recursive: true });
  fs.writeFileSync(getSharedClaudeMdPath(), cleaned + "\n", "utf-8");
  return true;
}
