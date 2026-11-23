import { execFileSync } from 'node:child_process'
import { readFileSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readmeLocales, replaceReadmeTable } from './readme-tables.mjs'

// AGH community-discovery.ts limits the uncompressed response body to 2 MiB.
const maxBytes = 2 * 1024 * 1024
const sha = /^[0-9a-f]{40}$/
const version = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const indexPath = 'docs/index.json'
const git = (...args) => execFileSync('git', args, { maxBuffer: maxBytes + 1024, timeout: 60_000 })
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
  const match = typeof url === 'string' && /^https:\/\/github\.com\/([a-z0-9][a-z0-9-]{0,38})\/([a-z0-9_.-]{1,100})$/i.exec(url)
  if (!match || /^\.{1,2}$|\.git$/i.test(match[2])) fail(`${where}: expected https://github.com/OWNER/REPO`)
  return `${match[1]}/${match[2]}`.toLowerCase()
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

export function validateIndex(ref) {
  const { urls, pins } = readSources(ref)
  const index = JSON.parse(readCatalogFile(indexPath, ref))
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
      releases.set(entry.version, source.commit)
    }
    entries.set(key, { name: row.name, releases })
  }
  if (urls.size) fail(`plugins.txt: missing from the index: ${[...urls].join(', ')}`)
  for (const [key, releases] of pins) {
    for (const [release, commit] of releases) {
      if (entries.get(key)?.releases.get(release) !== commit) fail(`plugins.txt: pin does not match the index for ${key}@${release}`)
    }
  }
  return { entries, pins, plugins: index.plugins }
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

export async function validateCatalog({ base, head, generatedOnly = false } = {}) {
  if ((base !== undefined && !sha.test(base)) || (head !== undefined && (!base || !sha.test(head))) ||
    (generatedOnly && !head)) {
    fail('Usage: node tools/validate-index.mjs [BASE_SHA [CANDIDATE_SHA]]')
  }
  const current = validateIndex(head)
  validateReadmes(current.plugins, head, base, generatedOnly)
  const submissions = []
  if (base) {
    const previous = validateIndex(base).entries
    const previousRepos = new Map([...previous].map(([key, row]) => [row.name, key]))
    for (const [key, row] of current.entries) {
      if (previousRepos.has(row.name) && previousRepos.get(row.name) !== key) fail(`${row.name}: do not change the source repository of a listed package`)
      if (!previous.has(key)) submissions.push(key)
    }
    for (const [key, before] of previous) {
      const after = current.entries.get(key)
      if (!after) continue // A removal must remove the matching plugins.txt row as well.
      if (before.name !== after.name) fail(`${key}: do not change the package identity of a listed repository`)
      let added = false
      for (const [release, commit] of after.releases) {
        if (before.releases.has(release)) {
          if (before.releases.get(release) !== commit) fail(`${key}@${release}: an indexed release cannot change its commit`)
        } else {
          if (current.pins.get(key)?.get(release) !== commit) fail(`${key}@${release}: declare the intended update in plugins.txt with # pin: URL VERSION COMMIT`)
          added = true
        }
      }
      if (!added && after.releases.size < before.releases.size) fail(`${key}: do not drop versions without an explicitly pinned replacement`)
      if (added) submissions.push(key)
    }
  }
  if (head) {
    const tutorials = ['docs/submit-plugin.md', 'docs/submit-plugin.zh-CN.md']
    const changed = git('diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', base, head, '--', ...tutorials)
      .toString('utf8').split('\0').filter(Boolean)
    if (changed.length === 1) fail('Update both contribution tutorials together: docs/submit-plugin.md and docs/submit-plugin.zh-CN.md')
  }
  for (const repo of submissions) await validateTopic(repo)
  return current.entries.size
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [base, head, ...extra] = process.argv.slice(2)
    if (extra.length) fail('Usage: node tools/validate-index.mjs [BASE_SHA [CANDIDATE_SHA]]')
    const count = await validateCatalog({ base, head })
    console.log(`Market index, sources, and README tables valid: ${count} plugins.${base ? ' Submission Topics verified.' : ''}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
