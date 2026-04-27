/**
 * tuck secrets - Manage local secrets for placeholder replacement
 *
 * Commands:
 *   tuck secrets list          - List all stored secrets (values hidden)
 *   tuck secrets set <n> <v>   - Set a secret value
 *   tuck secrets unset <name>  - Remove a secret
 *   tuck secrets path          - Show path to secrets file
 *   tuck secrets scan-history  - Scan git history for leaked secrets
 *   tuck secrets backend       - Manage secret backends (1Password, Bitwarden, pass)
 *   tuck secrets map           - Map placeholder to backend path
 *   tuck secrets mappings      - List all mappings
 *   tuck secrets test          - Test backend connectivity
 */

import { Command } from 'commander';
import { prompts, colors as c, formatCount } from '../ui/index.js';
import { getTuckDir, expandPath, pathExists } from '../lib/paths.js';
import { loadManifest } from '../lib/manifest.js';
import { loadConfig, saveConfig } from '../lib/config.js';
import {
  listSecrets,
  setSecret,
  unsetSecret,
  getSecretsPath,
  isValidSecretName,
  normalizeSecretName,
  scanForSecrets,
  type ScanSummary,
} from '../lib/secrets/index.js';
import {
  createResolver,
  setMapping,
  listMappings,
  BACKEND_NAMES,
  type BackendName,
} from '../lib/secretBackends/index.js';
import { NotInitializedError } from '../errors.js';
import { getLog } from '../lib/git.js';

const isBackendName = (value: string): value is BackendName => {
  return (BACKEND_NAMES as readonly string[]).includes(value);
};

const isValidUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

// ============================================================================
// List Command
// ============================================================================

const runSecretsList = async (): Promise<void> => {
  const tuckDir = getTuckDir();

  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  const secrets = await listSecrets(tuckDir);

  prompts.intro('tuck secrets list');

  if (secrets.length === 0) {
    prompts.log.message(
      c.dim(
        [
          `Secrets file: ${getSecretsPath(tuckDir)}`,
          '',
          'Secrets are stored when you choose to replace detected secrets with placeholders.',
          'You can also manually add secrets with: tuck secrets set <NAME> <value>',
        ].join('\n'),
      ),
    );
    prompts.outro('No secrets stored');
    return;
  }

  for (const secret of secrets) {
    const lines = [c.green(secret.name)];
    lines.push(`  ${c.dim('Placeholder:')} ${c.cyan(secret.placeholder)}`);
    if (secret.description) {
      lines.push(`  ${c.dim('Type:')} ${secret.description}`);
    }
    if (secret.source) {
      lines.push(`  ${c.dim('Source:')} ${secret.source}`);
    }
    lines.push(`  ${c.dim('Added:')} ${new Date(secret.addedAt).toLocaleDateString()}`);
    prompts.log.message(lines.join('\n'));
  }

  prompts.log.message(c.dim(`Secrets file: ${getSecretsPath(tuckDir)}`));
  prompts.outro(`${formatCount(secrets.length, 'secret')} stored`);
};

// ============================================================================
// Set Command
// ============================================================================

const runSecretsSet = async (name: string): Promise<void> => {
  const tuckDir = getTuckDir();

  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  // Validate or normalize name
  if (!isValidSecretName(name)) {
    const normalized = normalizeSecretName(name);
    prompts.log.warning(`Secret name normalized to: ${normalized}`);
    prompts.log.message(
      c.dim('Secret names must be uppercase alphanumeric with underscores (e.g., API_KEY)'),
    );
    name = normalized;
  }

  // Security: Always prompt for secret value interactively
  // Never accept via command-line to prevent exposure in shell history and process list
  // Note: Cancellation or empty input is handled below by validating the returned value.
  const secretValue = await prompts.password(`Enter value for ${name}:`);

  if (!secretValue || secretValue.trim().length === 0) {
    prompts.log.error('Secret value cannot be empty');
    return;
  }

  await setSecret(tuckDir, name, secretValue);
  prompts.log.success(`Secret '${name}' set`);
  prompts.log.message(c.dim(`Use {{${name}}} as placeholder in your dotfiles`));
};

// ============================================================================
// Unset Command
// ============================================================================

const runSecretsUnset = async (name: string): Promise<void> => {
  const tuckDir = getTuckDir();

  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  const removed = await unsetSecret(tuckDir, name);

  if (removed) {
    prompts.log.success(`Secret '${name}' removed`);
  } else {
    prompts.log.warning(`Secret '${name}' not found`);
    prompts.log.message(c.dim('Run `tuck secrets list` to see stored secrets'));
  }
};

// ============================================================================
// Path Command
// ============================================================================

const runSecretsPath = async (): Promise<void> => {
  const tuckDir = getTuckDir();

  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  // Path is data — print raw for piping.
  console.log(getSecretsPath(tuckDir));
};

// ============================================================================
// Scan History Command
// ============================================================================

interface HistoryScanResult {
  commit: string;
  author: string;
  date: string;
  message: string;
  secrets: Array<{
    file: string;
    pattern: string;
    severity: string;
    redactedValue: string;
  }>;
}

const runScanHistory = async (options: { since?: string; limit?: string }): Promise<void> => {
  const tuckDir = getTuckDir();

  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  const limit = options.limit ? parseInt(options.limit, 10) : 50;

  prompts.intro('tuck secrets scan-history');

  const spinner = prompts.spinner();
  spinner.start('Scanning git history for secrets...');

  try {
    const logEntries = await getLog(tuckDir, {
      maxCount: limit,
      since: options.since,
    });

    if (logEntries.length === 0) {
      spinner.stop('No commits found');
      prompts.outro('Nothing to scan');
      return;
    }

    let simpleGit;
    try {
      simpleGit = (await import('simple-git')).default;
    } catch (importError) {
      spinner.stop('Git integration is unavailable (simple-git module could not be loaded).');
      const errorMsg = importError instanceof Error ? importError.message : String(importError);
      prompts.log.error(`Failed to load simple-git for scan-history: ${errorMsg}`);
      prompts.outro('Scan aborted');
      return;
    }
    const git = simpleGit(tuckDir);

    const results: HistoryScanResult[] = [];
    let scannedCommits = 0;

    for (const entry of logEntries) {
      scannedCommits++;
      spinner.message(`Scanning commit ${scannedCommits}/${logEntries.length}...`);

      try {
        const diff = await git.diff([`${entry.hash}^`, entry.hash]);

        if (diff) {
          const addedLines = diff
            .split('\n')
            .filter((line: string) => line.startsWith('+') && !line.startsWith('+++'))
            .map((line: string) => line.slice(1))
            .join('\n');

          if (addedLines) {
            const { scanContent } = await import('../lib/secrets/scanner.js');
            const matches = scanContent(addedLines);

            if (matches.length > 0) {
              results.push({
                commit: entry.hash.slice(0, 8),
                author: entry.author,
                date: entry.date,
                message: entry.message.slice(0, 50),
                secrets: matches.map((m) => ({
                  file: 'diff',
                  pattern: m.patternName,
                  severity: m.severity,
                  redactedValue: m.redactedValue,
                })),
              });
            }
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        prompts.log.warning(
          `Skipping commit ${entry.hash.slice(
            0,
            8,
          )}: unable to diff against parent (possibly initial/root commit). ${errorMsg}`,
        );
        continue;
      }
    }

    spinner.stop(`Scanned ${scannedCommits} commits`);

    if (results.length === 0) {
      prompts.outro('Clean history — no secrets found');
      return;
    }

    prompts.log.error(`Found potential secrets in ${formatCount(results.length, 'commit')}`);

    for (const result of results) {
      const lines: string[] = [c.yellow(`Commit: ${result.commit}`)];
      lines.push(c.dim(`  Author:  ${result.author}`));
      lines.push(c.dim(`  Date:    ${result.date}`));
      lines.push(c.dim(`  Message: ${result.message}`));

      for (const secret of result.secrets) {
        const severityColor =
          secret.severity === 'critical' ? c.red : secret.severity === 'high' ? c.yellow : c.dim;
        lines.push(`  ${severityColor(`[${secret.severity}]`)} ${secret.pattern}`);
        lines.push(c.dim(`    Value: ${secret.redactedValue}`));
      }
      prompts.log.message(lines.join('\n'));
    }

    prompts.log.warning('If these secrets are still valid, rotate them immediately!');
    prompts.log.message(
      c.dim(
        [
          'To remove secrets from git history, consider:',
          '  - git filter-branch',
          '  - BFG Repo-Cleaner (https://rtyley.github.io/bfg-repo-cleaner/)',
        ].join('\n'),
      ),
    );

    prompts.outro(`${formatCount(results.length, 'commit')} with potential secrets`);
  } catch (error) {
    spinner.stop('Scan failed');
    throw error;
  }
};

// ============================================================================
// Interactive Scan Command
// ============================================================================

const runScanFiles = async (paths: string[]): Promise<void> => {
  const tuckDir = getTuckDir();

  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  prompts.intro('tuck secrets scan');

  if (paths.length === 0) {
    prompts.log.error('No files specified');
    prompts.log.message(c.dim('Usage: tuck secrets scan <file> [files...]'));
    prompts.outro('Scan aborted');
    return;
  }

  const expandedPaths = paths.map((p) => expandPath(p));

  for (const path of expandedPaths) {
    if (!(await pathExists(path))) {
      prompts.log.warning(`File not found: ${path}`);
    }
  }

  const existingPaths = [];
  for (const path of expandedPaths) {
    if (await pathExists(path)) {
      existingPaths.push(path);
    }
  }

  if (existingPaths.length === 0) {
    prompts.outro('No valid files to scan');
    return;
  }

  const spinner = prompts.spinner();
  spinner.start(`Scanning ${formatCount(existingPaths.length, 'file')}...`);

  const summary = await scanForSecrets(existingPaths, tuckDir);

  spinner.stop('Scan complete');

  if (summary.filesWithSecrets === 0) {
    prompts.outro('No secrets detected');
    return;
  }

  displayScanResults(summary);
  prompts.outro(
    `${formatCount(summary.totalSecrets, 'potential secret')} in ${formatCount(summary.filesWithSecrets, 'file')}`,
  );
};

/**
 * Display scan results. Caller assumes a clack frame is open.
 */
export const displayScanResults = (summary: ScanSummary): void => {
  prompts.log.error(
    `Found ${summary.totalSecrets} potential secret(s) in ${formatCount(summary.filesWithSecrets, 'file')}`,
  );

  // Summary by severity as one block
  const severityLines: string[] = [];
  if (summary.bySeverity.critical > 0) severityLines.push(c.red(`  Critical: ${summary.bySeverity.critical}`));
  if (summary.bySeverity.high > 0) severityLines.push(c.yellow(`  High: ${summary.bySeverity.high}`));
  if (summary.bySeverity.medium > 0) severityLines.push(c.blue(`  Medium: ${summary.bySeverity.medium}`));
  if (summary.bySeverity.low > 0) severityLines.push(c.dim(`  Low: ${summary.bySeverity.low}`));
  if (severityLines.length > 0) {
    prompts.log.message(severityLines.join('\n'));
  }

  // Per-file detail blocks
  for (const result of summary.results) {
    const lines: string[] = [c.cyan(result.collapsedPath)];
    for (const match of result.matches) {
      const severityColor =
        match.severity === 'critical'
          ? c.red
          : match.severity === 'high'
            ? c.yellow
            : match.severity === 'medium'
              ? c.blue
              : c.dim;
      lines.push(
        `  ${c.dim(`Line ${match.line}:`)} ${severityColor(`[${match.severity}]`)} ${match.patternName}`,
      );
      lines.push(c.dim(`    ${match.context}`));
    }
    prompts.log.message(lines.join('\n'));
  }
};

// ============================================================================
// Backend Commands
// ============================================================================

interface BackendSetOptions {
  vault?: string;
  serverUrl?: string;
  storePath?: string;
}

const runBackendSet = async (backend: string, options: BackendSetOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  if (!isBackendName(backend)) {
    prompts.log.error(`Invalid backend: ${backend}`);
    prompts.log.message(c.dim(`Valid backends: ${BACKEND_NAMES.join(', ')}`));
    return;
  }

  if (backend === 'bitwarden' && options.serverUrl) {
    if (!isValidUrl(options.serverUrl)) {
      prompts.log.error(`Invalid server URL: ${options.serverUrl}`);
      prompts.log.message(c.dim('URL must be a valid URL (e.g., https://vault.example.com)'));
      return;
    }
    try {
      const parsedUrl = new URL(options.serverUrl);
      if (parsedUrl.protocol !== 'https:') {
        prompts.log.warning(`Bitwarden server URL is not using HTTPS: ${options.serverUrl}`);
        prompts.log.message(
          c.dim('Using HTTPS is strongly recommended for Bitwarden to protect your secrets.'),
        );
      }
    } catch {
      // isValidUrl already validated the URL; this is a safety net
    }
  }

  if (backend === 'pass' && options.storePath) {
    const expandedPath = expandPath(options.storePath);
    if (!(await pathExists(expandedPath))) {
      prompts.log.warning(`Password store path does not exist: ${options.storePath}`);
      prompts.log.message(
        c.dim('The path will be used anyway, but make sure it exists before using pass.'),
      );
    }
  }

  const config = await loadConfig(tuckDir);

  const existingBackends = config.security.backends || {};
  const updatedBackends: Record<string, Record<string, unknown>> = {};

  if (backend === '1password' && options.vault) {
    updatedBackends['1password'] = {
      ...(existingBackends['1password'] || {}),
      vault: options.vault,
    };
  }
  if (backend === 'bitwarden' && options.serverUrl) {
    updatedBackends.bitwarden = {
      ...(existingBackends.bitwarden || {}),
      serverUrl: options.serverUrl,
    };
  }
  if (backend === 'pass' && options.storePath) {
    updatedBackends.pass = {
      ...(existingBackends.pass || {}),
      storePath: options.storePath,
    };
  }

  const updatedSecurity = {
    ...config.security,
    secretBackend: backend,
    ...(Object.keys(updatedBackends).length > 0 ? { backends: { ...existingBackends, ...updatedBackends } } : {}),
  };

  await saveConfig({ security: updatedSecurity }, tuckDir);
  prompts.log.success(`Secret backend set to: ${backend}`);

  if (backend !== 'local') {
    const resolver = createResolver(tuckDir, { ...config.security, secretBackend: backend });
    const backendImpl = resolver.getBackend(backend);
    if (backendImpl) {
      prompts.log.message(c.dim(backendImpl.getSetupInstructions()));
    }
  }
};

const runBackendStatus = async (): Promise<void> => {
  const tuckDir = getTuckDir();

  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  const config = await loadConfig(tuckDir);
  const resolver = createResolver(tuckDir, config.security);
  const statuses = await resolver.getBackendStatuses();

  prompts.intro('tuck secrets backend status');

  for (const status of statuses) {
    const primaryMark = status.isPrimary ? c.cyan(' (active)') : '';
    const availableIcon = status.available ? c.green('✓') : c.red('✗');
    const authIcon = status.authenticated ? c.green('✓') : c.yellow('○');

    const lines = [`${status.displayName}${primaryMark}`];
    lines.push(`  ${availableIcon} CLI installed: ${status.available ? 'Yes' : 'No'}`);
    if (status.available) {
      lines.push(`  ${authIcon} Authenticated: ${status.authenticated ? 'Yes' : 'No'}`);
    }
    prompts.log.message(lines.join('\n'));
  }

  prompts.outro(`Current backend: ${config.security.secretBackend || 'local'}`);
};

const runBackendList = async (): Promise<void> => {
  prompts.intro('tuck secrets backend list');

  const backends = [
    { name: 'local', desc: 'Local secrets file (default)' },
    { name: '1password', desc: '1Password password manager' },
    { name: 'bitwarden', desc: 'Bitwarden password manager' },
    { name: 'pass', desc: 'Standard Unix password store' },
  ];

  for (const b of backends) {
    prompts.log.message([c.green(b.name), `  ${c.dim(b.desc)}`].join('\n'));
  }

  prompts.log.message(c.dim('Set backend with: tuck secrets backend set <name>'));
  prompts.outro(`${backends.length} backends available`);
};

// ============================================================================
// Mapping Commands
// ============================================================================

interface MapOptions {
  '1password'?: string;
  bitwarden?: string;
  pass?: string;
  local?: boolean;
}

const runMap = async (name: string, options: MapOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  if (!isValidSecretName(name)) {
    const normalized = normalizeSecretName(name);
    prompts.log.warning(`Secret name normalized to: ${normalized}`);
    name = normalized;
  }

  let mappingsAdded = 0;

  if (options['1password']) {
    await setMapping(tuckDir, name, '1password', options['1password']);
    prompts.log.success(`Mapped ${name} → 1Password: ${options['1password']}`);
    mappingsAdded++;
  }

  if (options.bitwarden) {
    await setMapping(tuckDir, name, 'bitwarden', options.bitwarden);
    prompts.log.success(`Mapped ${name} → Bitwarden: ${options.bitwarden}`);
    mappingsAdded++;
  }

  if (options.pass) {
    await setMapping(tuckDir, name, 'pass', options.pass);
    prompts.log.success(`Mapped ${name} → pass: ${options.pass}`);
    mappingsAdded++;
  }

  if (options.local) {
    await setMapping(tuckDir, name, 'local', true);
    prompts.log.success(`Mapped ${name} → local store`);
    mappingsAdded++;
  }

  if (mappingsAdded === 0) {
    prompts.log.error('No backend specified');
    prompts.log.message(
      c.dim(
        'Usage: tuck secrets map <name> --1password "op://..." --bitwarden "..." --pass "..."',
      ),
    );
  }
};

const runMappings = async (): Promise<void> => {
  const tuckDir = getTuckDir();

  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  const mappings = await listMappings(tuckDir);
  const entries = Object.entries(mappings);

  prompts.intro('tuck secrets mappings');

  if (entries.length === 0) {
    prompts.log.message(c.dim('Add mappings with: tuck secrets map <name> --1password "op://..."'));
    prompts.outro('No secret mappings configured');
    return;
  }

  for (const [name, mapping] of entries) {
    const lines: string[] = [c.green(name)];
    if (mapping['1password']) lines.push(`  ${c.dim('1Password:')} ${mapping['1password']}`);
    if (mapping.bitwarden) lines.push(`  ${c.dim('Bitwarden:')} ${mapping.bitwarden}`);
    if (mapping.pass) lines.push(`  ${c.dim('pass:')} ${mapping.pass}`);
    if (mapping.local) lines.push(`  ${c.dim('local:')} yes`);
    prompts.log.message(lines.join('\n'));
  }

  prompts.outro(`${formatCount(entries.length, 'mapping')} configured`);
};

// ============================================================================
// Test Command
// ============================================================================

interface TestOptions {
  backend?: string;
}

const runTest = async (options: TestOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  const config = await loadConfig(tuckDir);
  const resolver = createResolver(tuckDir, config.security);

  const rawBackendName = options.backend || config.security.secretBackend || 'local';
  if (!isBackendName(rawBackendName)) {
    prompts.intro('tuck secrets test');
    prompts.log.error(`Invalid backend: ${rawBackendName}`);
    prompts.log.message(c.dim(`Valid backends: ${BACKEND_NAMES.join(', ')}`));
    prompts.outro('Test aborted');
    return;
  }
  const backendName = rawBackendName;

  prompts.intro(`tuck secrets test (${backendName})`);

  const spinner = prompts.spinner();
  spinner.start('Checking backend availability...');

  const backend = resolver.getBackend(backendName);
  if (!backend) {
    spinner.stop('Unknown backend');
    prompts.log.error(`Unknown backend: ${backendName}`);
    prompts.outro('Test aborted');
    return;
  }

  const available = await backend.isAvailable();
  if (!available) {
    spinner.stop('Backend not available');
    prompts.log.error(`${backend.displayName} CLI is not installed`);
    prompts.log.message(c.dim(backend.getSetupInstructions()));
    prompts.outro('Test failed');
    return;
  }

  spinner.message('Checking authentication...');

  const authenticated = await backend.isAuthenticated();
  if (!authenticated) {
    spinner.stop('Not authenticated');
    prompts.log.warning(`Not authenticated with ${backend.displayName}`);
    prompts.log.message(c.dim(backend.getSetupInstructions()));
    prompts.outro('Test failed');
    return;
  }

  spinner.stop('Backend ready');
  prompts.log.success(`${backend.displayName} is available and authenticated`);

  if (backend.listSecrets) {
    const secrets = await backend.listSecrets();
    if (secrets.length > 0) {
      prompts.log.info(`Found ${formatCount(secrets.length, 'secret')} in ${backend.displayName}`);
    }
  }

  prompts.outro('Backend test passed');
};

// ============================================================================
// Command Definition
// ============================================================================

export const secretsCommand = new Command('secrets')
  .description('Manage local secrets for placeholder replacement')
  .action(async () => {
    await runSecretsList();
  })
  .addCommand(
    new Command('list')
      .description('List all stored secrets (values hidden)')
      .action(runSecretsList)
  )
  .addCommand(
    new Command('set')
      .description('Set a secret value (prompts securely)')
      .argument('<name>', 'Secret name (e.g., GITHUB_TOKEN)')
      .action(runSecretsSet)
  )
  .addCommand(
    new Command('unset')
      .description('Remove a secret')
      .argument('<name>', 'Secret name to remove')
      .action(runSecretsUnset)
  )
  .addCommand(new Command('path').description('Show path to secrets file').action(runSecretsPath))
  .addCommand(
    new Command('scan')
      .description('Scan files for secrets')
      .argument('[paths...]', 'Files to scan')
      .action(runScanFiles)
  )
  .addCommand(
    new Command('scan-history')
      .description('Scan git history for leaked secrets')
      .option('--since <date>', 'Only scan commits after this date (e.g., 2024-01-01)')
      .option('--limit <n>', 'Maximum number of commits to scan', '50')
      .action(runScanHistory)
  )
  .addCommand(
    new Command('backend')
      .description('Manage secret backends (1Password, Bitwarden, pass)')
      .addCommand(
        new Command('set')
          .description('Set the secret backend')
          .argument('<backend>', 'Backend name: local, 1password, bitwarden, pass')
          .option('--vault <vault>', 'Default vault (1Password)')
          .option('--server-url <url>', 'Server URL (Bitwarden)')
          .option('--store-path <path>', 'Password store path (pass)')
          .action(runBackendSet)
      )
      .addCommand(
        new Command('status')
          .description('Show backend status')
          .action(runBackendStatus)
      )
      .addCommand(
        new Command('list')
          .description('List available backends')
          .action(runBackendList)
      )
  )
  .addCommand(
    new Command('map')
      .description('Map placeholder to backend path')
      .argument('<name>', 'Placeholder name (e.g., GITHUB_TOKEN)')
      .option('--1password <path>', '1Password path (op://vault/item/field)')
      .option('--bitwarden <id>', 'Bitwarden item ID or name')
      .option('--pass <path>', 'pass path')
      .option('--local', 'Mark as available in local store')
      .action(runMap)
  )
  .addCommand(
    new Command('mappings')
      .description('List all secret mappings')
      .action(runMappings)
  )
  .addCommand(
    new Command('test')
      .description('Test backend connectivity')
      .option('--backend <name>', 'Specific backend to test')
      .action(runTest)
  );
