import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const policy = JSON.parse(await readFile('config/dependency-policy.json', 'utf8'));

function unexpected(actual = {}, approved = []) {
  const allow = new Set(approved);
  return Object.keys(actual).filter((name) => !allow.has(name)).sort();
}

const unexpectedRuntime = unexpected(pkg.dependencies, policy.runtime);
const unexpectedDevelopment = unexpected(pkg.devDependencies, policy.development);
const missingRuntime = policy.runtime.filter((name) => !pkg.dependencies?.[name]);
const missingDevelopment = policy.development.filter((name) => !pkg.devDependencies?.[name]);

const report = {
  ok:
    unexpectedRuntime.length === 0 &&
    unexpectedDevelopment.length === 0 &&
    missingRuntime.length === 0 &&
    missingDevelopment.length === 0,
  runtime: Object.keys(pkg.dependencies || {}).sort(),
  development: Object.keys(pkg.devDependencies || {}).sort(),
  unexpectedRuntime,
  unexpectedDevelopment,
  missingRuntime,
  missingDevelopment,
  approvedFutureStorefront: policy.approvedFutureStorefront
};

console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
  console.error(
    'Dependency policy violation: update config/dependency-policy.json with an architectural reason before adding/removing packages.'
  );
  process.exit(1);
}
