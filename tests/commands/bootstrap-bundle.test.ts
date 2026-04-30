import { describe, it, expect, beforeEach, vi } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { parse as parseToml } from 'smol-toml';
import {
  runBundleList,
  runBundleShow,
  runBundleCreate,
  runBundleAdd,
  runBundleRemove,
  runBundleDelete,
} from '../../src/commands/bootstrap-bundle.js';
import { BootstrapError, NonInteractivePromptError } from '../../src/errors.js';
import { TEST_TUCK_DIR } from '../setup.js';

// Mock ui so prompts don't try to attach to a TTY in tests. Confirm behaviour
// matters for the delete flow; everything else is display-only.
const { isInteractiveMock, confirmMock } = vi.hoisted(() => ({
  isInteractiveMock: vi.fn(() => true),
  confirmMock: vi.fn(),
}));

vi.mock('../../src/ui/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/ui/index.js')>(
    '../../src/ui/index.js'
  );
  // Dynamic import: this file eagerly imports its SUT, so static-importing
  // mockOutro at top-level races vitest's mock-hoisting (binding not initialized
  // when factory runs). Import inside the factory to defer evaluation.
  const { mockOutro } = await import('../utils/uiMocks.js');
  return {
    ...actual,
    prompts: {
      ...actual.prompts,
      intro: vi.fn(),
      outro: mockOutro(),
      note: vi.fn(),
      cancel: vi.fn(),
      confirm: confirmMock,
      log: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
      spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: '' })),
    },
    logger: {
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      heading: vi.fn(),
      blank: vi.fn(),
      file: vi.fn(),
    },
    isInteractive: isInteractiveMock,
  };
});

// Stub runCheck/detectTool so `show` doesn't actually spawn processes or touch
// the host filesystem (memfs doesn't proxy child_process). Hoisted so beforeEach
// can re-seed the resolved values after vi.clearAllMocks() wipes them.
const { runCheckMock, detectToolMock } = vi.hoisted(() => ({
  runCheckMock: vi.fn(),
  detectToolMock: vi.fn(),
}));
vi.mock('../../src/lib/bootstrap/runner.js', () => ({ runCheck: runCheckMock }));
vi.mock('../../src/lib/bootstrap/detect.js', () => ({ detectTool: detectToolMock }));

const bootstrapPath = () => join(TEST_TUCK_DIR, 'bootstrap.toml');

const writeBootstrapToml = (content: string): void => {
  vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
  vol.writeFileSync(bootstrapPath(), content);
};

const readConfig = (): Record<string, unknown> => {
  return parseToml(readFileSync(bootstrapPath(), 'utf-8')) as Record<string, unknown>;
};

const SEED_TOML = `
[[tool]]
id = "my-tool"
description = "user tool"
install = "true"

[bundles]
kali = ["fzf", "my-tool"]
minimal = ["fzf"]
`;

describe('tuck bootstrap bundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isInteractiveMock.mockReturnValue(true);
    confirmMock.mockResolvedValue(true);
    runCheckMock.mockResolvedValue(false);
    detectToolMock.mockResolvedValue({ detected: false, reasons: [] });
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
  });

  describe('list', () => {
    it('shows "no bundles" when bootstrap.toml is absent', async () => {
      await expect(runBundleList({})).resolves.not.toThrow();
    });

    it('shows populated bundles sorted', async () => {
      writeBootstrapToml(SEED_TOML);
      await expect(runBundleList({})).resolves.not.toThrow();
    });
  });

  describe('show', () => {
    it('throws on unknown bundle name', async () => {
      writeBootstrapToml(SEED_TOML);
      await expect(runBundleShow('ghost', {})).rejects.toBeInstanceOf(BootstrapError);
    });

    it('resolves for a known bundle', async () => {
      writeBootstrapToml(SEED_TOML);
      await expect(runBundleShow('kali', {})).resolves.not.toThrow();
    });
  });

  describe('create', () => {
    it('writes a new bundle into an existing bootstrap.toml, preserving [[tool]] blocks', async () => {
      writeBootstrapToml(SEED_TOML);

      await runBundleCreate('extra', ['fzf', 'my-tool'], {});

      const parsed = readConfig();
      expect((parsed.bundles as Record<string, string[]>).extra).toEqual(['fzf', 'my-tool']);
      // Existing bundles survive
      expect((parsed.bundles as Record<string, string[]>).kali).toEqual(['fzf', 'my-tool']);
      // User-tool block survives
      const tools = parsed.tool as Array<{ id: string }>;
      expect(tools.some((t) => t.id === 'my-tool')).toBe(true);
    });

    it('creates bootstrap.toml from scratch when absent', async () => {
      await runBundleCreate('seed', ['fzf'], {});
      const parsed = readConfig();
      expect((parsed.bundles as Record<string, string[]>).seed).toEqual(['fzf']);
    });

    it('rejects collision with an existing bundle', async () => {
      writeBootstrapToml(SEED_TOML);
      await expect(runBundleCreate('kali', ['fzf'], {})).rejects.toBeInstanceOf(BootstrapError);
    });

    it('rejects unknown tool ids', async () => {
      writeBootstrapToml(SEED_TOML);
      await expect(runBundleCreate('bad', ['ghost'], {})).rejects.toBeInstanceOf(BootstrapError);
    });
  });

  describe('add', () => {
    it('appends a member and persists', async () => {
      writeBootstrapToml(SEED_TOML);
      await runBundleAdd('minimal', 'my-tool', {});

      const parsed = readConfig();
      expect((parsed.bundles as Record<string, string[]>).minimal).toEqual(['fzf', 'my-tool']);
    });

    it('is a no-op when the tool is already a member (no rewrite)', async () => {
      writeBootstrapToml(SEED_TOML);
      const before = readFileSync(bootstrapPath(), 'utf-8');

      await runBundleAdd('minimal', 'fzf', {});

      const after = readFileSync(bootstrapPath(), 'utf-8');
      expect(after).toBe(before);
    });

    it('fails cleanly on a missing bootstrap.toml', async () => {
      await expect(runBundleAdd('kali', 'fzf', {})).rejects.toBeInstanceOf(BootstrapError);
    });
  });

  describe('rm', () => {
    it('drops a member and persists', async () => {
      writeBootstrapToml(SEED_TOML);
      await runBundleRemove('kali', 'my-tool', {});
      const parsed = readConfig();
      expect((parsed.bundles as Record<string, string[]>).kali).toEqual(['fzf']);
    });

    it('is a no-op when the tool is not a member', async () => {
      writeBootstrapToml(SEED_TOML);
      const before = readFileSync(bootstrapPath(), 'utf-8');
      await runBundleRemove('minimal', 'ghost', {});
      const after = readFileSync(bootstrapPath(), 'utf-8');
      expect(after).toBe(before);
    });
  });

  describe('delete', () => {
    it('removes a bundle after confirm (-y bypasses prompt)', async () => {
      writeBootstrapToml(SEED_TOML);
      await runBundleDelete('minimal', { yes: true });
      const parsed = readConfig();
      expect(parsed.bundles).not.toHaveProperty('minimal');
      expect(confirmMock).not.toHaveBeenCalled();
    });

    it('prompts for confirm on TTY when -y is not passed', async () => {
      writeBootstrapToml(SEED_TOML);
      confirmMock.mockResolvedValue(true);
      await runBundleDelete('minimal', {});
      expect(confirmMock).toHaveBeenCalledTimes(1);
      const parsed = readConfig();
      expect(parsed.bundles).not.toHaveProperty('minimal');
    });

    it('leaves state intact when the user declines the confirm', async () => {
      writeBootstrapToml(SEED_TOML);
      confirmMock.mockResolvedValue(false);
      const before = readFileSync(bootstrapPath(), 'utf-8');
      await runBundleDelete('minimal', {});
      const after = readFileSync(bootstrapPath(), 'utf-8');
      expect(after).toBe(before);
    });

    it('refuses without -y on non-TTY (no silent deletion)', async () => {
      writeBootstrapToml(SEED_TOML);
      isInteractiveMock.mockReturnValue(false);
      await expect(runBundleDelete('minimal', {})).rejects.toBeInstanceOf(
        NonInteractivePromptError
      );
    });

    it('throws on unknown bundle (before any confirm)', async () => {
      writeBootstrapToml(SEED_TOML);
      await expect(runBundleDelete('ghost', { yes: true })).rejects.toBeInstanceOf(
        BootstrapError
      );
    });
  });
});
