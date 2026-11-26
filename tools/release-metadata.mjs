import { isUtf8 } from 'node:buffer'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { canonicalRepository } from './public-submission.mjs'

export const fullSha = /^[0-9a-f]{40}$/
export const maxManifestBytes = 256 * 1024
const maxObjectBytes = 2 * 1024 * 1024
const maxAnnotatedTags = 4
const kinds = new Set(['tool', 'loop', 'model-adapter', 'mcp', 'skills', 'ui', 'bundle', 'service'])
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isSha = (value) => typeof value === 'string' && fullSha.test(value)

export function validProvides(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= kinds.size &&
    value.every((kind) => kinds.has(kind)) && new Set(value).size === value.length
}

export function manifestProvides(pkg, { name, version }) {
  if (!record(pkg) || pkg.name !== name || pkg.version !== version) {
    throw new Error('root package.json does not match the indexed package name and version')
  }
  const { agnes } = pkg
  if (agnes === undefined) return undefined
  if (!record(agnes)) throw new Error('invalid package.json agnes declaration')
  if (!Object.hasOwn(agnes, 'provides')) return undefined
  if (!validProvides(agnes.provides)) throw new Error('invalid package.json agnes.provides; use 1–8 distinct documented types')
  return agnes.provides
}

export function validTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 253402300799
}

// Syntax from AGH extension-api/src/api-range.ts. This repository checks the
// author's declaration, not whether it matches a particular AGH build.
const number = '(0|[1-9]\\d*)'
const semver = new RegExp(`^${number}\\.${number}\\.${number}(?:-([0-9A-Za-z.-]+))?(?:\\+([0-9A-Za-z.-]+))?$`)
const wildcard = new RegExp(`^${number}(?:\\.${number})?\\.(x|\\*)$`)
const caretPair = new RegExp(`^${number}\\.${number}$`)

export function validAghRange(value) {
  if (typeof value !== 'string' || value.length > 500 || !value.trim()) return false
  return value.trim().split(/\s+/).every((token) => {
    if (token === '*' || wildcard.test(token)) return true
    const [, op, body] = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(token)
    const match = semver.exec(op === '^' && caretPair.test(body) ? `${body}.0` : body)
    return !!match && match.slice(1, 4).every((part) => Number.isSafeInteger(Number(part))) &&
      !match[4]?.split('.').some((part) => !part || /^0\d+$/.test(part)) &&
      !match[5]?.split('.').some((part) => !part)
  })
}

export function newerRelease(candidate, previous) {
  const parts = candidate.split('.')
  const old = previous.split('.')
  for (let i = 0; i < 3; i++) {
    if (parts[i].length !== old[i].length) return parts[i].length > old[i].length
    if (parts[i] !== old[i]) return parts[i] > old[i]
  }
  return false
}

async function githubJson(repo, path, label, signal, allowMissing = false) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', redirect: 'error', signal,
  }).catch(() => {
    const reason = signal.aborted ? 'Git verification timed out' : 'network failure or redirect'
    throw new Error(`could not read GitHub ${label} (${reason})`)
  })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    if (allowMissing && response.status === 404) return undefined
    throw new Error(`could not read GitHub ${label} (HTTP ${response.status})`)
  }
  const chunks = []
  let size = 0
  try {
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > maxObjectBytes) throw new Error(`GitHub ${label} response exceeds 2 MiB`)
      chunks.push(chunk)
    }
  } catch (error) {
    if (signal.aborted) throw new Error(`could not read GitHub ${label} (Git verification timed out)`)
    throw error
  }
  try { return JSON.parse(Buffer.concat(chunks, size)) } catch {
    throw new Error(`GitHub returned invalid ${label} JSON`)
  }
}

async function gitObject(repo, kind, sha, signal) {
  const value = await githubJson(repo, `git/${kind}/${sha}`, `Git ${kind} object`, signal)
  if (value?.sha !== sha) throw new Error(`GitHub Git ${kind} object did not match the requested SHA`)
  return value
}

async function tagMatches(repo, version, sha, signal) {
  const tag = `tags/v${encodeURIComponent(version)}`
  const ref = await githubJson(repo, `git/ref/${tag}`, `refs/${tag}`, signal, true)
  if (ref === undefined) return false
  if (ref?.ref !== `refs/${tag}`) throw new Error(`GitHub did not return refs/${tag}`)
  let target = ref.object
  for (let depth = 0; ; depth++) {
    if (!isSha(target?.sha)) throw new Error(`GitHub refs/${tag} has no valid Git object SHA`)
    if (target.type === 'commit') return target.sha === sha
    if (target.type !== 'tag') return false
    if (depth === maxAnnotatedTags) throw new Error(`GitHub refs/${tag} has too many annotated tags`)
    target = (await gitObject(repo, 'tags', target.sha, signal)).object
  }
}

async function verifyRepositoryPin(repo, version, sha, historical, signal) {
  if (await tagMatches(repo, version, sha, signal)) return
  if (!historical) throw new Error(`refs/tags/v${version} in the listed repository does not resolve to the pinned commit`)

  // Omitting the `sha` filter starts the list at the repository's default branch HEAD.
  const commits = await githubJson(repo, 'commits?per_page=1', 'default HEAD', signal)
  const tip = Array.isArray(commits) && commits.length === 1 ? commits[0]?.sha : undefined
  if (!isSha(tip)) throw new Error('GitHub default HEAD has no valid commit SHA')
  if (tip === sha) return
  // Without pagination, GitHub puts the comparison head last even if it caps the commit list.
  const comparison = await githubJson(repo, `compare/${sha}...${tip}`, 'default HEAD comparison', signal)
  if (comparison?.status !== 'ahead' || comparison.base_commit?.sha !== sha || comparison.merge_base_commit?.sha !== sha ||
      !Array.isArray(comparison.commits) || comparison.commits.at(-1)?.sha !== tip) {
    throw new Error('default HEAD comparison does not prove the pinned commit is its ancestor')
  }
}

async function pinnedManifest(repo, sha, signal) {
  const commit = await gitObject(repo, 'commits', sha, signal)
  const treeSha = commit.tree?.sha
  if (!isSha(treeSha)) throw new Error('commit has no valid root tree SHA')
  const tree = await gitObject(repo, 'trees', treeSha, signal)
  if (tree.truncated !== false || !Array.isArray(tree.tree)) throw new Error('GitHub root tree was incomplete')
  const manifests = tree.tree.filter((entry) => entry?.path === 'package.json')
  const [manifest] = manifests
  if (manifests.length !== 1 || manifest.type !== 'blob' || !['100644', '100755'].includes(manifest.mode) ||
      !isSha(manifest.sha)) {
    throw new Error('expected a regular root package.json at the pinned commit')
  }
  if (!Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size > maxManifestBytes) {
    throw new Error('root package.json must be between 1 byte and 256 KiB')
  }
  const blob = await gitObject(repo, 'blobs', manifest.sha, signal)
  if (blob.encoding !== 'base64' || blob.size !== manifest.size || typeof blob.content !== 'string') {
    throw new Error('GitHub returned invalid root package.json blob data')
  }
  const bytes = Buffer.from(blob.content, 'base64')
  if (bytes.length !== manifest.size || !isUtf8(bytes) ||
      createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== manifest.sha) {
    throw new Error('root package.json bytes did not match the Git blob')
  }
  // The Git commits API is not a GitHub Release API. committer.date is the
  // commit object's committer time (git show --format=%ct), not author.date.
  const date = commit.committer?.date
  const millis = typeof date === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(date) ? Date.parse(date) : NaN
  const publishTimestamp = millis / 1000
  const timestamp = validTimestamp(publishTimestamp) && new Date(millis).toISOString() === date.replace('Z', '.000Z')
    ? publishTimestamp : undefined
  let pkg
  try { pkg = JSON.parse(bytes) } catch {
    throw new Error('pinned root package.json is not valid JSON')
  }
  return { pkg, publishTimestamp: timestamp }
}

export function readReleaseMetadata({ historical = false } = {}) {
  const manifests = new Map()
  return async (name, release) => {
    const { version, source } = release
    const repo = canonicalRepository(source?.url)
    const sha = source?.commit
    if (source?.type !== 'git' || !repo || !isSha(sha)) {
      throw new Error(`${name}@${version}: expected a public GitHub repository and full commit SHA`)
    }
    const key = `${repo}#${sha}`
    try {
      const signal = AbortSignal.timeout(15_000)
      await verifyRepositoryPin(repo, version, sha, historical, signal)
      if (!manifests.has(key)) manifests.set(key, pinnedManifest(repo, sha, signal))
      const { pkg, publishTimestamp } = await manifests.get(key)
      return { provides: manifestProvides(pkg, { name, version }), publishTimestamp, aghRange: pkg.engines?.agh }
    } catch (error) {
      throw new Error(`${name}@${version} (${key}): ${error.message}`)
    }
  }
}

export function verifyReleaseMetadata(name, release, facts, { newRelease = false } = {}) {
  const where = `${name}@${release.version}`
  if (facts.provides === undefined) throw new Error(`${where}: pinned root package.json has no agnes.provides`)
  if (!isDeepStrictEqual(release.provides, facts.provides)) {
    throw new Error(`${where}: indexed provides must match the pinned package.json agnes.provides exactly`)
  }
  if (!newRelease) return
  if (!validTimestamp(release.publishTimestamp) || release.publishTimestamp !== facts.publishTimestamp) {
    throw new Error(`${where}: publishTimestamp must equal the pinned Git commit's committer time (%ct) in seconds`)
  }
  if (!validAghRange(facts.aghRange)) {
    throw new Error(`${where}: pinned root package.json must declare a supported engines.agh range of at most 500 UTF-16 code units`)
  }
  if (release.engines.agh !== facts.aghRange) {
    throw new Error(`${where}: indexed engines.agh must match the pinned root package.json engines.agh exactly`)
  }
}
