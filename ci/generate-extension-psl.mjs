#!/usr/bin/env node
// Generate the extension's checked-in PSL runtime data from the reviewed source.
// This intentionally accepts only the pinned Mozilla snapshot; updating it is a
// separate reviewed change, never a runtime operation.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const check = process.argv[2] === '--check';
const sourceArg = check ? process.argv[3] : process.argv[2];
const outputArg = check ? process.argv[4] : process.argv[3];
const root = resolve(new URL('..', import.meta.url).pathname);
const sourcePath = sourceArg ? resolve(sourceArg) : resolve(root, 'extension/shared/lib/public_suffix_list.dat');
const outputPath = outputArg ? resolve(outputArg) : resolve(root, 'extension/shared/lib/public_suffix_list.js');
const expected = {
  sourceUrl: 'https://publicsuffix.org/list/public_suffix_list.dat',
  version: '2026-05-14_08-35-31_UTC',
  commit: 'e452c7058d6946bd76952b128c12f5ce87a5acb8',
  sha256: '6f7f7d9e8c68447f1c74095a12574b7fee46b0cd759c518a659aee0615d8e118',
};

const source = readFileSync(sourcePath, 'utf8');
const hash = createHash('sha256').update(source).digest('hex');
if (hash !== expected.sha256) throw new Error(`PSL source SHA-256 mismatch: ${hash}`);
if (!source.includes(`https://publicsuffix.org/list/public_suffix_list.dat`)) throw new Error('PSL source URL provenance missing');
const version = source.match(/^\/\/ VERSION: (.+)$/m)?.[1];
const commit = source.match(/^\/\/ COMMIT: ([0-9a-f]{40})$/m)?.[1];
if (version !== expected.version || commit !== expected.commit) throw new Error('PSL source version/commit mismatch');

const rules = source.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('//'));
if (!rules.length) throw new Error('PSL source has no rules');
for (const rule of rules) {
  if (!/^(?:!|\*\.)?[^^\s.]+(?:\.[^^\s.]+)*$/.test(rule)) {
    // The source is authoritative; this guard only rejects accidental control
    // characters or empty labels while allowing Unicode PSL labels.
    if (/\s|\.\.|^\.|\.$/.test(rule)) throw new Error(`Malformed PSL rule: ${rule}`);
  }
}

const payload = `// Generated from public_suffix_list.dat; do not edit by hand.\n// Source: ${expected.sourceUrl}\n// Version: ${expected.version}\n// Commit: ${expected.commit}\n// Source SHA-256: ${expected.sha256}\nglobalThis.KeygrainPublicSuffixData = Object.freeze({\n  sourceUrl: ${JSON.stringify(expected.sourceUrl)},\n  version: ${JSON.stringify(expected.version)},\n  commit: ${JSON.stringify(expected.commit)},\n  sourceSha256: ${JSON.stringify(expected.sha256)},\n  rules: Object.freeze(${JSON.stringify(rules)}),\n});\n`;
if (check) {
  const existing = readFileSync(outputPath, 'utf8');
  if (existing !== payload) throw new Error(`Generated PSL module differs from ${outputPath}`);
  console.log(`Checked ${outputPath} (${rules.length} rules)`);
} else {
  writeFileSync(outputPath, payload);
  console.log(`Generated ${outputPath} (${rules.length} rules)`);
}
