#!/usr/bin/env node
/**
 * Runs the Gradle wrapper from the android/ directory.
 *
 * The npm scripts used to call `gradlew.bat` directly, which only exists on
 * Windows — on macOS and Linux that fails with "command not found". npm runs
 * scripts through cmd.exe on Windows and sh elsewhere, so neither spelling of
 * the wrapper works everywhere. Picking it here keeps one script per task
 * instead of one per platform.
 */
const {spawnSync} = require('node:child_process');
const path = require('node:path');

const isWindows = process.platform === 'win32';
const wrapper = isWindows ? 'gradlew.bat' : './gradlew';
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('usage: node scripts/gradle.js <task> [...]');
  process.exit(2);
}

const result = spawnSync(wrapper, args, {
  cwd: path.join(__dirname, '..', 'android'),
  stdio: 'inherit',
  // cmd.exe needs a shell to resolve the .bat; sh does not, and running without
  // one avoids quoting surprises in task names.
  shell: isWindows,
});

if (result.error) {
  console.error(`Could not run ${wrapper}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
