import { isUtf8 } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorizedSubmitter, canonicalRepository, publicRepository } from './public-submission.mjs'

const MiB = 1024 * 1024
const sha = /^[0-9a-f]{40}$/
const version = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const gitOptions = ['-c', 'core.hooksPath=/dev/null', '-c', 'http.followRedirects=false', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always']
const scannerConfig = fileURLToPath(new URL('./review-gitleaks.toml', import.meta.url))
const report = []
const messages = {
  PR_SECRET: 'Potential credential in PR title, description or commit changes. Rotate any exposed credential and remove it from the proposed history.',
  RELEASE_SECRET: 'Potential credential in the release tree. Rotate any exposed credential and submit a clean release.',
  SCAN_FAILED: 'Secret scanner did not complete; retry or investigate scanner availability.',
  PR_UNAVAILABLE: 'PR text or history could not be read within the review limits.',
  PR_BINARY: 'Binary or submodule PR changes are not covered by patch scanning.',
  INVALID_INDEX: 'Index data is missing, over limit or invalid; see the index check.',
  TAG_MISSING: 'The public repository has no matching vX.Y.Z tag. Push the immutable release tag before proposing the version.',
  TAG_UNAVAILABLE: 'Could not fetch the exact release tag. Check that the repository and tag are public, then retry.',
  TAG_MISMATCH: 'The release tag does not resolve to the indexed commit. Update the proposal to the intended immutable release.',
  MANIFEST: 'Root package.json is missing or does not match the indexed name/version and AGH plugin declaration. Use distinct documented agnes.provides labels.',
  ENTRY: 'An entry, client descriptor or declared local asset is missing or invalid. Include the runtime files in the tagged Git tree.',
  LICENSE: 'No license declaration or license file was found. Include licensing information before listing.',
  COVERAGE: 'Some release paths, objects or entry patterns were not reviewed. Check for links, submodules, Git LFS pointers, unsupported paths or review limits.',
  OPAQUE: 'Archive, native or unrecognized binary content is outside scan coverage.',
  PUBLISHER: 'An existing external listing does not use its repository owner’s public namespace. Verify the publisher manually.',
  PUBLIC_SCOPE: 'A new listing must be named @owner/name using its GitHub repository owner’s lowercase, non-reserved namespace.',
  PUBLIC_PROOF: 'The tagged release must include a root agh.market.json with the matching GitHub repository URL and 1–32 unique positive integer account IDs. For PRs, the author’s ID must be listed.',
  PUBLIC_IDENTITY: 'The PR author’s numeric GitHub account ID was unavailable. Review could not verify release delegation.',
  CAPABILITY_DECLARATION: 'A plugin does not declare capabilities in the expected object format.',
  PUBLIC_CAPABILITIES: 'Public automatic admission allows no declared plugin capabilities. Review any requested capability before listing.',
  CAPABILITY_REVIEW: 'A plugin declares sensitive capabilities that need manual review.',
  INSTALL_HOOKS: 'Package install lifecycle scripts need manual review.',
  RUNTIME_DEPENDENCIES: 'Package runtime dependencies need manual review.',
  RUNTIME_APIS: 'Source references sensitive runtime APIs that need manual review.',
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
      const repo = canonicalRepository(url)
      if (type !== 'git' || !repo || typeof commit !== 'string' || !sha.test(commit) || typeof entry.version !== 'string' || !version.test(entry.version) || entry.version.length > 128) throw new Error('index')
      return { name: row.name, repo, url, commit, version: entry.version }
    })
  })
}

function scan(row, path, cwd, secretCode) {
  // Never emit scanner diagnostics or findings, even redacted. Some skips and
  // read errors are only logged, not returned as nonzero exits by Gitleaks.
  const result = run('gitleaks', ['dir', '--config', scannerConfig, '--gitleaks-ignore-path', join(cwd, 'empty-gitleaksignore'),
    '--ignore-gitleaks-allow', '--redact=100', '--exit-code=21', '--timeout=45', '--no-color', '--no-banner',
    '--log-level=debug', path], { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
  const diagnostics = result.stderr?.toString() ?? ''
  if (result.status === 21 || /\b[1-9]\d* leaks found in partial scan\b/.test(diagnostics)) finding(row, secretCode, 'failed')
  if (result.error || ![0, 21].includes(result.status) ||
      /\b(?:ERR |FTL |skipping (?!empty file\b)|issue reading file)/.test(diagnostics)) finding(row, 'SCAN_FAILED', 'incomplete')
}

function finding(row, code, state) {
  if (!row.findings.some((entry) => entry.code === code)) row.findings.push({ code, state })
}

function stage(row, path, data, code) {
  try {
    writeFileSync(path, data, { flag: 'wx' })
    return true
  } catch {
    finding(row, code, 'incomplete')
    return false
  }
}

function reviewPr(row, base, head, eventFile, root) {
  const dir = join(root, 'pr')
  let actor = null
  try { mkdirSync(dir) } catch {
    finding(row, 'PR_UNAVAILABLE', 'incomplete')
    return null
  }
  try {
    const event = JSON.parse(readFileSync(eventFile))
    const pr = event.pull_request
    if (pr?.head?.sha !== head || pr?.base?.sha !== base || typeof pr.title !== 'string' ||
        (pr.body != null && typeof pr.body !== 'string')) throw new Error('event')
    const id = pr.user?.id
    if (Number.isSafeInteger(id) && id > 0) actor = id
    stage(row, join(dir, 'description.txt'), `\n${pr.title}\n${pr.body ?? ''}`, 'PR_UNAVAILABLE')
  } catch {
    finding(row, 'PR_UNAVAILABLE', 'incomplete')
  }

  const scope = ['--full-history', '--diff-merges=separate', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-notes',
    '--no-color', '--ignore-submodules=none', '--submodule=short', `${base}..${head}`, '--']
  const patch = git(['log', '--format=medium', '-p', ...scope], { maxBuffer: 8 * MiB })
  if (patch.status !== 0 || patch.error) finding(row, 'PR_UNAVAILABLE', 'incomplete')
  if (patch.stdout?.length) {
    if (!isUtf8(patch.stdout) || patch.stdout.includes(0)) finding(row, 'PR_BINARY', 'incomplete')
    stage(row, join(dir, 'history.patch'), patch.stdout, 'PR_UNAVAILABLE')
  }
  const stats = git(['log', '--format=', '--raw', '--numstat', '-z', ...scope])
  if (stats.status !== 0 || stats.error) finding(row, 'PR_UNAVAILABLE', 'incomplete')
  let rawName = false
  for (const entry of (stats.stdout?.toString() ?? '').split('\0')) {
    if (rawName) { rawName = false; continue }
    const raw = /^:([0-7]{6}) ([0-7]{6}) /.exec(entry)
    if (entry.startsWith('-\t-\t') || raw?.[1] === '160000' || raw?.[2] === '160000') {
      finding(row, 'PR_BINARY', 'incomplete')
      break
    }
    rawName = raw !== null
  }
  scan(row, dir, root, 'PR_SECRET')
  return actor
}

function safePath(path) {
  return typeof path === 'string' && !/[\\:]/u.test(path) &&
    !Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    path.split('/').every((part) => part && !['.', '..', '.git'].includes(part.toLowerCase()))
}

function readTree(repo, commit, row) {
  const list = git(['-C', repo, 'ls-tree', '-rlz', commit])
  let complete = list.status === 0 && !list.error
  const files = new Map()
  const paths = new Map()
  // Paths found in Git map to their staged text, null for binary, or undefined
  // when their content is unavailable to structural checks.
  let total = 0
  const data = list.stdout ?? Buffer.alloc(0)
  for (let start = 0; start < data.length;) {
    const end = data.indexOf(0, start)
    if (end < 0) { complete = false; break }
    const entry = data.subarray(start, end)
    start = end + 1
    if (!isUtf8(entry)) { finding(row, 'COVERAGE', 'incomplete'); continue }
    const line = entry.toString()
    if (!line.includes('\t')) { complete = false; continue }
    const tab = line.indexOf('\t')
    const match = /^100(?:644|755) blob ([0-9a-f]{40}) +([0-9]+)$/.exec(line.slice(0, tab))
    const path = line.slice(tab + 1)
    paths.set(path, undefined)
    const size = Number(match?.[2])
    if (!match || !safePath(path) || /(?:^|\/)(?:node_modules|fixtures\/out)(?:\/|$)/.test(path) ||
        size > 8 * MiB || total + size > 40 * MiB || files.size >= 4_000) {
      finding(row, 'COVERAGE', 'incomplete')
      continue
    }
    files.set(path, { oid: match[1], size })
    total += size
  }
  if (!complete) finding(row, 'COVERAGE', 'incomplete')
  return { files, paths, total, complete }
}

const codeFile = /\.(?:[cm]?[jt]sx?)$/i
const sensitiveCode = /(?:\bprocess\.env\b|['"](?:node:)?(?:child_process|net|tls|dgram|fs\/promises)['"]|\b(?:eval|fetch)\s*\()/
const opaqueFormat = /\.(?:zip|gz|xz|bz2|tar|7z|rar|tgz|jar|asar|pdf|docx|wasm|node|exe|dll|so|dylib|bin)$/i
const mediaHeaders = new Map(Object.entries({
  png: ['89504e470d0a1a0a'], jpg: ['ffd8ff'], jpeg: ['ffd8ff'], gif: ['474946383761', '474946383961'],
  ico: ['00000100'], woff: ['774f4646'], woff2: ['774f4632'], ttf: ['00010000', '74727565'],
}).map(([ext, headers]) => [ext, headers.map((hex) => Buffer.from(hex, 'hex'))]))
const riff = Buffer.from('RIFF')
const webp = Buffer.from('WEBP')

function knownMedia(path, data) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'webp') return data.subarray(0, 4).equals(riff) && data.subarray(8, 12).equals(webp)
  return mediaHeaders.get(ext)?.some((header) => data.subarray(0, header.length).equals(header))
}

// Keep the suffixes needed by the pinned scanner's path-qualified rules, but
// never let a contributor path make Gitleaks skip text via its global allowlist.
const ruleSuffix = /(?:\.(?:php|tf|hcl|ya?ml|p12|pfx)|nuget\.config)$/i

function materialize(repo, tree, dir, row) {
  const requests = [...tree.files.values()].map((item) => item.oid).join('\n')
  if (!requests) return
  const result = git(['-C', repo, 'cat-file', '--batch'], { input: `${requests}\n`, maxBuffer: tree.total + MiB })
  if (result.status !== 0 || result.error) finding(row, 'COVERAGE', 'incomplete')
  const blobs = result.stdout ?? Buffer.alloc(0)
  let cursor = 0
  let i = 0
  for (const [path, { oid, size }] of tree.files) {
    const end = blobs.indexOf(10, cursor)
    if (end < 0) { finding(row, 'COVERAGE', 'incomplete'); break }
    const header = blobs.toString('ascii', cursor, end)
    if (header === `${oid} missing`) {
      finding(row, 'COVERAGE', 'incomplete')
      cursor = end + 1
      continue
    }
    if (header !== `${oid} blob ${size}` || blobs[end + size + 1] !== 10) {
      finding(row, 'COVERAGE', 'incomplete')
      break
    }
    const data = blobs.subarray(end + 1, end + 1 + size)
    cursor = end + size + 2
    const text = isUtf8(data) && !data.includes(0)
    if (opaqueFormat.test(path) || (!text && !knownMedia(path, data))) finding(row, 'OPAQUE', 'incomplete')
    if (!text) {
      tree.paths.set(path, null)
      continue
    }
    const lfs = data.subarray(0, 80).toString().startsWith('version https://git-lfs.github.com/spec/v1')
    if (lfs) finding(row, 'COVERAGE', 'incomplete')
    if (codeFile.test(path) && sensitiveCode.test(data.toString())) finding(row, 'RUNTIME_APIS', 'needs-review')
    const target = join(dir, `file-${i++}${ruleSuffix.exec(path)?.[0] ?? '.txt'}`)
    if (stage(row, target, data, 'COVERAGE') && !lfs) tree.paths.set(path, target)
  }
  if (cursor !== blobs.length) finding(row, 'COVERAGE', 'incomplete')
}

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value) => Array.isArray(value) ? value.length > 0 : record(value) ? Object.keys(value).length > 0 : Boolean(value)
const risky = ['network', 'network.publicRead', 'exec', 'secrets', 'credentials', 'managedServices', 'childAgents', 'subagent']
const provides = new Set(['tool', 'loop', 'model-adapter', 'mcp', 'skills', 'ui', 'bundle', 'service'])
function checkManifest({ paths, complete }, candidate, row, publicSubmission) {
  const json = (path) => JSON.parse(readFileSync(paths.get(path)))
  const unavailable = (path) => paths.get(path) === undefined && (!complete || paths.has(path))
  if (unavailable('package.json')) return
  let pkg
  try { pkg = json('package.json') } catch { /* Report without echoing the manifest. */ }
  const agnes = pkg?.agnes
  if (pkg?.name !== candidate.name || pkg?.version !== candidate.version || !record(agnes) ||
      !Array.isArray(agnes.provides) || !agnes.provides.length || agnes.provides.length > provides.size ||
      agnes.provides.some((kind) => !provides.has(kind)) || new Set(agnes.provides).size !== agnes.provides.length ||
      agnes.extensions !== undefined || paths.has('agnes.extension.json') ||
      (agnes.plugins !== undefined && (!Array.isArray(agnes.plugins) || agnes.plugins.some((plugin) =>
        !record(plugin) || typeof plugin.export !== 'string' || !plugin.export || typeof plugin.apiRange !== 'string' || !plugin.apiRange)))) {
    finding(row, 'MANIFEST', 'failed')
    return
  }
  const entries = (value, prefix = '') => {
    const relative = typeof value === 'string' ? value.replace(/^\.\//, '') : undefined
    if (safePath(relative) && paths.has(prefix + relative)) return prefix + relative
    if (!safePath(relative) || complete) finding(row, 'ENTRY', 'failed')
  }
  const exported = (value) => {
    if (typeof value === 'string' && value.includes('*')) finding(row, 'COVERAGE', 'incomplete')
    else if (Array.isArray(value) || record(value)) Object.values(value).forEach(exported)
    else if (value !== null) entries(value)
  }
  if (pkg.exports !== undefined) exported(pkg.exports)
  if (pkg.main !== undefined) entries(pkg.main)
  if (agnes.plugins?.length && (pkg.exports == null && pkg.main == null)) finding(row, 'ENTRY', 'failed')
  if (agnes.clientDescriptors !== undefined && !Array.isArray(agnes.clientDescriptors)) finding(row, 'ENTRY', 'failed')
  for (const item of Array.isArray(agnes.clientDescriptors) ? agnes.clientDescriptors : []) {
    const path = entries(item?.path)
    if (!path || unavailable(path)) continue
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
  if (typeof pkg.license !== 'string' || !pkg.license.trim() || ![...paths.keys()].some((file) => /^(?:licen[cs]e|copying)(?:[.-]|$)/i.test(file) && !file.includes('/'))) finding(row, 'LICENSE', 'needs-review')
  if (agnes.plugins?.some(({ capabilities }) => !record(capabilities))) {
    finding(row, 'CAPABILITY_DECLARATION', 'needs-review')
  }
  if (publicSubmission && agnes.plugins?.some(({ capabilities }) => record(capabilities) && Object.keys(capabilities).length > 0)) {
    finding(row, 'PUBLIC_CAPABILITIES', 'needs-review')
  }
  if (agnes.plugins?.some(({ capabilities }) => record(capabilities) &&
      (risky.some((key) => nonempty(capabilities[key])) || nonempty(capabilities.filesystem?.write)))) {
    finding(row, 'CAPABILITY_REVIEW', 'needs-review')
  }
  if (['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare', 'prepack', 'postpack']
    .some((hook) => Object.hasOwn(pkg.scripts ?? {}, hook))) {
    finding(row, 'INSTALL_HOOKS', 'needs-review')
  }
  if (['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies'].some((key) => nonempty(pkg[key]))) {
    finding(row, 'RUNTIME_DEPENDENCIES', 'needs-review')
  }
}

function checkPublicProof(paths, url, actor, row) {
  let declaration
  const proof = paths.get('agh.market.json')
  if (proof) {
    try { declaration = JSON.parse(readFileSync(proof)) } catch { /* Report without echoing the declaration. */ }
  }
  if (!authorizedSubmitter(declaration, url, actor)) finding(row, 'PUBLIC_PROOF', 'failed')
}

function reviewRelease(candidate, row, root, firstListing, actor) {
  const publicSubmission = publicRepository(candidate.name, candidate.url)
  if (publicSubmission) {
    if (actor === null) finding(row, 'PUBLIC_IDENTITY', 'incomplete')
  } else if (firstListing) {
    finding(row, 'PUBLIC_SCOPE', 'failed')
  } else if (!candidate.repo.startsWith('agnesai-labs/')) {
    finding(row, 'PUBLISHER', 'needs-review')
  }
  const repo = join(root, 'git')
  const payload = join(root, 'payload')
  mkdirSync(payload, { recursive: true })
  output(git(['init', '--bare', '--template=', repo]))
  const ref = `refs/tags/v${candidate.version}`
  const remote = `https://github.com/${candidate.repo}.git`
  const result = git(['-C', repo, 'fetch', '--no-tags', '--depth=1', '--no-recurse-submodules', remote, ref])
  if (result.status !== 0 && result.stderr?.includes(Buffer.from("couldn't find remote ref "))) return finding(row, 'TAG_MISSING', 'failed')
  if (result.status !== 0 || result.error) return finding(row, 'TAG_UNAVAILABLE', 'incomplete')
  if (output(git(['-C', repo, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}'])).toString().trim() !== candidate.commit) return finding(row, 'TAG_MISMATCH', 'failed')
  const tree = readTree(repo, candidate.commit, row)
  materialize(repo, tree, payload, row)
  stage(row, join(payload, 'paths.txt'), `\n${[...tree.paths.keys()].join('\n')}`, 'COVERAGE')
  scan(row, payload, dirname(root), 'RELEASE_SECRET')
  if (publicSubmission && actor !== null) checkPublicProof(tree.paths, candidate.url, actor, row)
  checkManifest(tree, candidate, row, publicSubmission)
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
  const all = base === '--all'
  const pr = { subject: all ? 'Catalog' : 'Pull request', findings: [] }
  report.push(pr)
  const actor = all ? undefined : reviewPr(pr, base, head, event, root)
  const listingKey = ({ name, repo }) => JSON.stringify([name, repo])
  let previousListings
  let candidates
  try {
    const key = ({ name, repo, version, commit }) => JSON.stringify([name, repo, version, commit])
    const previous = all ? [] : readIndex(base)
    previousListings = new Set(previous.map(listingKey))
    const previousReleases = new Set(previous.map(key))
    candidates = readIndex(head).filter((row) => !previousReleases.has(key(row)))
  } catch { finding(pr, 'INVALID_INDEX', 'failed') }
  if (candidates?.length > 12) finding(pr, 'LIMIT', 'incomplete')
  for (const [i, candidate] of (candidates ?? []).slice(0, 12).entries()) {
    const row = { subject: `Index release ${i + 1}`, commit: candidate.commit, findings: [] }
    report.push(row)
    const workspace = join(root, `release-${i}`)
    const firstListing = !all && !previousListings.has(listingKey(candidate))
    try { reviewRelease(candidate, row, workspace, firstListing, actor) }
    catch { finding(row, 'INTERNAL', 'incomplete') }
    finally { rmSync(workspace, { recursive: true, force: true }) }
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
const outcome = stateOf(report.flatMap((row) => row.findings))
console.log(`## Release review: ${outcome}\n\nReport only; this check is not a merge gate or proof of safety.\n\nSecret checks cover PR text and patches, release source/text and filenames. Recognized release media are not subject to binary content scanning; opaque content makes coverage incomplete.\n\nRevision: \`${head}\`\n`)
if (report.length === 1) console.log('No release trees were reviewed.\n')
for (const { subject, commit, findings } of report) {
  console.log(`- **${subject}**${commit ? ` (\`${commit}\`)` : ''}: ${stateOf(findings)}`)
  for (const { code } of findings) console.log(`  - \`${code}\`: ${messages[code]}`)
}
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `outcome=${outcome}\n`, { flag: 'a' })
process.exitCode = outcome === 'failed' || outcome === 'incomplete' ? 1 : 0
