import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const marker = join(here, '.compiled-runtime');
const name = `cli.compiled-${Date.now()}-${process.pid}${process.platform === 'win32' ? '.exe' : ''}`;
const output = join(here, name);
const temporaryMarker = `${marker}.${process.pid}.tmp`;

rmSync(marker, { force: true });
try {
  if (!existsSync(join(here, 'generated-probes.mjs'))) throw new Error('generated-probes.mjs is missing; repatch this installation');
  const result = await Bun.build({
    entrypoints: [join(here, 'cli.mjs')], target: 'bun', format: 'esm',
    compile: { outfile: output }, packages: 'external',
    external: ['*.node', '*.txt', '*.md'],
    minify: { whitespace: true }, ignoreDCEAnnotations: true,
  });
  if (!result.success) throw new Error(result.logs.map(log => log.message).join('\n'));
  writeFileSync(temporaryMarker, name + '\n');
  renameSync(temporaryMarker, marker);
  console.log('[clawgod] Compiled startup runtime ready.');
} catch (error) {
  rmSync(output, { force: true });
  rmSync(temporaryMarker, { force: true });
  console.warn(`[clawgod] Startup compilation skipped: ${error.message}. Using Bun source startup.`);
}
