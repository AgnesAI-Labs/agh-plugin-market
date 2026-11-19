import { Buffer, isUtf8 } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalRepository } from './public-submission.mjs'

const MiB = 1024 * 1024
const releaseLimit = 6
const treeLimit = 4_000
const targetLimit = 500
const fileLimit = MiB
const byteLimit = 24 * MiB
const findingLimit = 40
const deadline = Date.now() + 8 * 60_000
const sha = /^[0-9a-f]{40}$/
const version = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const rules = fileURLToPath(new URL('./code-review-rules.yml', import.meta.url))
const gitleaksConfig = fileURLToPath(new URL('./review-gitleaks.toml', import.meta.url))
const image = 'semgrep/semgrep@sha256:67518c174185a2043fdbed16c70631b79209499b3671178e7194379b48295a0d'
const gitOptions = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.askPass=/bin/false', '-c', 'credential.helper=',
  '-c', 'http.followRedirects=false', '-c', 'http.sslVerify=true', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always']
const gitEnv = {
  PATH: process.env.PATH, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0',
}
const messages = {
  INDEX_UNAVAILABLE: 'The pinned index could not be read or was invalid or over the index size limit.',
  RELEASE_LIMIT: 'Not all changed release tuples were scanned; the run reached its release limit.',
  REVIEW_TIMEOUT: 'The run reached its overall time limit before all releases could be scanned.',
  TAG_UNAVAILABLE: 'The exact public release tag could not be fetched within review limits.',
  TAG_MISMATCH: 'The release tag could not be verified against the indexed commit.',
  TREE_COVERAGE: 'Part of the Git tree could not be read or was beyond the tree entry limit.',
  TARGET_LIMIT: 'One or more JS/TS targets exceeded the per-file, aggregate byte or target count limit.',
  TARGET_UNAVAILABLE: 'One or more JS/TS files could not be read as bounded UTF-8 text or were Git LFS pointers.',
  UNSUPPORTED_SOURCE: 'Recognized non-JS/TS executable source or mixed-format code was not scanned.',
  OPAQUE_CONTENT: 'Recognized archives, native binaries, symlinks or submodules were not scanned.',
  BASELINE_UNAVAILABLE: 'The previously indexed commit or its tree could not be verified; current findings have no delta labels.',
  SCANNER_INCOMPLETE: 'Semgrep did not complete with valid results for every staged target; scanner diagnostics are not shown.',
  FINDING_LIMIT: 'Only the bounded subset of validated findings is shown.',
  LOCATION_CHECK_FAILED: 'Location labels and links were withheld because the display safety check did not complete.',
  INTERNAL: 'The reviewer could not complete; no diagnostics from untrusted inputs are shown.',
}
const behavior = new Map([
  ['sensitive-data-outbound', {
    evidence: 'The configured rule found a local flow from a sensitive-data source to an outbound request sink.',
    mitigation: 'Verify the data and destination are necessary and authorized; remove or minimize sensitive data sent off-device.',
  }],
  ['remote-content-execution', {
    evidence: 'The configured rule found a local flow from a remote response to a code or command execution sink.',
    mitigation: 'Remove remote-code execution; use a fixed, independently verified local implementation instead.',
  }],
])

function run(program, args, { timeout = 15_000, maxBuffer = 2 * MiB, stdio = ['pipe', 'pipe', 'ignore'], ...options } = {}) {
  return spawnSync(program, args, {
    timeout: Math.max(1000, Math.min(timeout, deadline - Date.now())), killSignal: 'SIGKILL', maxBuffer, stdio, ...options,
  })
}

function git(args, options) {
  return run('git', [...gitOptions, ...args], { ...options, env: gitEnv })
}

const succeeded = (result) => result.status === 0 && !result.error
const resolves = (repoArgs, ref, commit) => {
  const result = git([...repoArgs, 'rev-parse', '--verify', `${ref}^{commit}`])
  return succeeded(result) && result.stdout.toString().trim() === commit
}
const listingKey = ({ name, repo }) => JSON.stringify([name, repo])
const releaseKey = ({ name, repo, tagVersion, commit }) => JSON.stringify([name, repo, tagVersion, commit])

function readIndex(revision) {
  if (!resolves([], revision, revision)) throw new Error('index')
  const result = git(['cat-file', 'blob', `${revision}:docs/index.json`])
  if (!succeeded(result) || !isUtf8(result.stdout)) throw new Error('index')
  const index = JSON.parse(result.stdout)
  if (index?.format !== 1 || !Array.isArray(index.plugins)) throw new Error('index')
  const releases = new Map()
  for (const row of index.plugins) {
    if (typeof row?.name !== 'string' || !row.name || !Array.isArray(row.versions) || !row.versions.length) throw new Error('index')
    for (const entry of row.versions) {
      const { type, url, commit } = entry?.source ?? {}
      const tagVersion = entry?.version
      const repo = canonicalRepository(url)
      if (type !== 'git' || !repo || typeof commit !== 'string' || !sha.test(commit) ||
          typeof tagVersion !== 'string' || tagVersion.length > 128 || !version.test(tagVersion)) throw new Error('index')
      const candidate = { name: row.name, repo, url, commit, tagVersion }
      releases.set(releaseKey(candidate), candidate)
    }
  }
  return releases
}

function compareVersions(a, b) {
  const left = a.split('.')
  const right = b.split('.')
  for (let i = 0; i < 3; i++) {
    const length = left[i].length - right[i].length
    if (length) return length
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  }
  return 0
}

function latestReleases(releases) {
  const latest = new Map()
  for (const release of releases.values()) {
    const key = listingKey(release)
    const old = latest.get(key)
    const order = old ? compareVersions(release.tagVersion, old.tagVersion) : 1
    if (order === 0 && release.commit !== old.commit) throw new Error('index')
    if (order > 0) latest.set(key, release)
  }
  return latest
}

function fetchCommit(repoArgs, remote, ref) {
  return git([...repoArgs, 'fetch', '--no-tags', '--depth=1', '--no-recurse-submodules', '--', remote, ref],
    { timeout: 35_000, stdio: 'ignore' })
}

const extensions = new Map([
  ['js', 'js'], ['mjs', 'js'], ['cjs', 'js'], ['jsx', 'jsx'],
  ['ts', 'ts'], ['mts', 'ts'], ['cts', 'ts'], ['tsx', 'tsx'],
])
const unsupported = /\.(?:sh|bash|zsh|fish|ksh|csh|ps1|bat|cmd|py|pyw|rb|pl|pm|php|phtml|lua|go|rs|c|h|cc|hh|cpp|hpp|cxx|hxx|m|mm|swift|java|kt|kts|scala|cs|fs|fsx|ex|exs|erl|hrl|dart|r|jl|ipynb|vbs|vb|asm|s|groovy|html?|vue|svelte|astro|coffee|litcoffee|jsxm|mdx)$/i
const opaque = /\.(?:zip|gz|xz|bz2|tar|7z|rar|tgz|jar|asar|wasm|node|exe|dll|so(?:\.\d+)*|dylib|bin|class|pyc|o|a|lib|deb|rpm|appimage)$/i

function readTree(repoArgs, commit, withSizes) {
  const result = git([...repoArgs, 'ls-tree', '-rz', ...withSizes ? ['-l'] : [], commit])
  const data = result.stdout ?? Buffer.alloc(0)
  const files = new Map()
  const notes = new Set()
  let complete = succeeded(result)
  let count = 0
  for (let cursor = 0; cursor < data.length;) {
    if (count++ >= treeLimit) { complete = false; break }
    const end = data.indexOf(0, cursor)
    if (end < 0) { complete = false; break }
    const tab = data.indexOf(9, cursor)
    const header = tab >= cursor && tab < end && /^([0-7]{6}) (blob|commit) ([0-9a-f]{40})(?: +([0-9]+|-))?$/.exec(data.toString('ascii', cursor, tab))
    if (!header || tab + 1 === end || (withSizes && header[4] === undefined)) {
      complete = false
      cursor = end + 1
      continue
    }
    // Git paths are bytes. Latin-1 preserves their identity for delta comparisons;
    // only ASCII display whitelists can turn them into human labels or links.
    const path = data.toString('latin1', tab + 1, end)
    cursor = end + 1
    const [, mode, kind, oid, sizeText] = header
    if (kind !== 'blob' || (mode !== '100644' && mode !== '100755')) {
      notes.add('OPAQUE_CONTENT')
      continue
    }
    const dot = path.lastIndexOf('.')
    const ext = dot >= 0 ? extensions.get(path.slice(dot + 1).toLowerCase()) : undefined
    if (!ext) {
      if (opaque.test(path)) notes.add('OPAQUE_CONTENT')
      else if (unsupported.test(path) || /(?:^|\/)(?:Dockerfile|Makefile|Rakefile|Gemfile)$/i.test(path) ||
          (mode === '100755' && !path.slice(path.lastIndexOf('/') + 1).includes('.'))) notes.add('UNSUPPORTED_SOURCE')
      continue
    }
    const size = withSizes ? Number(sizeText) : 0
    if ((withSizes && (!Number.isSafeInteger(size) || size < 0)) || files.has(path)) {
      complete = false
      continue
    }
    files.set(path, { path, oid, ext, size })
  }
  return { files, notes, complete }
}

function previousTree(repoArgs, remote, previous) {
  if (!resolves(repoArgs, previous.commit, previous.commit) &&
      (!succeeded(fetchCommit(repoArgs, remote, previous.commit)) || !resolves(repoArgs, 'FETCH_HEAD', previous.commit))) return
  const tree = readTree(repoArgs, previous.commit, false)
  if (tree.complete) return tree.files
}

const lfsPointer = Buffer.from('version https://git-lfs.github.com/spec/v1')

function stage(repoArgs, tree, inputs, notes) {
  const requested = []
  let bytes = 0
  for (const file of tree.files.values()) {
    if (file.size > fileLimit || requested.length >= targetLimit || bytes + file.size > byteLimit) {
      notes.add('TARGET_LIMIT')
    } else {
      requested.push(file)
      bytes += file.size
    }
  }
  const staged = new Map()
  if (!requested.length) return staged
  const result = git([...repoArgs, 'cat-file', '--batch'], {
    input: `${requested.map((file) => file.oid).join('\n')}\n`, maxBuffer: bytes + MiB,
  })
  const data = result.stdout ?? Buffer.alloc(0)
  if (!succeeded(result)) notes.add('TARGET_UNAVAILABLE')
  let cursor = 0
  for (const [i, file] of requested.entries()) {
    const newline = data.indexOf(10, cursor)
    if (newline < 0) { notes.add('TARGET_UNAVAILABLE'); break }
    const header = data.toString('ascii', cursor, newline)
    if (header === `${file.oid} missing`) {
      notes.add('TARGET_UNAVAILABLE')
      cursor = newline + 1
      continue
    }
    const end = newline + 1 + file.size
    if (header !== `${file.oid} blob ${file.size}` || data[end] !== 10) {
      notes.add('TARGET_UNAVAILABLE')
      break
    }
    const blob = data.subarray(newline + 1, end)
    cursor = end + 1
    if (blob.includes(0) || !isUtf8(blob) || blob.subarray(0, lfsPointer.length).equals(lfsPointer)) {
      notes.add('TARGET_UNAVAILABLE')
      continue
    }
    const name = `target-${i + 1}.${file.ext}`
    let lines = 1
    for (let offset = 0; offset < blob.length; offset++) if (blob[offset] === 10) lines++
    writeFileSync(join(inputs, name), blob, { flag: 'wx' })
    staged.set(name, { ...file, lines })
  }
  return staged
}

function invokeScanner(inputs, workspace) {
  const local = process.env.MARKET_SEMGREP_BIN
  const config = local ? rules : '/rules.yml'
  const args = ['scan', '--config', config, '--json', '--verbose', '--oss-only', '--no-rewrite-rule-ids',
    '--metrics=off', '--disable-version-check', '--no-git-ignore', '--disable-nosem', '--max-target-bytes', String(fileLimit), '--jobs', '2', '.']
  const options = { timeout: 75_000, maxBuffer: 12 * MiB }
  if (local) {
    // Explicit local testing only. CI uses the pinned, network-disabled container.
    const env = { PATH: process.env.PATH, HOME: workspace, SEMGREP_SETTINGS_FILE: join(workspace, 'semgrep-settings.yml') }
    return run(local.includes('/') ? resolve(local) : local, args, { ...options, cwd: inputs, env })
  }
  const name = `${basename(resolve(workspace, '..'))}-${basename(workspace)}`
  const result = run('docker', ['run', '--rm', '--name', name, '--network', 'none', '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--user', `${process.getuid()}:${process.getgid()}`, '--log-driver', 'none',
    '--env', 'HOME=/tmp', '--env', 'SEMGREP_SETTINGS_FILE=/tmp/semgrep-settings.yml',
    '--mount', `type=bind,src=${rules},dst=/rules.yml,readonly`,
    '--mount', `type=bind,src=${inputs},dst=/inputs,readonly`, '--workdir', '/inputs', image, 'semgrep', ...args], options)
  if (!succeeded(result)) run('docker', ['rm', '-f', name], { timeout: 5000, stdio: 'ignore' })
  return result
}

function scannedName(path, inputs, staged) {
  if (typeof path !== 'string') return
  const root = process.env.MARKET_SEMGREP_BIN ? inputs : '/inputs'
  const name = path.startsWith('./') ? path.slice(2) : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  if (staged.has(name)) return name
}

function scan(inputs, workspace, staged, prior, row) {
  const result = invokeScanner(inputs, workspace)
  const incomplete = () => row.notes.add('SCANNER_INCOMPLETE')
  if (!succeeded(result)) incomplete()
  if (result.error || !result.stdout?.length) { incomplete(); return }
  let json
  try { json = JSON.parse(result.stdout) }
  catch { incomplete(); return }
  if (!Array.isArray(json?.errors) || json.errors.length) incomplete()
  if (json?.paths?.skipped !== undefined && (!Array.isArray(json.paths.skipped) || json.paths.skipped.length)) incomplete()
  const scanned = new Set()
  if (Array.isArray(json?.paths?.scanned)) {
    for (const path of json.paths.scanned) {
      const name = scannedName(path, inputs, staged)
      if (!name) incomplete()
      else scanned.add(name)
    }
  }
  row.scanned = scanned.size
  if (scanned.size !== staged.size) incomplete()
  if (!Array.isArray(json?.results)) { incomplete(); return }
  const seen = new Set()
  for (const match of json.results) {
    const id = match?.check_id
    const name = scannedName(match?.path, inputs, staged)
    const file = staged.get(name)
    const start = match?.start?.line
    const end = match?.end?.line
    if (!behavior.has(id) || !scanned.has(name) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 1 || end < start || end > file.lines) { incomplete(); continue }
    const key = `${id}:${name}:${start}:${end}`
    if (seen.has(key)) continue
    if (row.findings.length >= findingLimit) { row.notes.add('FINDING_LIMIT'); break }
    seen.add(key)
    const delta = prior && (prior.get(file.path)?.oid === file.oid ? 'unchanged' : 'changed')
    row.findings.push({ id, path: file.path, start, end, delta })
  }
}

function review(candidate, previous, row, workspace) {
  const repo = join(workspace, 'git')
  const repoArgs = ['-C', repo]
  const remote = `https://github.com/${candidate.repo}.git`
  const inputs = join(workspace, 'inputs')
  mkdirSync(inputs, { recursive: true })
  if (!succeeded(git(['init', '--bare', '--template=', repo], { stdio: 'ignore' }))) throw new Error('git init')
  if (!succeeded(fetchCommit(repoArgs, remote, `refs/tags/v${candidate.tagVersion}`))) {
    row.notes.add('TAG_UNAVAILABLE')
    return
  }
  if (!resolves(repoArgs, 'FETCH_HEAD', candidate.commit)) { row.notes.add('TAG_MISMATCH'); return }
  const tree = readTree(repoArgs, candidate.commit, true)
  for (const note of tree.notes) row.notes.add(note)
  if (!tree.complete) row.notes.add('TREE_COVERAGE')
  row.noTargets = tree.complete && !tree.files.size
  const staged = stage(repoArgs, tree, inputs, row.notes)
  if (!staged.size) return
  const prior = previous && previousTree(repoArgs, remote, previous)
  if (previous && !prior) row.notes.add('BASELINE_UNAVAILABLE')
  scan(inputs, workspace, staged, prior, row)
}

function safeLabel(path) {
  return /^[A-Za-z0-9._/-]{1,199}$/.test(path) && path.split('/').every((part) =>
    part.length > 0 && part.length <= 64 && !/^\.{1,2}$|^\.git$/i.test(part) &&
    !/[a-z0-9]{25,}|[a-f0-9]{20,}/i.test(part))
}

function checkLocations(root, rows) {
  const labels = new Set()
  for (const row of rows) {
    const { repo, url, commit } = row.candidate
    for (const finding of row.findings) {
      if (!safeLabel(finding.path)) continue
      finding.label = finding.path
      labels.add(finding.label)
      if (safeLabel(repo)) {
        const base = `https://github.com/${repo}`
        labels.add(url)
        labels.add(base)
        const anchor = `#L${finding.start}${finding.end === finding.start ? '' : `-L${finding.end}`}`
        finding.link = `${base}/blob/${commit}/${finding.label}${anchor}`
      }
    }
  }
  if (!labels.size) return 'clear'
  const dir = join(root, 'labels')
  const ignore = join(root, 'empty-gitleaksignore')
  mkdirSync(dir)
  writeFileSync(ignore, '', { flag: 'wx' })
  writeFileSync(join(dir, 'review.txt'), `${[...labels].join('\n')}\n`, { flag: 'wx' })
  const result = run('gitleaks', ['dir', '--config', gitleaksConfig, '--gitleaks-ignore-path', ignore,
    '--ignore-gitleaks-allow', '--redact=100', '--exit-code=21', '--timeout=30', '--no-color', '--no-banner',
    '--log-level=debug', dir], { cwd: root, timeout: 35_000, maxBuffer: MiB, stdio: ['ignore', 'ignore', 'pipe'] })
  const diagnostics = result.stderr?.toString() ?? ''
  if (result.error || ![0, 21].includes(result.status) ||
      /\b(?:ERR |FTL |skipping (?!empty file\b)|issue reading file)/i.test(diagnostics)) return 'failed'
  return result.status === 21 || /\b[1-9]\d* leaks found in partial scan\b/i.test(diagnostics) ? 'withheld' : 'clear'
}

function report(head, rows, notes, locations) {
  const outcome = notes.size || rows.some((row) => row.notes.size) ? 'incomplete'
    : rows.some((row) => row.findings.length) ? 'findings'
      : rows.some((row) => row.scanned) ? 'clear' : 'not-applicable'
  const lines = [
    `## Code review: ${outcome}`, '',
    'Advisory only. Findings need manual verification and do not establish malicious intent. No findings is not proof of safety.', '',
    'Scope: OSS Semgrep looks for configured, same-function JavaScript/TypeScript flows in tracked source and build output. Other languages, unrecognized or opaque formats, ordinary bugs, cross-function flows and full runtime behavior are not covered.', '',
    'Changed/unchanged labels compare the current file’s path and blob with the latest verified base-index release for the same listing. The current tree is scanned for new and existing listings alike.', '',
    `Revision: \`${head}\``, '',
  ]
  for (const note of notes) lines.push(`- \`${note}\`: ${messages[note]}`)
  if (locations === 'withheld') lines.push('- Location labels and links were withheld by display safety checks.')
  if (!rows.length && !notes.size) lines.push('No new or updated release tuples were selected.')
  for (const [i, row] of rows.entries()) {
    const coverage = row.noTargets ? 'No applicable JavaScript/TypeScript targets.'
      : `${row.scanned} JavaScript/TypeScript target${row.scanned === 1 ? '' : 's'} reported scanned.`
    lines.push(`- **Release ${i + 1}** (\`${row.candidate.commit}\`): ${coverage}`)
    for (const note of row.notes) lines.push(`  - \`${note}\`: ${messages[note]}`)
    if (!row.findings.length && row.scanned && !row.notes.size) lines.push('  - No configured behavioral findings.')
    for (const { id, start, end, delta, link, label } of row.findings) {
      const text = behavior.get(id)
      const range = start === end ? `line ${start}` : `lines ${start}–${end}`
      const location = locations === 'clear' && label
        ? (link ? `[\`${label}\`, ${range}](${link})` : `\`${label}\`, ${range}`)
        : `${range} (path withheld)`
      lines.push(`  - \`${id}\` — High-priority · manual verification — ${location}${delta ? ` — current: ${delta}` : ''}.`,
        `    - Evidence: ${text.evidence}`, `    - Mitigation: ${text.mitigation}`)
    }
  }
  return { outcome, markdown: `${lines.join('\n')}\n` }
}

const [base, head, ...extra] = process.argv.slice(2)
if (extra.length || (base !== '--all' && !sha.test(base ?? '')) || !sha.test(head ?? '')) {
  console.error('Usage: node tools/review-code.mjs BASE_SHA HEAD_SHA | --all HEAD_SHA')
  process.exit(2)
}

const rows = []
const notes = new Set()
let root
let locations = 'failed'
try {
  let candidates
  let previous
  try {
    const priorIndex = base === '--all' ? new Map() : readIndex(base)
    previous = latestReleases(priorIndex)
    candidates = [...readIndex(head)].filter(([key]) => !priorIndex.has(key)).map(([, candidate]) => candidate)
  } catch { notes.add('INDEX_UNAVAILABLE') }
  if (candidates?.length) {
    root = mkdtempSync(join(resolve(tmpdir()), 'market-code-'))
    if (candidates.length > releaseLimit) notes.add('RELEASE_LIMIT')
    for (const [i, candidate] of candidates.slice(0, releaseLimit).entries()) {
      if (Date.now() >= deadline) { notes.add('REVIEW_TIMEOUT'); break }
      const row = { candidate, notes: new Set(), scanned: 0, noTargets: false, findings: [] }
      rows.push(row)
      const workspace = join(root, `release-${i + 1}`)
      try { review(candidate, previous.get(listingKey(candidate)), row, workspace) }
      catch { row.notes.add('INTERNAL') }
      finally { rmSync(workspace, { recursive: true, force: true }) }
    }
    try { locations = checkLocations(root, rows) }
    catch { locations = 'failed' }
    if (locations === 'failed') notes.add('LOCATION_CHECK_FAILED')
  }
} catch { notes.add('INTERNAL') }
finally {
  try { if (root) rmSync(root, { recursive: true, force: true }) }
  catch { notes.add('INTERNAL') }
}
let rendered = report(head, rows, notes, locations)
if (process.env.GITHUB_OUTPUT) {
  try { appendFileSync(process.env.GITHUB_OUTPUT, `outcome=${rendered.outcome}\n`) }
  catch {
    notes.add('INTERNAL')
    rendered = report(head, rows, notes, locations)
  }
}
process.stdout.write(rendered.markdown)
