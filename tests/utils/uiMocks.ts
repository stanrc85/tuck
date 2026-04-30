/**
 * Canonical mock shapes for `src/ui` exports.
 *
 * Tests that mock `../../src/ui/index.js` should use these helpers instead of
 * hand-rolling the shapes inline. Centralising them means a single update here
 * propagates to every test the next time the prompts/logger/colors API grows.
 *
 * Pattern:
 *   import { mockOutro, mockFormatCount, mockColors, mockPromptsLog } from '../utils/uiMocks.js';
 *
 *   vi.mock('../../src/ui/index.js', () => ({
 *     prompts: { outro: mockOutro(), log: mockPromptsLog(), ... },
 *     formatCount: mockFormatCount,
 *     colors: mockColors(),
 *     ...
 *   }));
 */
import { vi, type Mock } from 'vitest';

/**
 * `prompts.outro` is a callable with `.warning` and `.error` variants
 * (see src/ui/prompts.ts). A bare `vi.fn()` mock breaks the moment the SUT
 * invokes `outro.warning(...)` or `outro.error(...)` — use this shape instead.
 */
export type OutroMock = Mock & { warning: Mock; error: Mock };

/**
 * Build an `outro` mock. Pass overrides when the test needs to assert on a
 * specific variant — e.g. `mockOutro({ warning: warnMock })` lets the test
 * inspect calls to `outro.warning(...)` separately from the success path.
 */
export function mockOutro(overrides?: {
  base?: Mock;
  warning?: Mock;
  error?: Mock;
}): OutroMock {
  return Object.assign(overrides?.base ?? vi.fn(), {
    warning: overrides?.warning ?? vi.fn(),
    error: overrides?.error ?? vi.fn(),
  }) as OutroMock;
}

/**
 * Mirrors `formatCount` in src/ui/index.ts — singular/plural pluraliser.
 */
export const mockFormatCount = (n: number, singular: string, plural?: string): string =>
  `${n} ${n === 1 ? singular : plural ?? `${singular}s`}`;

/**
 * Passthrough color stubs covering every key on src/ui/theme.ts `colors`.
 * Returning the full superset means tests don't need to enumerate which color
 * keys their command happens to call.
 */
export function mockColors(): Record<string, (s: string) => string> {
  const passthrough = (s: string): string => s;
  return {
    brand: passthrough,
    brandBold: passthrough,
    brandDim: passthrough,
    brandBg: passthrough,
    success: passthrough,
    warning: passthrough,
    error: passthrough,
    info: passthrough,
    muted: passthrough,
    bold: passthrough,
    highlight: passthrough,
    cyan: passthrough,
    green: passthrough,
    yellow: passthrough,
    red: passthrough,
    blue: passthrough,
    dim: passthrough,
    white: passthrough,
  };
}

/**
 * Shape matching `prompts.log` in src/ui/prompts.ts.
 */
export interface PromptsLogMock {
  info: Mock;
  success: Mock;
  warning: Mock;
  error: Mock;
  step: Mock;
  message: Mock;
}

export function mockPromptsLog(): PromptsLogMock {
  return {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  };
}
