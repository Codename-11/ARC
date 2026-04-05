import { loadConfig, resolveProfileName, saveConfig } from "../config.js";
import { storeSecret } from "../keyring.js";
import { error, success, warn, redact } from "../display.js";

async function readKeyInteractive(): Promise<string | null> {
  try {
    const mod = await import("@inquirer/prompts");
    const key = await mod.password({ message: "Enter API key:" });
    return key;
  } catch {
    warn("Interactive prompts not available (@inquirer/prompts not installed). Use --from-env <VAR> to provide the key via environment variable.");
    return null;
  }
}

function readKeyFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data.trim());
    });
    process.stdin.on("error", reject);
  });
}

function validateKeyFormat(key: string): boolean {
  return key.startsWith("sk-ant-") || key.startsWith("sk-") || key.length > 20;
}

export async function handleSetKey(
  name?: string,
  opts?: { fromEnv?: string }
): Promise<void> {
  const config = loadConfig();
  const profileName = resolveProfileName(config, name);
  const profile = config.profiles[profileName];

  if (!profile) {
    error(`Profile "${profileName}" not found. Run "arc profile list" to see available profiles.`);
    process.exit(1);
  }

  if (profile.authType !== "api-key") {
    error(`Profile "${profileName}" uses auth type "${profile.authType}". set-key is only for api-key profiles.`);
    process.exit(1);
  }

  let apiKey: string | null = null;

  if (opts?.fromEnv) {
    const envValue = process.env[opts.fromEnv];
    if (!envValue) {
      error(`Environment variable "${opts.fromEnv}" is not set.`);
      process.exit(1);
    }
    apiKey = envValue;
  } else if (!process.stdin.isTTY) {
    apiKey = await readKeyFromStdin();
  } else {
    apiKey = await readKeyInteractive();
  }

  if (!apiKey) {
    error("No API key provided.");
    process.exit(1);
  }

  if (!validateKeyFormat(apiKey)) {
    error("Invalid API key format. Expected a key starting with 'sk-ant-' or 'sk-'.");
    process.exit(1);
  }

  await storeSecret(profileName, apiKey);

  profile.apiKeyStorage = "keyring";
  config.profiles[profileName] = profile;
  saveConfig(config);

  success(`API key stored for profile: ${profileName} (${redact(apiKey)})`);
}
