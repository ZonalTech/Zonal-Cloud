/**
 * Terminal UX helpers for zone.
 *
 * No emojis (project rule). Uses ASCII status markers and picocolors for color.
 * Color is disabled automatically when stdout is not a TTY or NO_COLOR is set.
 */
import pc from 'picocolors';

const isTTY = process.stdout.isTTY === true && !process.env.NO_COLOR;

function paint(fn: (s: string) => string, s: string): string {
  return isTTY ? fn(s) : s;
}

export const ui = {
  /** Section heading. */
  heading(text: string): void {
    process.stdout.write('\n' + paint(pc.bold, text) + '\n');
  },

  /** Informational line. */
  info(text: string): void {
    process.stdout.write('  ' + text + '\n');
  },

  /** A step that is starting (no newline status yet). */
  step(text: string): void {
    process.stdout.write('  ' + paint(pc.cyan, '> ') + text + '\n');
  },

  ok(text: string): void {
    process.stdout.write('  ' + paint(pc.green, 'OK   ') + text + '\n');
  },

  warn(text: string): void {
    process.stdout.write('  ' + paint(pc.yellow, 'WARN ') + text + '\n');
  },

  fail(text: string): void {
    process.stderr.write('  ' + paint(pc.red, 'FAIL ') + text + '\n');
  },

  /** Skipped / not-applicable. */
  skip(text: string): void {
    process.stdout.write('  ' + paint(pc.dim, 'SKIP ') + text + '\n');
  },

  /** A key: value detail line. */
  detail(key: string, value: string): void {
    process.stdout.write('    ' + paint(pc.dim, key + ':') + ' ' + value + '\n');
  },

  dim(text: string): string {
    return paint(pc.dim, text);
  },

  bold(text: string): string {
    return paint(pc.bold, text);
  },

  newline(): void {
    process.stdout.write('\n');
  },
};

/** Print an error and exit. */
export function die(message: string, code = 1): never {
  ui.fail(message);
  process.exit(code);
}
