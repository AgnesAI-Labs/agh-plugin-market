import { execFileSync } from 'node:child_process'
import { readFileSync, lstatSync } from 'node:fs'

// AGH community-discovery.ts limits the uncompressed response body to 2 MiB.
const maxBytes = 2 * 1024 * 1024
const sha = /^[0-9a-f]{40}$/
const version = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const indexPath = 'docs/index.json'
const git = (...args) => execFileSync('git', args, { maxBuffer: maxBytes + 1024, encoding: 'utf8' })
const fail = (message) => { throw new Error(message) }
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value) => typeof value === 'string' || (object(value) && Object.values(value).every((item) => typeof item === 'string'))

function read(path, ref) {
  if (ref) {
    if (!/^100(?:644|755) blob /.test(git('ls-tree', ref, '--', path))) fail(`${path}: expected a regular file`)
    const blob = `${ref}:${path}`
    if (Number(git('cat-file', '-s', blob)) > maxBytes) fail(`${path}: exceeds 2 MiB (${maxBytes} bytes)`)
    return git('cat-file', 'blob', blob)
  }
  const stat = lstatSync(path)
  if (!stat.isFile()) fail(`${path}: expected a regular file`)
  if (stat.size > maxBytes) fail(`${path}: exceeds 2 MiB (${maxBytes} bytes)`)
  return readFileSync(path, 'utf8')
}

function repository(url, where) {
  const match = typeof url === 'string' && /^https:\/\/github\.com\/([a-z0-9][a-z0-9-]{0,38})\/([a-z0-9_.-]{1,100})$/i.exec(url)
  if (!match || /^\.{1,2}$|\.git$/i.test(match[2])) fail(`${where}: expected https://github.com/OWNER/REPO`)
  return `${match[1]}/${match[2]}`.toLowerCase()
}

function readSources(ref) {
  const urls = new Set()
  const pins = new Map()
  for (const [i, raw] of read('plugins.txt', ref).split('\n').entries()) {
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

function validate(ref) {
  const { urls, pins } = readSources(ref)
  const index = JSON.parse(read(indexPath, ref))
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
  return { entries, pins }
}

try {
  const [base, head, ...extra] = process.argv.slice(2)
  if (extra.length || (base && !sha.test(base)) || (head && !sha.test(head))) fail('Usage: node tools/validate-index.mjs [BASE_SHA [CANDIDATE_SHA]]')
  const current = validate(head)
  if (base) {
    const previous = validate(base).entries
    const previousRepos = new Map([...previous].map(([key, row]) => [row.name, key]))
    for (const [key, row] of current.entries) {
      if (previousRepos.has(row.name) && previousRepos.get(row.name) !== key) fail(`${row.name}: do not change the source repository of a listed package`)
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
    }
  }
  console.log(`Market index valid: ${current.entries.size} plugins.`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
