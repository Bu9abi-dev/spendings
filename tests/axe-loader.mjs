// Loads axe-core for the accessibility scans (verify-a11y.mjs, verify-arabic.mjs). axe-core is NOT part of the app:
// it is found on NODE_PATH (npm i -g axe-core), in $AXE_CORE, or fetched once with `npm pack axe-core` into the
// temp folder. Returns the script text, or null when it can't be had (no network): callers skip the axe part.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

export function loadAxe() {
  const tries = [process.env.AXE_CORE, () => require.resolve('axe-core/axe.min.js')];
  for (const t of tries) {
    try { const f = typeof t === 'function' ? t() : t; if (f && fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); } catch { /* next */ }
  }
  try {
    const dir = path.join(os.tmpdir(), 'spendings-axe');
    const file = path.join(dir, 'package', 'axe.min.js');
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      const tgz = execFileSync('npm', ['pack', 'axe-core@4.10.2', '--silent'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop();
      execFileSync('tar', ['xzf', tgz], { cwd: dir });
    }
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
}
