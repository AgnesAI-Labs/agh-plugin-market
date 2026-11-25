import { isUtf8 } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { readFileSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual as equal } from 'node:util'
import { providesChange } from './index-provides.mjs'
import { canonicalRepository } from './public-submission.mjs'
import {
  fullSha as sha, newerRelease, readReleaseMetadata, validAghRange, validProvides,
  validTimestamp, verifyReleaseMetadata,
} from './release-metadata.mjs'
import { readmeLocales, replaceReadmeTable } from './readme-tables.mjs'

// AGH community-discovery.ts limits the uncompressed response body to 2 MiB.
const maxBytes = 2 * 1024 * 1024
const version = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const indexPath = 'docs/index.json'
const git = (...args) => execFileSync('git', args, {
  maxBuffer: maxBytes + 1024, timeout: 60_000, env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
})
const fail = (message) => { throw new Error(message) }
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value) => typeof value === 'string' || (object(value) && Object.values(value).every((item) => typeof item === 'string'))

export function readCatalogFile(path, ref) {
  if (ref) {
    if (!/^100(?:644|755) blob /.test(git('ls-tree', ref, '--', path))) fail(`${path}: expected a regular file`)
    const blob = `${ref}:${path}`
    if (Number(git('cat-file', '-s', blob)) > maxBytes) fail(`${path}: exceeds 2 MiB (${maxBytes} bytes)`)
    return git('cat-file', 'blob', blob)
  }
  const stat = lstatSync(path)
  if (!stat.isFile()) fail(`${path}: expected a regular file`)
  if (stat.size > maxBytes) fail(`${path}: exceeds 2 MiB (${maxBytes} bytes)`)
  return readFileSync(path)
}

function repository(url, where) {
  const repo = canonicalRepository(url)
  if (!repo) fail(`${where}: expected https://github.com/OWNER/REPO`)
  return repo
}

function readSources(ref) {
  const urls = new Set()
  const pins = new Map()
  for (const [i, raw] of readCatalogFile('plugins.txt', ref).toString('utf8').split('\n').entries()) {
    const where = `plugins.txt:${i + 1}`
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('# pin:')) {
      const [url, release, commit, extra] = line.slice(6).trim().split(/\s+/)
      const key = repository(url, where)
      if (!version.test(release) || !sha.test(commit) || extra) fail(`${where}: expected # pin: URL VERSION COMMIT`)
      if (!pins.has(key)) pins.set(key, new Map())
      const releases = pins.get(key)
      if (releases.has(release)) fail(`${where}: duplicate pin`)
      releases.set(release, commit)
    } else if (!line.startsWith('#')) {
      const key = repository(line, where)
      if (urls.has(key)) fail(`${where}: duplicate repository`)
      urls.add(key)
    }
  }
  return { urls, pins }
}

function indexedDocument(ref) {
  const raw = readCatalogFile(indexPath, ref)
  if (!isUtf8(raw)) fail(`${indexPath}: expected UTF-8 JSON`)
  const text = raw.toString()
  return { index: JSON.parse(text), text }
}

export function validateIndex(ref) {
  const { urls, pins } = readSources(ref)
  const document = indexedDocument(ref)
  const { index } = document
  if (!object(index) || index.format !== 1 || !Array.isArray(index.plugins)) fail(`${indexPath}: expected format 1 with a plugins array`)
  const names = new Set()
  const entries = new Map()
  for (const [i, row] of index.plugins.entries()) {
    const where = `${indexPath}: plugins[${i}]`
    if (!object(row) || typeof row.name !== 'string' || row.name.length > 214 || !packageName.test(row.name)) fail(`${where}: invalid package name`)
    if (names.has(row.name)) fail(`${where}: duplicate package name ${row.name}`)
    names.add(row.name)
    const key = repository(row.repository?.url, where)
    if (!urls.delete(key)) fail(`${where}: repository duplicated or not listed in plugins.txt (${key})`)
    if (!Array.isArray(row.versions) || !row.versions.length) fail(`${where}: expected at least one version`)
    if ((row.title !== undefined && !text(row.title)) || (row.description !== undefined && !text(row.description)) || (row.author !== undefined && typeof row.author !== 'string')) fail(`${where}: invalid title, description or author`)
    const releases = new Map()
    for (const entry of row.versions) {
      if (!object(entry) || typeof entry.version !== 'string' || entry.version.length > 128 || !version.test(entry.version) || releases.has(entry.version)) fail(`${where}: invalid or duplicate stable version`)
      const source = entry.source
      if (source?.type !== 'git' || repository(source.url, where) !== key || typeof source.commit !== 'string' || !sha.test(source.commit)) fail(`${where}: expected a Git source in the same repository with a full commit SHA`)
      if (Object.hasOwn(entry, 'provides') && !validProvides(entry.provides)) {
        fail(`${row.name}@${entry.version}: expected 1–8 distinct documented provides types`)
      }
      releases.set(entry.version, entry)
    }
    entries.set(key, { name: row.name, releases })
  }
  if (urls.size) fail(`plugins.txt: missing from the index: ${[...urls].join(', ')}`)
  for (const [key, releases] of pins) {
    for (const [release, commit] of releases) {
      if (entries.get(key)?.releases.get(release)?.source.commit !== commit) fail(`plugins.txt: pin does not match the index for ${key}@${release}`)
    }
  }
  return { ...document, entries, pins, plugins: index.plugins }
}

function validateReadmes(plugins, head, base, generatedOnly) {
  for (const path of Object.keys(readmeLocales)) {
    const candidate = readCatalogFile(path, head)
    const template = generatedOnly ? readCatalogFile(path, base) : candidate
    const expected = replaceReadmeTable(path, template, plugins)
    if (!candidate.equals(expected)) {
      fail(generatedOnly
        ? `${path}: automatic publication allows only generated table changes`
        : `${path}: stale catalog table; run node tools/sync-readmes.mjs`)
    }
  }
}

async function validateTopic(repo) {
  const headers = { Accept: 'application/vnd.github+json' }
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`
  const response = await fetch(`https://api.github.com/repos/${repo}/topics`, {
    headers, redirect: 'error', signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
  const names = response?.ok ? (await response.json().catch(() => undefined))?.names : undefined
  if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
    const status = response && !response.ok ? ` (HTTP ${response.status})` : ''
    fail(`${repo}: could not verify required GitHub Topic agh-plugin${status}; retry validation`)
  }
  if (!names.includes('agh-plugin')) {
    fail(`${repo}: missing required GitHub Topic agh-plugin; add it in the plugin repository's About → Topics and rerun validation`)
  }
}

function nulList(bytes) {
  return bytes.toString('utf8').split('\0').filter(Boolean)
}

function changedPaths(base, head) {
  const tracked = nulList(git('diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', base, ...(head ? [head] : []), '--'))
  return head ? tracked : [...tracked, ...nulList(git('ls-files', '--others', '--exclude-standard', '-z'))]
}

function indexMode(ref) {
  if (!ref) return (lstatSync(indexPath).mode & 0o111) ? '100755' : '100644'
  return git('ls-tree', ref, '--', indexPath).toString().split(' ')[0]
}

function metadataOnly(base, head, paths) {
  return paths.length === 1 && paths[0] === indexPath && indexMode(base) === indexMode(head)
}

const releaseKey = ({ name, release }) => JSON.stringify([name, canonicalRepository(release.source.url), release.version])

function verifyCorrection(base, original, changes) {
  const remaining = new Map(changes.map((item) => [releaseKey(item), item]))
  const history = git('log', '--first-parent', '--full-history', '--format=%H', base, '--', indexPath)
    .toString().trim().split('\n').filter(Boolean)
  let after = original
  for (const revision of history) {
    const [, parent] = git('rev-list', '--parents', '-n1', revision).toString().trim().split(' ')
    if (!parent) break
    const before = indexedDocument(parent)
    const changed = [...remaining].filter(([, item]) => {
      const repo = canonicalRepository(item.release.source.url)
      const row = before.index.plugins.find((row) => row.name === item.name && canonicalRepository(row.repository?.url) === repo)
      return !equal(row?.versions.find((release) => release.version === item.release.version), item.release)
    })
    if (changed.length) {
      const transition = metadataOnly(parent, revision, changedPaths(parent, revision)) && providesChange(before, after)
      for (const [key, item] of changed) {
        if (transition?.kind !== 'enrich' || !transition.changes.some((change) =>
          releaseKey(change) === key && equal(change.release, item.release))) {
          fail(`${item.name}@${item.release.version}: field was not introduced by an index-only enrichment on trusted base history`)
        }
        console.log(`${item.name}@${item.release.version}: enrichment recorded at ${revision}; maintainer review required`)
        remaining.delete(key)
      }
      if (!remaining.size) return
    }
    after = before
  }
  fail('Could not prove enrichment on trusted first-parent base history')
}

function validateNewRelease(name, release) {
  const where = `${name}@${release.version}`
  if (!validProvides(release.provides)) fail(`${where}: new releases require provides from the pinned root package.json`)
  if (!validTimestamp(release.publishTimestamp)) fail(`${where}: expected a Git committer time in integer seconds`)
  if (!object(release.engines) || Object.keys(release.engines).some((key) => key !== 'agh') ||
      (Object.hasOwn(release.engines, 'agh') && !validAghRange(release.engines.agh))) {
    fail(`${where}: expected engines: {} or a supported engines.agh range of at most 500 UTF-16 code units`)
  }
}

export async function validateCatalog({ base, head, generatedOnly = false } = {}) {
  if ((base !== undefined && !sha.test(base)) || (head !== undefined && (!base || !sha.test(head))) ||
    (generatedOnly && !head)) {
    fail('Usage: node tools/validate-index.mjs [BASE_SHA [CANDIDATE_SHA]]')
  }
  const current = validateIndex(head)
  validateReadmes(current.plugins, head, base, generatedOnly)
  if (!base) return current.entries.size

  const paths = changedPaths(base, head)
  const guides = ['docs/submit-plugin.md', 'docs/submit-plugin.zh-CN.md']
  if (head && paths.filter((path) => guides.includes(path)).length === 1) {
    fail('Update both contribution tutorials together: docs/submit-plugin.md and docs/submit-plugin.zh-CN.md')
  }
  const previous = validateIndex(base)
  const metadata = providesChange(previous, current)
  if (metadata) {
    if (generatedOnly) fail('Metadata maintenance requires manual review and cannot be published automatically')
    if (!metadataOnly(base, head, paths)) fail('Metadata maintenance must change only docs/index.json without changing its file mode')
    if (metadata.kind === 'correct') verifyCorrection(base, previous, metadata.changes)
    else {
      const readMetadata = readReleaseMetadata({ historical: true })
      for (const { name, release } of metadata.changes) {
        verifyReleaseMetadata(name, release, await readMetadata(name, release))
      }
    }
    return current.entries.size
  }

  const submissions = new Map()
  const previousRepos = new Map([...previous.entries].map(([key, row]) => [row.name, key]))
  for (const [key, { name, releases }] of current.entries) {
    if (previousRepos.has(name) && previousRepos.get(name) !== key) fail(`${name}: do not change the source repository of a listed package`)
    const old = previous.entries.get(key)
    if (old && old.name !== name) fail(`${key}: do not change the package identity of a listed repository`)
    const added = []
    for (const [version, release] of releases) {
      const retained = old?.releases.get(version)
      if (retained) {
        if (!equal(retained, release)) fail(`${key}@${version}: an indexed release cannot change outside index-only metadata maintenance`)
        continue
      }
      if (old && current.pins.get(key)?.get(version) !== release.source.commit) {
        fail(`${key}@${version}: declare the intended update in plugins.txt with # pin: URL VERSION COMMIT`)
      }
      validateNewRelease(name, release)
      added.push(release)
    }
    if (old) {
      const removed = [...old.releases.keys()].filter((version) => !releases.has(version))
      if (removed.length && (!added.length || removed.some((version) => !added.some((release) => newerRelease(release.version, version))))) {
        fail(`${key}: do not drop versions without an explicitly pinned newer replacement`)
      }
    }
    if (added.length) submissions.set(key, { name, releases: added })
  }
  const readMetadata = readReleaseMetadata()
  for (const [key, { name, releases }] of submissions) {
    await validateTopic(key)
    for (const release of releases) {
      verifyReleaseMetadata(name, release, await readMetadata(name, release), { checkTime: true })
    }
  }
  return current.entries.size
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [base, head, ...extra] = process.argv.slice(2)
    if (extra.length) fail('Usage: node tools/validate-index.mjs [BASE_SHA [CANDIDATE_SHA]]')
    const count = await validateCatalog({ base, head })
    console.log(`Market index, sources, and README tables valid: ${count} plugins.`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
