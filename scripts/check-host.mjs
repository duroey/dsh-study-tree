import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const CHECK_LIMITS = { cliTimeoutMs: 60_000, cliOutputBytes: 8 * 1024 * 1024 };
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

/**
 * Reads a JSON manifest without executing a package or browser bundle.
 *
 * Args:
 *   filename: Installed manifest to inspect.
 *
 * Returns:
 *   The parsed manifest.
 */
async function readManifest(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

/**
 * Resolves installed packages from the runtime and its actual dependency roots.
 *
 * Args:
 *   anchors: Manifest paths whose Node resolution paths belong to this runtime.
 *   name: Package name to resolve.
 *
 * Returns:
 *   Manifest facts and the actual installed package directory, or undefined.
 */
async function installedPackage(anchors, name) {
  for (const anchor of anchors) {
    let filename;
    try {
      filename = createRequire(anchor).resolve(`${name}/package.json`);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') continue;
      throw error;
    }
    return { name, filename, directory: dirname(filename), manifest: await readManifest(filename) };
  }
  return undefined;
}

/**
 * Reads shipped declaration and top-level JavaScript files as inert text.
 *
 * Args:
 *   info: Resolved package metadata, or absence for a removed package.
 *
 * Returns:
 *   Evidence records; no imported code and no browser globals are evaluated.
 */
async function packageEvidence(info) {
  if (!info) return [];
  const files = [];
  const pending = [join(info.directory, 'lib')];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const filename = join(directory, entry.name);
      if (entry.isDirectory() && (entry.name === 'types' || directory.includes(`${join('lib', 'types')}`))) {
        pending.push(filename);
      } else if (entry.isFile() && (entry.name.endsWith('.d.ts') || (directory === join(info.directory, 'lib') && entry.name.endsWith('.js')))) {
        files.push({ package: info.name, filename, text: await readFile(filename, 'utf8') });
      }
    }
  }
  return files;
}

/**
 * Finds a public contract or shipped use site without mistaking it for execution.
 *
 * Args:
 *   files: Installed package declaration and code records.
 *   predicate: Predicate identifying the requested source contract.
 *   runtime: Root used to make evidence paths readable.
 *
 * Returns:
 *   A capability observation and its source file, when found.
 */
function capability(files, predicate, runtime) {
  const evidence = files.find(predicate);
  return {
    available: evidence !== undefined,
    ...(evidence ? { evidence: relative(runtime, evidence.filename) } : {}),
  };
}

/**
 * Confirms the packed plugin appears in an official composed profile dump.
 *
 * Args:
 *   runtime: Runtime working directory.
 *   dsh: Resolved CLI package.
 *   profile: Isolated profile previously installed through the official CLI.
 *   pluginName: Bundle name expected in the composed configuration.
 *
 * Returns:
 *   A composition check; successful composition does not claim UI activation.
 */
async function checkComposition(runtime, dsh, profile, pluginName) {
  if (!profile) {
    return { checked: false, passed: false, reason: 'Pass --profile after installing the packed bundle to check composition.' };
  }
  const bin = typeof dsh.manifest.bin === 'string' ? dsh.manifest.bin : dsh.manifest.bin?.dsh;
  if (typeof bin !== 'string') throw new Error('The installed DSH package has no dsh CLI entry.');
  try {
    const result = await execute(process.execPath, [
      '--expose-internals', join(dsh.directory, bin), '--profile', profile, '--dump-config',
    ], {
      cwd: runtime,
      timeout: CHECK_LIMITS.cliTimeoutMs,
      maxBuffer: CHECK_LIMITS.cliOutputBytes,
      env: process.env,
    });
    const escaped = pluginName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const present = new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?name:\\s*['\"]?${escaped}['\"]?\\s*(?:\\n|$)`).test(result.stdout);
    return {
      checked: true,
      passed: present,
      method: 'official-cli-dump-config',
      pluginRowPresent: present,
      profile,
      ...(present ? {} : { reason: 'The packed plugin is absent from the composed profile.' }),
    };
  } catch (error) {
    return {
      checked: true,
      passed: false,
      method: 'official-cli-dump-config',
      profile,
      reason: `DSH could not compose this profile (${error.code ?? 'unknown'}). Run --dump-config locally for the full diagnostic.`,
    };
  }
}

/**
 * Checks real installed artifacts and emits one machine-readable report.
 *
 * Returns:
 *   A report whose UI acceptance status remains explicitly unverified.
 *
 * Throws:
 *   Error: If the runtime cannot be inspected.
 */
async function checkHost() {
  const { values } = parseArgs({
    options: {
      runtime: { type: 'string', default: process.env.DSH_RUNTIME || process.cwd() },
      profile: { type: 'string' },
    },
    allowPositionals: false,
  });
  const runtime = resolve(values.runtime);
  const anchors = [join(runtime, 'package.json')];
  const dsh = await installedPackage(anchors, '@deepseek-ai/dsh');
  if (!dsh) throw new Error(`No installed @deepseek-ai/dsh is resolvable from ${runtime}.`);
  anchors.unshift(dsh.filename);
  const web = await installedPackage(anchors, '@deepseek-ai/dsh-web-app');
  if (web) anchors.unshift(web.filename);
  // A neighboring old or new runtime must not supply evidence for this one.
  const declaredDependencies = {
    ...dsh.manifest.dependencies,
    ...web?.manifest.dependencies,
  };
  const names = [
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-workspace',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-connection',
  ];
  const packages = await Promise.all(names
    .filter((name) => Object.hasOwn(declaredDependencies, name))
    .map((name) => installedPackage(anchors, name)));
  const files = (await Promise.all(packages.map(packageEvidence))).flat();
  const sessions = files.filter((file) => file.filename.endsWith(join('contract', 'sessions.d.ts')));
  const session = files.filter((file) => file.filename.endsWith(join('contract', 'session.d.ts')));
  const capabilities = {
    sessionFork: capability(sessions, (file) => /^\s*fork\s*\(/m.test(file.text), runtime),
    sessionPrompt: capability(session, (file) => /^\s*prompt\s*\(/m.test(file.text), runtime),
    sessionCatalog: capability(sessions, (file) => /readonly\s+list\s*:/.test(file.text), runtime),
    sessionOwnership: capability(sessions, (file) => /^\s*(?:retain|binding)\s*\(/m.test(file.text), runtime),
    normalSessionNavigation: capability(files, (file) => file.filename.endsWith('.d.ts') && (/^\s*openSession\s*\(/m.test(file.text) || (file.filename.endsWith(join('contract', 'sessions.d.ts')) && /^\s*open\s*\(/m.test(file.text))), runtime),
    slotsInject: capability(files, (file) => file.filename.endsWith('.js') && /\bslots\.inject\s*\(/.test(file.text), runtime),
    slotsRegister: capability(files, (file) => file.filename.endsWith('.js') && /\bslots\.register\s*\(/.test(file.text), runtime),
    rpcHostChannel: capability(files, (file) => file.filename.endsWith('.d.ts') && /interface HostConnectionRpc/.test(file.text) && /\bhandle\s*\(/.test(file.text), runtime),
    rpcClientChannel: capability(files, (file) => file.filename.endsWith('.d.ts') && /interface ClientConnectionRpc/.test(file.text) && /\bcall\s*\(/.test(file.text), runtime),
  };
  const plugin = await readManifest(join(projectRoot, 'package.json'));
  const installation = await checkComposition(runtime, dsh, values.profile, plugin.name);
  const missing = Object.entries(capabilities).filter(([, value]) => !value.available).map(([name]) => name);
  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    checkKind: 'installed-artifact-contract-and-profile-composition',
    version: dsh.manifest.version,
    nodeVersion: process.versions.node,
    runtime,
    runtimeNodeRequirement: dsh.manifest.engines?.node ?? null,
    pluginDshRequirement: plugin.engines?.dsh ?? null,
    runtimeDependencies: Object.fromEntries(Object.entries(dsh.manifest.dependencies ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/cordis') || name === '@deepseek-ai/schemastery')),
    contractPackages: packages.filter(Boolean).map((info) => ({ name: info.name, version: info.manifest.version })),
    capabilities,
    installation,
    uiVerified: false,
    pendingLiveValidation: [
      'Select actual answer text and create a real inherited child session.',
      'Continue normal chat in the same child and fork a grandchild.',
      'Switch branches, return to the source, and restore navigation after reload.',
      'Verify parent-history isolation and normal Agent/tool presentation.',
    ],
    errors: [
      ...missing.map((name) => `Required installed contract is missing: ${name}.`),
      ...(installation.checked && !installation.passed ? [installation.reason] : []),
    ],
    ok: missing.length === 0 && (!installation.checked || installation.passed),
  };
}

try {
  const report = await checkHost();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    checkKind: 'installed-artifact-contract-and-profile-composition',
    ok: false,
    uiVerified: false,
    errors: [error instanceof Error ? error.message : String(error)],
  }, null, 2)}\n`);
  process.exitCode = 1;
}
