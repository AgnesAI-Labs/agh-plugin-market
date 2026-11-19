import { isUtf8 } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MiB = 1024 * 1024
const sha = /^[0-9a-f]{40}$/
const version = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const githubUrl = /^https:\/\/github\.com\/([a-z0-9][a-z0-9-]{0,38})\/([a-z0-9_.-]{1,100})$/i
const gitOptions = ['-c', 'core.hooksPath=/dev/null', '-c', 'http.followRedirects=false', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always']
const scannerConfig = fileURLToPath(new URL('./review-gitleaks.toml', import.meta.url))
const report = []
const messages = {
  PR_SECRET: 'Potential credential in PR title, description or commit changes. Rotate any exposed credential and remove it from the proposed history.',
  RELEASE_SECRET: 'Potential credential in the release tree. Rotate any exposed credential and submit a clean release.',
  SCAN_FAILED: 'Secret scanner did not complete; retry or investigate scanner availability.',
  PR_UNAVAILABLE: 'PR text or history could not be read within the review limits.',
  PR_BINARY: 'Binary PR changes are not covered by patch scanning; inspect them separately.',
  INVALID_INDEX: 'Index data is missing, over limit or invalid; see the index check.',
  TAG_MISSING: 'The public repository has no matching vX.Y.Z tag. Push the immutable release tag before proposing the version.',
  TAG_UNAVAILABLE: 'Could not fetch the exact release tag. Check that the repository and tag are public, then retry.',
  TAG_MISMATCH: 'The release tag does not resolve to the indexed commit. Update the proposal to the intended immutable release.',
  MANIFEST: 'Root package.json is missing or does not match the indexed name/version and AGH plugin declaration.',
  ENTRY: 'An entry, client descriptor or declared local asset is missing or invalid. Include the runtime files in the tagged Git tree.',
  LICENSE: 'No license declaration or license file was found. Include licensing information before listing.',
  COVERAGE: 'Tree exceeds review limits or contains links, submodules, Git LFS pointers or unsupported paths. Inspect delivery manually.',
  OPAQUE: 'Archive, native or unrecognized binary content needs manual inspection.',
  PUBLISHER: 'The publisher is outside the initial organization policy. Verify publisher identity and package ownership manually.',
  CAPABILITIES: 'Sensitive or undeclared capabilities, install scripts, runtime dependencies, or sensitive runtime APIs need manual review.',
  LIMIT: 'Too many release candidates for one review run. Split the PR into smaller batches.',
  INTERNAL: 'Review could not complete. Retry or inspect the reviewer environment.',
}

function run(program, args, options = {}) {
  return spawnSync(program, args, { maxBuffer: 4 * MiB, timeout: 60_000, ...options })
}

function git(args, { maxBuffer, input } = {}) {
  return run('git', [...gitOptions, ...args], { ...maxBuffer && { maxBuffer }, input })
}

function output(result) {
  if (result.status !== 0 || result.error) throw new Error('command failed')
  return result.stdout
}

function readIndex(ref) {
  const data = output(git(['show', `${ref}:docs/index.json`], { maxBuffer: 2 * MiB }))
  const index = JSON.parse(data)
  if (index?.format !== 1 || !Array.isArray(index.plugins)) throw new Error('index')
  return index.plugins.flatMap((row) => {
    if (!row || typeof row.name !== 'string' || !Array.isArray(row.versions) || row.versions.length === 0) throw new Error('index')
    return row.versions.map((entry) => {
      const { url, commit, type } = entry?.source ?? {}
      const match = typeof url === 'string' && githubUrl.exec(url)
      if (type !== 'git' || !match || /^\.{1,2}$|\.git$/i.test(match[2]) || typeof commit !== 'string' || !sha.test(commit) || typeof entry.version !== 'string' || !version.test(entry.version) || entry.version.length > 128) throw new Error('index')
      return { name: row.name, repo: `${match[1]}/${match[2]}`.toLowerCase(), commit, version: entry.version }
    })
  })
}

function scan(path, cwd) {
  // Suppress ALL scanner output; redaction alone does not cover filenames, context or patches.
  const result = run('gitleaks', ['dir', '--config', scannerConfig, '--gitleaks-ignore-path', join(cwd, 'empty-gitleaksignore'),
    '--ignore-gitleaks-allow', '--redact=100', '--exit-code=21', '--timeout=45', path], { cwd, stdio: 'ignore' })
  if (result.status === 0 && !result.error) return 'clean'
  return result.status === 21 && !result.error ? 'secret' : 'incomplete'
}

function finding(row, code, state) {
  if (!row.findings.some((entry) => entry.code === code)) row.findings.push({ code, state })
}

function checkedScan(row, path, cwd, secretCode) {
  const result = scan(path, cwd)
  if (result === 'secret') finding(row, secretCode, 'failed')
  if (result === 'incomplete') finding(row, 'SCAN_FAILED', 'incomplete')
}

function reviewPr(row, base, head, eventFile, root) {
  try {
    const event = JSON.parse(readFileSync(eventFile))
    const pr = event.pull_request
    if (pr?.head?.sha !== head || pr?.base?.sha !== base) throw new Error('event')
    const dir = join(root, 'pr')
    mkdirSync(dir)
    writeFileSync(join(dir, 'description.txt'), `${pr.title ?? ''}\n${pr.body ?? ''}`)
    const patch = output(git(['log', '--format=medium', '--full-history', '-m', '-p', '--no-ext-diff', '--no-textconv', '--no-notes', '--no-color', `${base}..${head}`, '--'], { maxBuffer: 8 * MiB }))
    writeFileSync(join(dir, 'history.patch'), patch)
    checkedScan(row, dir, root, 'PR_SECRET')
    const stats = output(git(['log', '--format=', '--full-history', '-m', '--numstat', '-z', '--no-ext-diff', '--no-textconv', `${base}..${head}`, '--']))
    if (stats.includes(Buffer.from('-\t-\t'))) finding(row, 'PR_BINARY', 'needs-review')
  } catch {
    finding(row, 'PR_UNAVAILABLE', 'incomplete')
  }
}

function safePath(path) {
  return typeof path === 'string' && !/[\\:]/u.test(path) &&
    !Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    path.split('/').every((part) => part && !['.', '..', '.git'].includes(part.toLowerCase()))
}

function readTree(repo, commit, row) {
  const list = output(git(['-C', repo, 'ls-tree', '-rlz', commit]))
  if (!isUtf8(list)) throw new Error('coverage')
  const files = new Map()
  let total = 0
  for (const line of list.toString('utf8').split('\0')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    const match = /^100(?:644|755) blob ([0-9a-f]{40}) +([0-9]+)$/.exec(line.slice(0, tab))
    const path = line.slice(tab + 1)
    if (!match || !safePath(path) || /(?:^|\/)(?:node_modules|fixtures\/out)(?:\/|$)/.test(path)) {
      finding(row, 'COVERAGE', 'needs-review')
      continue
    }
    const size = Number(match[2]); total += size
    if (size > 8 * MiB || total > 40 * MiB || files.size >= 4_000) throw new Error('coverage')
    files.set(path, { oid: match[1], size })
  }
  return { files, total }
}

const codeFile = /\.(?:[cm]?[jt]sx?)$/i
const sensitiveCode = /(?:\bprocess\.env\b|['"](?:node:)?(?:child_process|net|tls|dgram|fs\/promises)['"]|\b(?:eval|fetch)\s*\()/
const opaqueFormat = /\.(?:zip|gz|xz|bz2|tar|7z|rar|tgz|jar|asar|pdf|docx|wasm|node|exe|dll|so|dylib|bin)$/i
const knownMedia = /\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf)$/i
function materialize(repo, tree, dir, row) {
  const requests = [...tree.files.values()].map((item) => item.oid).join('\n')
  const blobs = output(git(['-C', repo, 'cat-file', '--batch'], {
    input: requests ? `${requests}\n` : '', maxBuffer: tree.total + MiB,
  }))
  const paths = new Set()
  let cursor = 0
  for (const [path, { oid, size }] of tree.files) {
    const end = blobs.indexOf(10, cursor)
    if (end < 0 || blobs.toString('ascii', cursor, end) !== `${oid} blob ${size}` || blobs[end + size + 1] !== 10) throw new Error('blob')
    const data = blobs.subarray(end + 1, end + 1 + size)
    cursor = end + size + 2
    const text = isUtf8(data) && !data.includes(0)
    if (text && data.subarray(0, 80).toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1')) {
      finding(row, 'COVERAGE', 'needs-review')
      continue
    }
    if (opaqueFormat.test(path) || (!text && !knownMedia.test(path))) finding(row, 'OPAQUE', 'needs-review')
    if (text && codeFile.test(path) && sensitiveCode.test(data.toString('utf8'))) finding(row, 'CAPABILITIES', 'needs-review')
    const target = join(dir, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data, { flag: 'wx' })
    paths.add(path)
  }
  return paths
}

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value) => Array.isArray(value) ? value.length > 0 : record(value) ? Object.keys(value).length > 0 : Boolean(value)
const risky = ['network', 'network.publicRead', 'exec', 'secrets', 'credentials', 'managedServices', 'childAgents', 'subagent']
function checkManifest(dir, paths, candidate, row) {
  const json = (path) => JSON.parse(readFileSync(join(dir, path)))
  let pkg
  try { pkg = json('package.json') } catch { /* Report without echoing the manifest. */ }
  const agnes = pkg?.agnes
  if (pkg?.name !== candidate.name || pkg?.version !== candidate.version || !record(agnes) ||
      !Array.isArray(agnes.provides) || !agnes.provides.length || agnes.provides.some((kind) => typeof kind !== 'string') ||
      agnes.extensions !== undefined || paths.has('agnes.extension.json') ||
      (agnes.plugins !== undefined && (!Array.isArray(agnes.plugins) || agnes.plugins.some((plugin) =>
        !record(plugin) || typeof plugin.export !== 'string' || !plugin.export || typeof plugin.apiRange !== 'string' || !plugin.apiRange)))) {
    finding(row, 'MANIFEST', 'failed')
    return
  }
  const entries = (value, prefix = '') => {
    const relative = typeof value === 'string' ? value.replace(/^\.\//, '') : undefined
    if (!safePath(relative) || !paths.has(prefix + relative)) finding(row, 'ENTRY', 'failed')
    return relative && safePath(relative) && paths.has(prefix + relative) ? prefix + relative : undefined
  }
  const exported = (value) => {
    if (typeof value === 'string' && value.includes('*')) finding(row, 'COVERAGE', 'needs-review')
    else if (Array.isArray(value) || record(value)) Object.values(value).forEach(exported)
    else if (value !== null) entries(value)
  }
  if (pkg.exports !== undefined) exported(pkg.exports)
  if (pkg.main !== undefined) entries(pkg.main)
  if (agnes.plugins?.length && (pkg.exports == null && pkg.main == null)) finding(row, 'ENTRY', 'failed')
  if (agnes.clientDescriptors !== undefined && !Array.isArray(agnes.clientDescriptors)) finding(row, 'ENTRY', 'failed')
  for (const item of Array.isArray(agnes.clientDescriptors) ? agnes.clientDescriptors : []) {
    const path = entries(item?.path)
    if (!path) continue
    try {
      const descriptor = json(path)
      if (!descriptor?.client && !descriptor?.skins?.length) throw new Error('descriptor')
      const prefix = path.slice(0, path.lastIndexOf('/') + 1)
      if (descriptor.client) entries(descriptor.client.entry, prefix)
      for (const skin of descriptor.skins ?? []) entries(skin.css, prefix)
    } catch { finding(row, 'ENTRY', 'failed') }
  }
  for (const asset of [agnes.metadata?.icon, agnes.application?.brand?.mark, agnes.application?.brand?.favicon]) {
    if (asset !== undefined) entries(asset)
  }
  if (typeof pkg.license !== 'string' || !pkg.license.trim() || ![...paths].some((file) => /^(?:licen[cs]e|copying)(?:[.-]|$)/i.test(file) && !file.includes('/'))) finding(row, 'LICENSE', 'needs-review')
  if (['preinstall', 'install', 'postinstall', 'prepare'].some((hook) => Object.hasOwn(pkg.scripts ?? {}, hook)) ||
      ['dependencies', 'optionalDependencies', 'bundledDependencies', 'bundleDependencies'].some((key) => nonempty(pkg[key])) ||
      agnes.plugins?.some(({ capabilities }) => !record(capabilities) || risky.some((key) => nonempty(capabilities[key])) || nonempty(capabilities.filesystem?.write))) {
    finding(row, 'CAPABILITIES', 'needs-review')
  }
}

function reviewRelease(candidate, row, root) {
  if (!candidate.repo.startsWith('agnesai-labs/')) finding(row, 'PUBLISHER', 'needs-review')
  const repo = join(root, 'git')
  const payload = join(root, 'payload')
  const dir = join(payload, 'tree')
  mkdirSync(dir, { recursive: true })
  output(git(['init', '--bare', '--template=', repo]))
  const ref = `refs/tags/v${candidate.version}`
  const remote = `https://github.com/${candidate.repo}.git`
  const result = git(['-C', repo, 'fetch', '--no-tags', '--depth=1', '--no-recurse-submodules', remote, ref])
  if (result.status !== 0 && result.stderr?.includes(Buffer.from("couldn't find remote ref "))) return finding(row, 'TAG_MISSING', 'failed')
  if (result.status !== 0 || result.error) return finding(row, 'TAG_UNAVAILABLE', 'incomplete')
  if (output(git(['-C', repo, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}'])).toString().trim() !== candidate.commit) return finding(row, 'TAG_MISMATCH', 'failed')
  let tree
  try { tree = readTree(repo, candidate.commit, row) } catch { return finding(row, 'COVERAGE', 'needs-review') }
  const paths = materialize(repo, tree, dir, row)
  writeFileSync(join(payload, 'paths.txt'), [...tree.files.keys()].join('\n'))
  checkedScan(row, payload, dirname(root), 'RELEASE_SECRET')
  checkManifest(dir, paths, candidate, row)
}

const stateOf = (findings) => ['failed', 'incomplete', 'needs-review'].find((state) => findings.some((entry) => entry.state === state)) ?? 'passed'
const [base, head, event] = process.argv.slice(2)
if ((base !== '--all' && !sha.test(base ?? '')) || !sha.test(head ?? '') || (base !== '--all' && !event)) {
  console.error('Usage: node tools/review-release.mjs BASE_SHA HEAD_SHA EVENT_FILE | --all HEAD_SHA')
  process.exit(2)
}
const root = mkdtempSync(join(tmpdir(), 'market-release-'))
try {
  writeFileSync(join(root, 'empty-gitleaksignore'), '')
  const pr = { subject: base === '--all' ? 'Catalog' : 'Pull request', findings: [] }
  report.push(pr)
  if (base !== '--all') reviewPr(pr, base, head, event, root)
  let candidates
  try {
    const key = ({ name, repo, version, commit }) => JSON.stringify([name, repo, version, commit])
    const previous = new Set((base === '--all' ? [] : readIndex(base)).map(key))
    candidates = readIndex(head).filter((row) => !previous.has(key(row)))
  } catch { finding(pr, 'INVALID_INDEX', 'failed') }
  if (candidates?.length > 12) finding(pr, 'LIMIT', 'incomplete')
  else for (const [i, candidate] of (candidates ?? []).entries()) {
    const row = { subject: `Index release ${i + 1}`, commit: candidate.commit, findings: [] }
    report.push(row)
    const workspace = join(root, `release-${i}`)
    try { reviewRelease(candidate, row, workspace) }
    catch { finding(row, 'INTERNAL', 'incomplete') }
    finally { rmSync(workspace, { recursive: true, force: true }) }
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
const outcome = stateOf(report.flatMap((row) => row.findings))
console.log(`## Release review: ${outcome}\n\nReport only; this check is not a merge gate or proof of safety.\n\nRevision: \`${head}\`\n`)
if (report.length === 1) console.log('No release trees were reviewed.\n')
for (const { subject, commit, findings } of report) {
  console.log(`- **${subject}**${commit ? ` (\`${commit}\`)` : ''}: ${stateOf(findings)}`)
  for (const { code } of findings) console.log(`  - \`${code}\`: ${messages[code]}`)
}
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `outcome=${outcome}\n`, { flag: 'a' })
process.exitCode = outcome === 'failed' || outcome === 'incomplete' ? 1 : 0
