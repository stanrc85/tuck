/**
 * Spinner utilities for tuck CLI
 * Uses @clack/prompts spinner when attached to a TTY; falls back to plain
 * log output otherwise so automated/scripted invocations don't hang on
 * @clack's stdin readline setup.
 */

import * as p from '@clack/prompts';
import logSymbols from 'log-symbols';
import { colors as c } from './theme.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SpinnerInstance {
  start: (text?: string) => void;
  stop: () => void;
  succeed: (text?: string) => void;
  fail: (text?: string) => void;
  warn: (text?: string) => void;
  info: (text?: string) => void;
  text: (text: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactivity Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether the process is attached to an interactive TTY on both stdin and
 * stdout. @clack's spinner sets up a readline interface and keypress listener
 * on stdin (via @clack/core's `block()`), which can hang when stdin is a pipe,
 * /dev/null, or a TTY left in a non-canonical state by a prior command.
 *
 * `TUCK_NON_INTERACTIVE=1` forces the non-interactive fallback even when a
 * TTY is detected — useful for CI, scripts, or debugging.
 */
export const isInteractive = (): boolean => {
  if (process.env.TUCK_NON_INTERACTIVE === '1' || process.env.TUCK_NON_INTERACTIVE === 'true') {
    return false;
  }
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
};

// ─────────────────────────────────────────────────────────────────────────────
// Non-Interactive Fallback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Plain-log fallback spinner for non-TTY execution.
 *
 * Emits one line per terminal state transition (succeed/fail/warn/info), or a
 * single info line on stop if no terminal state was reached. start/text are
 * silent — this keeps output readable when a caller drives a tight loop of
 * short-lived spinners (e.g. restore iterating over every tracked file).
 */
const createNonInteractiveSpinner = (initialText?: string): SpinnerInstance => {
  let currentText = initialText || '';
  let settled = false;

  return {
    start: (text?: string) => {
      currentText = text || currentText || 'Loading...';
      settled = false;
    },

    stop: () => {
      if (!settled && currentText) {
        console.log(logSymbols.info, c.info(currentText));
      }
      settled = true;
    },

    succeed: (text?: string) => {
      console.log(logSymbols.success, c.success(text || currentText));
      settled = true;
    },

    fail: (text?: string) => {
      console.log(logSymbols.error, c.error(text || currentText));
      settled = true;
    },

    warn: (text?: string) => {
      console.log(logSymbols.warning, c.warning(text || currentText));
      settled = true;
    },

    info: (text?: string) => {
      console.log(logSymbols.info, c.info(text || currentText));
      settled = true;
    },

    text: (text: string) => {
      currentText = text;
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Create Spinner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Events @clack/prompts' spinner() registers on `process` in its constructor
 * and never removes. Tuck snapshots listeners before the clack call, diffs
 * after, and tears down those exact handlers when the spinner is stopped —
 * otherwise a loop of short-lived spinners (e.g. restore iterating per file)
 * trips Node's default 10-per-event MaxListeners warning by iteration ~10.
 */
const CLACK_PROCESS_EVENTS = [
  'uncaughtExceptionMonitor',
  'unhandledRejection',
  'SIGINT',
  'SIGTERM',
  'exit',
] as const;

type ProcessListener = (...args: unknown[]) => void;

/**
 * Create a spinner instance. In interactive TTY mode this is @clack/prompts'
 * animated spinner; in non-interactive mode it falls back to plain log lines
 * to avoid hanging on stdin setup.
 */
export const createSpinner = (initialText?: string): SpinnerInstance => {
  if (!isInteractive()) {
    return createNonInteractiveSpinner(initialText);
  }

  const before = new Map<string, Set<ProcessListener>>();
  for (const ev of CLACK_PROCESS_EVENTS) {
    before.set(ev, new Set(process.listeners(ev as NodeJS.Signals) as ProcessListener[]));
  }

  const spinner = p.spinner();

  const added = new Map<string, ProcessListener[]>();
  for (const ev of CLACK_PROCESS_EVENTS) {
    const prior = before.get(ev)!;
    const now = process.listeners(ev as NodeJS.Signals) as ProcessListener[];
    const diff = now.filter((fn) => !prior.has(fn));
    if (diff.length > 0) added.set(ev, diff);
  }

  let listenersRemoved = false;
  const removeClackListeners = (): void => {
    if (listenersRemoved) return;
    listenersRemoved = true;
    for (const [ev, fns] of added) {
      for (const fn of fns) {
        process.removeListener(ev as NodeJS.Signals, fn);
      }
    }
  };

  let currentText = initialText || '';
  let started = false;

  return {
    start: (text?: string) => {
      currentText = text || currentText || 'Loading...';
      spinner.start(currentText);
      started = true;
    },

    stop: () => {
      if (started) {
        spinner.stop(currentText);
        started = false;
      }
      removeClackListeners();
    },

    succeed: (text?: string) => {
      if (started) {
        spinner.stop(c.success(text || currentText));
        started = false;
      } else {
        console.log(logSymbols.success, c.success(text || currentText));
      }
      removeClackListeners();
    },

    fail: (text?: string) => {
      if (started) {
        spinner.stop(c.error(text || currentText));
        started = false;
      } else {
        console.log(logSymbols.error, c.error(text || currentText));
      }
      removeClackListeners();
    },

    warn: (text?: string) => {
      if (started) {
        spinner.stop(c.warning(text || currentText));
        started = false;
      } else {
        console.log(logSymbols.warning, c.warning(text || currentText));
      }
      removeClackListeners();
    },

    info: (text?: string) => {
      if (started) {
        spinner.stop(c.info(text || currentText));
        started = false;
      } else {
        console.log(logSymbols.info, c.info(text || currentText));
      }
      removeClackListeners();
    },

    text: (text: string) => {
      currentText = text;
      if (started) {
        spinner.message(text);
      }
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// With Spinner Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute an async function with a spinner
 * Automatically shows success/failure based on result
 */
export const withSpinner = async <T>(
  text: string,
  fn: () => Promise<T>,
  options?: {
    successText?: string;
    failText?: string;
  }
): Promise<T> => {
  const spinner = createSpinner(text);
  spinner.start();

  try {
    const result = await fn();
    spinner.succeed(options?.successText || text);
    return result;
  } catch (error) {
    spinner.fail(options?.failText || text);
    throw error;
  }
};
