import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Explicit fixture -> schema -> expected validity table, relative to contracts/.
const fixtureCases = [
  ['common.sample.json', 'sync/common.schema.json', true],
  ['device-login.request.with-2fa.json', 'sync/device-login.request.schema.json', true],
  ['device-refresh.request.rotate.json', 'sync/device-refresh.request.schema.json', true],
  ['device-token.response.login.json', 'sync/device-token.response.schema.json', true],
  ['error-codes.document-locked.json', 'sync/error-codes.schema.json', true],
  ['error-codes.version-conflict.json', 'sync/error-codes.schema.json', true],
  ['error.response.schema-mismatch.json', 'sync/error.response.schema.json', true],
  ['error.response.validation.json', 'sync/error.response.schema.json', true],
  ['manifest.response.sales-user.json', 'sync/manifest.response.schema.json', true],
  ['pull.request.initial-and-incremental.json', 'sync/pull.request.schema.json', true],
  ['pull.response.page.json', 'sync/pull.response.schema.json', true],
  ['push.request.outbox-batch.json', 'sync/push.request.schema.json', true],
  ['push.response.mixed.json', 'sync/push.response.schema.json', true],
  ['push.response.rejected-and-merged.json', 'sync/push.response.schema.json', true],
  ['tombstone.out-of-scope.json', 'sync/tombstone.schema.json', true],
  ['tombstone.soft-deleted.json', 'sync/tombstone.schema.json', true],
  ['invalid/device-refresh.request.with-fingerprint.json', 'sync/device-refresh.request.schema.json', false],
  ['invalid/device-token.response.missing-refresh-token.json', 'sync/device-token.response.schema.json', false],
  ['invalid/manifest.response.missing-visibility-generation.json', 'sync/manifest.response.schema.json', false],
  ['invalid/offline-manifest.delete-field-merge.json', 'offline-manifest.schema.json', false],
  ['invalid/offline-manifest.field-merge-without-derived-fields.json', 'offline-manifest.schema.json', false],
  ['invalid/offline-manifest.global-scope-without-activation.json', 'offline-manifest.schema.json', false],
  ['invalid/pull.request.cursor-without-gen.json', 'sync/pull.request.schema.json', false],
  ['invalid/pull.request.numeric-txid.json', 'sync/pull.request.schema.json', false],
  ['invalid/pull.response.reset-without-reason.json', 'sync/pull.response.schema.json', false],
  ['invalid/push.request.create-with-base-version.json', 'sync/push.request.schema.json', false],
  ['invalid/push.request.delete-with-changed-fields.json', 'sync/push.request.schema.json', false],
  ['invalid/push.request.duplicate-resolution-merge.json', 'sync/push.request.schema.json', false],
  ['invalid/push.request.payload-with-version.json', 'sync/push.request.schema.json', false],
  ['invalid/push.response.applied-without-version.json', 'sync/push.response.schema.json', false],
  ['invalid/push.response.conflict-without-detail.json', 'sync/push.response.schema.json', false],
  ['invalid/push.response.duplicate-not-replayed.json', 'sync/push.response.schema.json', false],
  ['invalid/push.response.locked-with-keep-mine.json', 'sync/push.response.schema.json', false],
  ['invalid/tombstone.unknown-reason.json', 'sync/tombstone.schema.json', false],
];

let passed = 0;
let failed = 0;
const line = (ok, file, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${file}${detail ? `: ${detail.replace(/\s+/g, ' ')}` : ''}`);
};
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));

// npm exec exposes its temporary packages through PATH, not ESM's import paths.
function dependencies() {
  for (const bin of (process.env.PATH ?? '').split(path.delimiter)) {
    if (path.basename(bin) !== '.bin' || path.basename(path.dirname(bin)) !== 'node_modules') continue;
    const require = createRequire(path.join(path.dirname(bin), '__contracts__.cjs'));
    try {
      if (require('ajv/package.json').version !== '8.17.1'
        || require('ajv-formats/package.json').version !== '3.0.1') continue;
      return [require('ajv/dist/2020.js').default, require('ajv-formats')];
    } catch {
      // Continue to the npm exec package directory.
    }
  }
  throw new Error('Run npm run contracts:validate to provision Ajv 8.17.1 and ajv-formats 3.0.1.');
}

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesIn(file));
    else files.push(file);
  }
  return files.sort();
}

try {
  const [Ajv2020, addFormats] = dependencies();
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  addFormats(ajv);
  const schemas = new Map();
  const validators = new Map();
  const schemaFiles = (await filesIn('sync')).filter((file) => file.endsWith('.schema.json'));
  schemaFiles.push('offline-manifest.schema.json');
  // Register every local ID before compiling any cross-schema references.
  for (const file of schemaFiles) {
    try {
      const schema = await readJson(file);
      ajv.addSchema(schema);
      schemas.set(file, schema);
    } catch (error) {
      line(false, file, error.message);
    }
  }
  for (const [file, schema] of schemas) {
    try {
      validators.set(file, ajv.getSchema(schema.$id) ?? ajv.compile(schema));
      line(true, file, 'strict compilation');
    } catch (error) {
      line(false, file, error.message);
    }
  }
  const cases = fixtureCases.map(([file, schema, valid]) => [`sync/fixtures/${file}`, schema, valid]);
  const mapped = new Set(cases.map(([file]) => file));
  if (mapped.size !== cases.length) throw new Error('Duplicate fixture mapping.');
  for (const file of await filesIn('sync/fixtures')) {
    if (!mapped.has(file)) line(false, file, 'unmapped fixture');
  }
  cases.push(['offline-manifest.json', 'offline-manifest.schema.json', true]);
  for (const [file, schema, expected] of cases) {
    try {
      const data = await readJson(file);
      const validate = validators.get(schema);
      if (!validate) throw new Error(`Schema did not compile: ${schema}`);
      const valid = validate(data);
      line(valid === expected, file, valid === expected
        ? (expected ? 'accepted' : 'rejected as expected')
        : (expected ? ajv.errorsText(validate.errors) : 'invalid fixture was accepted'));
    } catch (error) {
      line(false, file, error.message);
    }
  }
} catch (error) {
  line(false, 'contracts validation', error.message);
}
console.log(`Summary: ${passed} PASS, ${failed} FAIL`);
process.exitCode = failed ? 1 : 0;
