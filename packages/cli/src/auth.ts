import type { CredentialStatus } from "../../core/src/adapters/types.js";
import type { Profile } from "../../core/src/types.js";
import { getAdapter } from "./adapters/index.js";

export type { CredentialStatus } from "../../core/src/adapters/types.js";

export async function getCredentialStatus(
  profile: Profile,
  tool?: string
): Promise<CredentialStatus> {
  return await getAdapter(tool ?? profile.tool ?? "claude").getCredentialStatus(profile);
}

export async function buildProfileEnv(
  profile: Profile,
  profileName: string
): Promise<Record<string, string | undefined>> {
  return await getAdapter(profile.tool ?? "claude").buildProfileEnv(profile, profileName);
}
