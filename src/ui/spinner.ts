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
 * Create a spinner instance. In interactive TTY mode this is @clack/prompts'
 * animated spinner; in non-interactive mode it falls back to plain log lines
 * to avoid hanging on stdin setup.
 */
export const createSpinner = (initialText?: string): SpinnerInstance => {
  if (!isInteractive()) {
    return createNonInteractiveSpinner(initialText);
  }

  const spinner = p.spinner();
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
    },

    succeed: (text?: string) => {
      if (started) {
        spinner.stop(c.success(text || currentText));
        started = false;
      } else {
        console.log(logSymbols.success, c.success(text || currentText));
      }
    },

    fail: (text?: string) => {
      if (started) {
        spinner.stop(c.error(text || currentText));
        started = false;
      } else {
        console.log(logSymbols.error, c.error(text || currentText));
      }
    },

    warn: (text?: string) => {
      if (started) {
        spinner.stop(c.warning(text || currentText));
        started = false;
      } else {
        console.log(logSymbols.warning, c.warning(text || currentText));
      }
    },

    info: (text?: string) => {
      if (started) {
        spinner.stop(c.info(text || currentText));
        started = false;
      } else {
        console.log(logSymbols.info, c.info(text || currentText));
      }
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
