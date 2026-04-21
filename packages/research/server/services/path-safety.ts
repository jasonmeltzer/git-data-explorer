// Source: Node fs.realpath docs + OWASP Path Traversal Cheat Sheet
import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve userPath relative to baseDir, then canonicalize both via realpath,
 * then require the resolved path to start with the canonical base + separator.
 *
 * Rejects: '..', absolute-path override (per Pitfall 4 — path.resolve ignores base when
 * userPath is absolute), symlink escape (realpath follows symlinks before the check),
 * nonexistent paths (path_does_not_exist). Accepts base itself (userPath='.').
 *
 * The trailing-sep check (baseReal + path.sep) prevents '/tmp/foo' from matching
 * '/tmp/foobar' — a subtle bug that a bare startsWith() would introduce.
 */
export function sandboxPath(baseDir: string, userPath: string): string {
  if (!baseDir) throw new Error('base_dir_not_configured');
  const baseReal = fs.realpathSync(baseDir); // throws if base missing
  const joined = path.resolve(baseReal, userPath);
  let joinedReal: string;
  try {
    joinedReal = fs.realpathSync(joined);
  } catch {
    throw new Error('path_does_not_exist');
  }
  const baseWithSep = baseReal.endsWith(path.sep) ? baseReal : baseReal + path.sep;
  if (joinedReal !== baseReal && !joinedReal.startsWith(baseWithSep)) {
    throw new Error('path_escapes_base');
  }
  return joinedReal;
}
