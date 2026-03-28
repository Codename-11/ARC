#!/usr/bin/env node

/**
 * ARC Uninstall Script
 * Safely removes all arc components from the system
 *
 * Usage: node scripts/uninstall.js [--force]
 *
 * Components removed:
 * - API keys from system keyring
 * - Config directory (~/.arc)
 * - Global npm/pnpm link (optional)
 * - Shell integration (arc lines in shell profiles)
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  rmSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const CONFIG_DIR_NAME = '.arc';
const KEYRING_SERVICE = 'arc';

const isWindows = platform() === 'win32';
const isMac = platform() === 'darwin';
const isLinux = platform() === 'linux';

const forceMode = process.argv.includes('--force') || process.argv.includes('-f');
const localBinDir =
  process.env.ARC_LOCAL_BIN_DIR || join(homedir(), '.local', 'bin');
const localInstallMetaPath = join(localBinDir, '.arc-install.json');

function normalizeWindowsPath(value) {
  return value.replaceAll('/', '\\').toLowerCase();
}

function log(message, type = 'info') {
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m',
  };

  const prefix = {
    info: '\u2139',
    success: '\u2714',
    warn: '\u26A0',
    error: '\u2716',
  };

  console.log(`${colors[type]}${prefix[type]} ${message}${colors.reset}`);
}

async function confirm(question) {
  if (forceMode) return true;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function removeKeyringEntries() {
  log('Removing API keys from system keyring...');

  try {
    try {
      const { Entry } = await import('@napi-rs/keyring');
      const entry = new Entry(KEYRING_SERVICE, 'default');
      entry.deleteCredential();
      log('Keyring entries removed (via @napi-rs/keyring)', 'success');
      return true;
    } catch {
      // Fall through to platform-specific methods
    }

    if (isWindows) {
      spawnSync('cmdkey', ['/delete:arc'], { encoding: 'utf-8', shell: true });
    } else if (isMac) {
      spawnSync('security', ['delete-generic-password', '-s', KEYRING_SERVICE], { encoding: 'utf-8' });
    } else if (isLinux) {
      spawnSync('secret-tool', ['clear', 'service', KEYRING_SERVICE], { encoding: 'utf-8' });
    }

    log('No keyring entries found (may not have been stored there)', 'warn');
    return true;
  } catch (error) {
    log(`Could not remove keyring entries: ${error.message}`, 'warn');
    return false;
  }
}

function removeConfigDirectory() {
  const configDir = join(homedir(), CONFIG_DIR_NAME);

  if (!existsSync(configDir)) {
    log(`Config directory not found: ${configDir}`, 'warn');
    return true;
  }

  log(`Removing config directory: ${configDir}`);

  try {
    rmSync(configDir, { recursive: true, force: true });
    log('Config directory removed', 'success');
    return true;
  } catch (error) {
    log(`Failed to remove config directory: ${error.message}`, 'error');
    return false;
  }
}

function removeGlobalLink() {
  log('Checking for global package installation...');

  try {
    const pnpmResult = spawnSync('pnpm', ['list', '-g', '--depth=0'], {
      encoding: 'utf-8',
      shell: true,
    });

    if (pnpmResult.stdout && pnpmResult.stdout.includes('@axiom-labs/arc-cli')) {
      log('Found pnpm global link, removing...');
      spawnSync('pnpm', ['unlink', '--global', '@axiom-labs/arc-cli'], { encoding: 'utf-8', shell: true });
      log('Removed pnpm global link', 'success');
      return true;
    }
  } catch {
    // pnpm not available
  }

  try {
    const npmResult = spawnSync('npm', ['list', '-g', '--depth=0'], {
      encoding: 'utf-8',
      shell: true,
    });

    if (npmResult.stdout && npmResult.stdout.includes('@axiom-labs/arc-cli')) {
      log('Found npm global link, removing...');
      spawnSync('npm', ['uninstall', '-g', '@axiom-labs/arc-cli'], { encoding: 'utf-8', shell: true });
      log('Removed npm global link', 'success');
      return true;
    }
  } catch {
    // npm not available
  }

  log('No global package link found', 'info');
  return true;
}

function getWindowsUserPath() {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Failed to read Windows user PATH.');
  }

  return result.stdout.trim();
}

function setWindowsUserPath(value) {
  const escaped = value.replaceAll("'", "''");
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `[Environment]::SetEnvironmentVariable('Path', '${escaped}', 'User')`,
    ],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Failed to update Windows user PATH.');
  }
}

function removeLocalBinArtifacts() {
  log(`Checking for local arc shims in: ${localBinDir}`);

  const shimPaths = [
    join(localBinDir, 'arc'),
    join(localBinDir, 'arc.cmd'),
    join(localBinDir, 'arc.ps1'),
  ];

  let removedAny = false;

  try {
    for (const shimPath of shimPaths) {
      if (existsSync(shimPath)) {
        unlinkSync(shimPath);
        log(`Removed local shim: ${shimPath}`, 'success');
        removedAny = true;
      }
    }

    let addedToUserPath = false;
    if (existsSync(localInstallMetaPath)) {
      const meta = JSON.parse(readFileSync(localInstallMetaPath, 'utf8'));
      addedToUserPath = Boolean(meta?.addedToUserPath);
      unlinkSync(localInstallMetaPath);
      log(`Removed install metadata: ${localInstallMetaPath}`, 'success');
      removedAny = true;
    }

    if (isWindows && addedToUserPath) {
      const currentUserPath = getWindowsUserPath();
      const nextEntries = currentUserPath
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter(
          (entry) =>
            normalizeWindowsPath(entry) !== normalizeWindowsPath(localBinDir)
        );

      setWindowsUserPath(nextEntries.join(';'));
      log(`Removed ${localBinDir} from Windows user PATH`, 'success');
      removedAny = true;
    }

    if (!removedAny) {
      log('No local arc shims found', 'info');
    }

    return true;
  } catch (error) {
    log(`Failed to remove local shims: ${error.message}`, 'warn');
    return false;
  }
}

function removeShellIntegration() {
  log('Checking for shell integration...');

  const shellConfigs = [];

  if (isWindows) {
    const psProfile = join(homedir(), 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1');
    const pwshProfile = join(homedir(), 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    if (existsSync(psProfile)) shellConfigs.push(psProfile);
    if (existsSync(pwshProfile)) shellConfigs.push(pwshProfile);
  } else {
    const bashrc = join(homedir(), '.bashrc');
    const zshrc = join(homedir(), '.zshrc');
    const fishConfig = join(homedir(), '.config', 'fish', 'config.fish');

    if (existsSync(bashrc)) shellConfigs.push(bashrc);
    if (existsSync(zshrc)) shellConfigs.push(zshrc);
    if (existsSync(fishConfig)) shellConfigs.push(fishConfig);
  }

  let removed = 0;

  for (const configPath of shellConfigs) {
    try {
      const content = readFileSync(configPath, 'utf-8');

      const patterns = [
        /^.*eval\s+.*arc\s+shell-init.*$/gm,
        /^.*arc\s+shell-init.*$/gm,
        /^# arc shell integration.*$/gm,
        /^# arc$\n/gm,
      ];

      let newContent = content;
      let hasChanges = false;

      for (const pattern of patterns) {
        if (pattern.test(newContent)) {
          hasChanges = true;
          newContent = newContent.replace(pattern, '');
        }
      }

      if (hasChanges) {
        const backupPath = `${configPath}.arc-backup`;
        copyFileSync(configPath, backupPath);
        log(`Created backup: ${backupPath}`, 'info');

        newContent = newContent.replace(/\n{3,}/g, '\n\n').trim() + '\n';
        writeFileSync(configPath, newContent);
        log(`Removed shell integration from: ${configPath}`, 'success');
        removed++;
      }
    } catch (error) {
      log(`Could not process ${configPath}: ${error.message}`, 'warn');
    }
  }

  if (removed === 0) {
    log('No shell integration found', 'info');
  }

  return true;
}

async function main() {
  console.log('\n\x1b[1m\x1b[35mARC Uninstaller\x1b[0m\n');

  if (!forceMode) {
    console.log('This will remove:');
    console.log('  \u2022 API keys from system keyring');
    console.log(`  \u2022 Config directory (~/${CONFIG_DIR_NAME})`);
    console.log('  \u2022 Global package link (if exists)');
    console.log('  \u2022 Local arc shims and installer metadata');
    console.log('  \u2022 Windows user PATH entry added by arc (if applicable)');
    console.log('  \u2022 Shell integration (if configured)\n');

    const proceed = await confirm('Do you want to proceed?');
    if (!proceed) {
      log('Uninstall cancelled', 'info');
      process.exit(0);
    }
    console.log();
  }

  const results = {
    keyring: await removeKeyringEntries(),
    config: removeConfigDirectory(),
    globalLink: removeGlobalLink(),
    localBin: removeLocalBinArtifacts(),
    shell: removeShellIntegration(),
  };

  console.log('\n\x1b[1m--- Summary ---\x1b[0m\n');

  const allSuccess = Object.values(results).every(Boolean);

  if (allSuccess) {
    log('ARC has been completely removed from your system!', 'success');
    console.log('\nIf you installed via npm/pnpm globally, you may also want to run:');
    console.log('  npm uninstall -g @axiom-labs/arc-cli');
    console.log('  # or');
    console.log('  pnpm uninstall -g @axiom-labs/arc-cli\n');
  } else {
    log('Uninstall completed with some warnings (see above)', 'warn');
  }

  console.log('\x1b[33mRestart your terminal for changes to take effect.\x1b[0m\n');
}

main().catch((error) => {
  log(`Uninstall failed: ${error.message}`, 'error');
  process.exit(1);
});
