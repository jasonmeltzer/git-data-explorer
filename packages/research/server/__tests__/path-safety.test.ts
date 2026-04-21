import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sandboxPath } from '../services/path-safety.js';

let tmpBase: string;
let baseDir: string;
let outsideDir: string;

beforeAll(() => {
  // Create a temp root with two dirs: one for the sandbox base, one outside.
  // Use realpathSync on tmpBase to resolve macOS /var -> /private/var symlink so
  // test assertions match the canonical paths that sandboxPath returns.
  tmpBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'path-safety-test-')));
  baseDir = path.join(tmpBase, 'imports');
  outsideDir = path.join(tmpBase, 'evil-target');

  fs.mkdirSync(baseDir);
  fs.mkdirSync(path.join(baseDir, 'sub'));
  fs.mkdirSync(outsideDir);

  // Test 4: create a symlink inside baseDir that points outside
  fs.symlinkSync(outsideDir, path.join(baseDir, 'link'));
});

afterAll(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('sandboxPath', () => {
  it('1. valid subdirectory inside base returns canonical subdirectory', () => {
    const result = sandboxPath(baseDir, 'sub');
    expect(result).toBe(path.join(baseDir, 'sub'));
  });

  it('2. .. traversal is rejected (path_escapes_base or path_does_not_exist)', () => {
    expect(() => sandboxPath(baseDir, '../outside')).toThrow(
      /path_escapes_base|path_does_not_exist/
    );
  });

  it('3. absolute path override (/etc) is rejected with path_escapes_base (Pitfall 4)', () => {
    // path.resolve('/safe/base', '/etc') returns '/etc' which is outside base
    expect(() => sandboxPath(baseDir, '/etc')).toThrow('path_escapes_base');
  });

  it('4. symlink that escapes base is rejected with path_escapes_base', () => {
    // baseDir/link -> outsideDir (outside baseDir)
    expect(() => sandboxPath(baseDir, 'link')).toThrow('path_escapes_base');
  });

  it('5. nonexistent path throws path_does_not_exist', () => {
    expect(() => sandboxPath(baseDir, 'does-not-exist')).toThrow('path_does_not_exist');
  });

  it('6. base itself (userPath=".") returns baseReal (boundary case: joinedReal === baseReal)', () => {
    const result = sandboxPath(baseDir, '.');
    expect(result).toBe(baseDir);
  });

  it('7. missing base dir throws (realpathSync fails on nonexistent base)', () => {
    expect(() => sandboxPath('/nope/not/there', 'sub')).toThrow();
  });

  it('8. empty baseDir throws base_dir_not_configured', () => {
    expect(() => sandboxPath('', 'sub')).toThrow('base_dir_not_configured');
  });

  it('9. trailing-sep safety: /tmp/foo does NOT match /tmp/foobar', () => {
    // Create /tmp/foobar sibling to base to test the sep check
    const siblingBase = path.join(tmpBase, 'foo');
    const siblingTarget = path.join(tmpBase, 'foobar');
    fs.mkdirSync(siblingBase);
    fs.mkdirSync(siblingTarget);

    try {
      // Without the trailing-sep check, startsWith('/tmp/foo') would match '/tmp/foobar'
      // With the check (startsWith('/tmp/foo/')), it correctly rejects
      expect(() => sandboxPath(siblingBase, '../foobar')).toThrow(
        /path_escapes_base|path_does_not_exist/
      );
    } finally {
      fs.rmdirSync(siblingBase);
      fs.rmdirSync(siblingTarget);
    }
  });
});
