'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(root).filter(name => name.endsWith('.js')).map(name => path.join(root, name));
files.push(...fs.readdirSync(__dirname).filter(name => /\.(?:cjs|js)$/.test(name)).map(name => path.join(__dirname, name)));
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {stdio:'inherit'});
  if (result.error || result.status !== 0) { failed = true; console.error(result.error?.message || 'Syntax check failed: ' + file); }
}
console.log('Syntax checked ' + files.length + ' JavaScript files.');
process.exitCode = failed ? 1 : 0;
