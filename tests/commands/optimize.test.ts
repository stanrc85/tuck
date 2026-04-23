import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { TEST_HOME } from '../setup.js';

const promptConfirmMock = vi.fn();
const runZshProfileMock = vi.fn();

vi.mock('../../src/ui/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/ui/index.js')>(
    '../../src/ui/index.js',
  );
  return {
    ...actual,
    prompts: {
      ...actual.prompts,
      intro: vi.fn(),
      outro: vi.fn(),
      confirm: promptConfirmMock,
    },
  };
});

vi.mock('../../src/lib/shellProfiler/runner.js', () => ({
  runZshProfile: runZshProfileMock,
}));

// Synthetic xtrace that triggers the multiple-compinit rule — two compinit
// calls so the rule engine picks it up.
const PROFILE_WITH_DOUBLE_COMPINIT = [
  '+1707000000.000000|/etc/zsh/zshrc|5> compinit',
  '+1707000000.050000|.zshrc|10> autoload -Uz compinit',
  '+1707000000.060000|.zshrc|11> compinit',
  '+1707000000.070000|.zshrc|12> exit',
].join('\n');

describe('optimize command', () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
    vol.mkdirSync(`${TEST_HOME}/.tuck`, { recursive: true });
    runZshProfileMock.mockResolvedValue({
      stdout: '',
      stderr: PROFILE_WITH_DOUBLE_COMPINIT,
      exitCode: 0,
      available: true,
    });
  });

  afterEach(() => {
    vol.reset();
  });

  describe('--format json', () => {
    it('emits a structured report with totalMs, perFile, and recommendations', async () => {
      const { runOptimize } = await import('../../src/commands/optimize.js');
      const chunks: string[] = [];
      const orig = console.log;
      // eslint-disable-next-line no-console
      console.log = (...args: unknown[]) => chunks.push(args.map(String).join(' '));
      try {
        await runOptimize({ format: 'json' });
      } finally {
        // eslint-disable-next-line no-console
        console.log = orig;
      }
      const parsed = JSON.parse(chunks.join('\n'));
      expect(parsed).toHaveProperty('totalMs');
      expect(parsed).toHaveProperty('perFile');
      expect(parsed).toHaveProperty('recommendations');
      expect(parsed.recommendations.some((r: { rule: string }) => r.rule === 'multiple-compinit')).toBe(true);
    });
  });

  describe('safety invariants for --auto', () => {
    it('refuses to write in non-TTY mode without --yes', async () => {
      // Non-TTY is the default in vitest env.
      const { runOptimize } = await import('../../src/commands/optimize.js');
      await runOptimize({ auto: true, format: 'text' });
      expect(vol.existsSync(`${TEST_HOME}/.zshenv`)).toBe(false);
      expect(promptConfirmMock).not.toHaveBeenCalled();
    });

    it('does not write when the user declines the confirm prompt', async () => {
      const restore = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      try {
        promptConfirmMock.mockResolvedValueOnce(false);
        const { runOptimize } = await import('../../src/commands/optimize.js');
        await runOptimize({ auto: true, format: 'text' });
        expect(vol.existsSync(`${TEST_HOME}/.zshenv`)).toBe(false);
        expect(promptConfirmMock).toHaveBeenCalledOnce();
      } finally {
        if (restore) Object.defineProperty(process.stdout, 'isTTY', restore);
      }
    });

    it('writes + snapshots when --yes is passed', async () => {
      const { runOptimize } = await import('../../src/commands/optimize.js');
      await runOptimize({ auto: true, yes: true, format: 'text' });

      expect(vol.existsSync(`${TEST_HOME}/.zshenv`)).toBe(true);
      const zshenv = vol.readFileSync(`${TEST_HOME}/.zshenv`, 'utf-8') as string;
      expect(zshenv).toContain('skip_global_compinit=1');

      // Snapshot created.
      const snapshotRoot = `${TEST_HOME}/.tuck-backups`;
      expect(vol.existsSync(snapshotRoot)).toBe(true);
      const ids = vol.readdirSync(snapshotRoot);
      expect(ids.length).toBeGreaterThan(0);
    });

    it('skips the fix when skip_global_compinit is already present', async () => {
      vol.writeFileSync(`${TEST_HOME}/.zshenv`, 'skip_global_compinit=1\nexport FOO=1\n');
      const { runOptimize } = await import('../../src/commands/optimize.js');
      await runOptimize({ auto: true, yes: true, format: 'text' });

      const zshenv = vol.readFileSync(`${TEST_HOME}/.zshenv`, 'utf-8') as string;
      // Content unchanged (the rule fires but the fix sees it's already present).
      expect(zshenv).toBe('skip_global_compinit=1\nexport FOO=1\n');
    });
  });
});
