import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { isDeepStrictEqual as equal } from 'node:util'
import { publicRepository } from './public-submission.mjs'
import { readmeLocales } from './readme-tables.mjs'
import { validateCatalog } from './validate-index.mjs'
import { newerRelease, validAghRange, validProvides, validTimestamp } from './release-metadata.mjs'

const repository = 'AgnesAI-Labs/agh-plugin-market'
const repoApi = `repos/${repository}`
const index = 'docs/index.json'
const catalogPaths = new Set([index, 'plugins.txt', ...Object.keys(readmeLocales)])
const maxIndexBytes = 2 * 1024 * 1024
const releaseSources = new Set([
  'https://github.com/AgnesAI-Labs/agh-app-devboard',
  'https://github.com/AgnesAI-Labs/agh-app-pharma-gmp',
  'https://github.com/AgnesAI-Labs/agh-app-aerospace-quality',
])
const sha = /^[0-9a-f]{40}$/
const digest = /^[0-9a-f]{64}$/
const prNumber = (n) => Number.isSafeInteger(n) && n > 0
const log = (message) => console.log(message)
const includesIndexGate = (rule) => rule.type === 'required_status_checks'
  && rule.parameters?.strict_required_status_checks_policy === true
  && rule.parameters.required_status_checks?.some(({ context, integration_id }) => context === 'market / validate-index' && integration_id === 15368)
const stable = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/

function run(command, args, options = {}) {
  return spawnSync(command, args, { maxBuffer: 16 * 1024 * 1024, timeout: 60_000, ...options })
}

function git(args, options) {
  return run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'http.followRedirects=false',
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', ...args], options)
}

function checked(result, message) {
  if (result.error || result.status !== 0) throw new Error(message)
  return result.stdout
}

function api(path, { pages = false, payload } = {}) {
  const args = ['api', '--hostname', 'github.com', `${repoApi}/${path}`]
  if (pages) args.push('--paginate', '--slurp')
  if (payload) args.push('--method', 'PUT', '--input', '-')
  const result = run('gh', args, { input: payload && JSON.stringify(payload) })
  const data = JSON.parse(checked(result, 'GitHub API request did not complete.'))
  return pages ? data.flat() : data
}

const mainSha = () => api('git/ref/heads/main').object?.sha
const checkedOutSha = () => String(checked(git(['rev-parse', 'HEAD']), 'Trusted checkout is not available.')).trim()
const prMetadata = ({ title, body, head, user }) => createHash('sha256')
  .update(JSON.stringify([title, body, head.repo?.full_name, user?.id])).digest('hex')

export function planFor(pr, base) {
  if (!prNumber(pr.number) || pr.state !== 'open' || pr.draft !== false || pr.merged !== false || pr.mergeable !== true
    || pr.base?.repo?.full_name !== repository || pr.base.ref !== 'main' || pr.base.sha !== base
    || !sha.test(base ?? '') || !sha.test(pr.head?.sha ?? '') || pr.head.sha === base
    || typeof pr.title !== 'string'
    || (pr.body !== null && typeof pr.body !== 'string')) return null
  return { number: pr.number, base, head: pr.head.sha, metadata: prMetadata(pr) }
}

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const keysWithin = (value, keys) => record(value) && Object.keys(value).every((key) => keys.includes(key))
const plainText = (value) => typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[<>]/.test(value)
const copyText = (value) => plainText(value) || (record(value) && Object.keys(value).length > 0
  && Object.entries(value).every(([locale, text]) => ['en', 'zh-cn'].includes(locale) && plainText(text)))

function validRelease(release, url) {
  return keysWithin(release, ['version', 'source', 'publishTimestamp', 'engines', 'provides']) && stable.test(release.version)
    && keysWithin(release.source, ['type', 'url', 'commit']) && release.source.type === 'git'
    && release.source.url === url && sha.test(release.source.commit)
    && validTimestamp(release.publishTimestamp) && validProvides(release.provides)
    && keysWithin(release.engines, ['agh'])
    && (!Object.hasOwn(release.engines, 'agh') || validAghRange(release.engines.agh))
}

function isNewListing(row) {
  if (!keysWithin(row, ['name', 'repository', 'versions', 'title', 'description', 'homepage', 'author', 'metadata'])
    || !keysWithin(row.repository, ['url']) || !publicRepository(row.name, row.repository.url)
    || row.versions.length !== 1 || !validRelease(row.versions[0], row.repository.url)) return false
  if ((row.title !== undefined && !copyText(row.title)) || (row.description !== undefined && !copyText(row.description))
    || (row.homepage !== undefined && row.homepage !== row.repository.url)
    || (row.author !== undefined && (!plainText(row.author) || row.author.toLowerCase() !== row.repository.url.split('/')[3].toLowerCase()))) return false
  if (row.metadata === undefined) return true
  return keysWithin(row.metadata, ['keywords', 'labels', 'sortKeys'])
    && Array.isArray(row.metadata.keywords) && row.metadata.keywords.length <= 32
    && row.metadata.keywords.every((word) => plainText(word) && word.length <= 64)
    && equal(row.metadata.labels, []) && equal(row.metadata.sortKeys, {})
}

function isReleaseUpdate(before, after) {
  const { versions: old, ...oldFields } = before
  const { versions: releases, ...fields } = after
  const url = before.repository?.url
  if ((!releaseSources.has(url) && !publicRepository(before.name, url)) || !equal(oldFields, fields)) return false
  const known = new Map(old.map((release) => [release.version, release]))
  let additions = 0
  for (const release of releases) {
    const previous = known.get(release.version)
    if (previous) {
      if (!equal(previous, release)) return false
      continue
    }
    if (!validRelease(release, url) || !old.every((previous) => newerRelease(release.version, previous.version))) return false
    additions++
  }
  return additions > 0
}

// Both indexes must already have passed the installed market validator.
export function catalogChange(before, after, { sameRepository, sourcesChanged }) {
  if (equal(before, after)) return null
  const { title, description } = after
  if (equal({ ...before, title, description }, after)) {
    return sameRepository && !sourcesChanged && copyText(title) && copyText(description) ? 'catalog-copy' : null
  }
  const { plugins: old, ...oldCatalog } = before
  const { plugins, ...catalog } = after
  if (!sourcesChanged || !equal(oldCatalog, catalog)) return null
  if (plugins.length === old.length + 1 && old.every((row, i) => equal(row, plugins[i])) && isNewListing(plugins.at(-1))) {
    return 'new-listing'
  }
  if (old.length !== plugins.length) return null
  return old.every((row, i) => equal(row, plugins[i]) || isReleaseUpdate(row, plugins[i])) ? 'release-update' : null
}

function readIndex(ref) {
  return JSON.parse(checked(git(['cat-file', 'blob', `${ref}:${index}`], { maxBuffer: maxIndexBytes + 1 }),
    'Could not read the pinned catalog.'))
}

function sourceList(ref) {
  return String(checked(git(['cat-file', 'blob', `${ref}:plugins.txt`], { maxBuffer: maxIndexBytes + 1 }),
    'Could not read the pinned source list.')).trimEnd().split(/\r?\n/)
}

function sourcesMatch(kind, base, head, next) {
  if (kind === 'new-listing') return equal([...base, next.plugins.at(-1).repository.url], head)
  const withoutPins = (lines) => lines.filter((line) => !line.trimStart().startsWith('# pin:'))
  return equal(withoutPins(base), withoutPins(head))
}

// Both refs have already been verified against the PR and the trusted main checkout.
export async function candidateCatalog(base, head, sameRepository) {
  const paths = checked(git(['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', base, head]), 'Could not list PR paths.')
  const changed = paths.toString().split('\0').slice(0, -1)
  if (!changed.includes(index) || changed.some((path) => !catalogPaths.has(path))) {
    return { reason: 'only catalog submissions can be merged automatically' }
  }
  const entries = String(checked(git(['ls-tree', head, '--', ...catalogPaths]), 'Could not read catalog Git entries.')).trimEnd().split('\n')
  if (entries.length !== catalogPaths.size || entries.some((entry) => {
    const match = /^100644 blob [0-9a-f]{40}\t(.+)$/.exec(entry)
    return !match || !catalogPaths.has(match[1])
  })) {
    return { reason: 'catalog inputs and READMEs must be regular non-executable files' }
  }
  try {
    await validateCatalog({ base, head, generatedOnly: true })
  } catch {
    return { reason: 'index, pinned release metadata, submission Topic, or generated-only README validation did not pass' }
  }
  const sourcesChanged = changed.includes('plugins.txt')
  const next = readIndex(head)
  const kind = catalogChange(readIndex(base), next, { sameRepository, sourcesChanged })
  if (!kind || (sourcesChanged && !sourcesMatch(kind, sourceList(base), sourceList(head), next))) {
    return { reason: 'catalog changes do not qualify for unattended publication' }
  }
  return { kind }
}

function output(key, value) {
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`, { flag: 'a' })
}

async function audit() {
  const base = checkedOutSha()
  if (!sha.test(base) || mainSha() !== base) {
    log('main moved since checkout; no candidate can be authorized in this run.')
    return
  }
  const pulls = api('pulls?state=open&base=main&sort=created&direction=asc&per_page=100', { pages: true })
  for (const listed of pulls) {
    if (!prNumber(listed.number) || listed.draft) continue
    const pr = api(`pulls/${listed.number}`)
    const plan = planFor(pr, base)
    if (!plan) continue
    const { number, head } = plan
    const fetched = git(['fetch', '--no-tags', '--no-recurse-submodules', 'origin', `refs/pull/${number}/head`])
    if (fetched.status !== 0 || fetched.error || String(checked(git(['rev-parse', 'FETCH_HEAD']), 'Cannot resolve fetched PR.')).trim() !== head
      || git(['merge-base', '--is-ancestor', base, head]).status !== 0) {
      log(`PR #${number}: could not verify the current head against main.`)
      continue
    }
    const { kind, reason } = await candidateCatalog(base, head, pr.head.repo?.full_name === repository)
    if (!kind) {
      log(`PR #${number}: ${reason}.`)
      continue
    }
    const dir = mkdtempSync(join(tmpdir(), 'market-publication-'))
    try {
      const env = { ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' }
      const event = join(dir, 'event.json')
      writeFileSync(event, JSON.stringify({ pull_request: pr }), { mode: 0o600 })
      const evidence = join(dir, 'outcome.txt')
      writeFileSync(evidence, '', { mode: 0o600 })
      log(`PR #${number}: fresh release review (${kind}).`)
      const review = run(process.execPath, ['tools/review-release.mjs', base, head, event], {
        env: { ...env, GITHUB_OUTPUT: evidence }, timeout: 11 * 60_000,
      })
      if (review.stdout) process.stdout.write(review.stdout)
      if (review.error || review.status !== 0 || readFileSync(evidence, 'utf8') !== 'outcome=passed\n') {
        log(`PR #${number}: machine review did not pass; no merge authorized.`)
        continue
      }
      log(`PR #${number}: current head is eligible for merge.`)
      output('plan', JSON.stringify(plan))
      return
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  log('No catalog submission qualifies for unattended publication.')
}

function merge(text) {
  const plan = JSON.parse(text)
  const { number, base, head, metadata } = plan
  if (!prNumber(number) || !sha.test(base ?? '') || !sha.test(head ?? '') || !digest.test(metadata ?? '')
    || !process.env.GH_TOKEN) throw new Error('Invalid merge plan or missing Actions token.')
  const rules = api('rules/branches/main')
  if (!rules.some(includesIndexGate) || !rules.some((rule) => rule.type === 'pull_request')) {
    throw new Error('Required main protections are not active; no merge attempted.')
  }
  if (checkedOutSha() !== base || mainSha() !== base) {
    log('main moved after audit; no merge attempted.')
    return
  }
  const current = planFor(api(`pulls/${number}`), base)
  if (!current || current.head !== head || current.metadata !== metadata) {
    log(`PR #${number} changed after audit; no merge attempted.`)
    return
  }
  const result = api(`pulls/${number}/merge`, {
    payload: { sha: head, merge_method: 'squash', commit_title: `Market: publish eligible PR #${number}`, commit_message: 'Machine-reviewed catalog submission.' },
  })
  if (result.merged !== true || !sha.test(result.sha ?? '')) throw new Error('GitHub did not confirm the merge.')
  log(`PR #${number} merged as ${result.sha}.`)
  output('merged_sha', result.sha)
}

async function matchesPage(url, expected) {
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5_000) })
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      return false
    }
    let size = 0
    for await (const chunk of response.body) {
      const end = size + chunk.length
      if (end > expected.length || !expected.subarray(size, end).equals(chunk)) return false
      size = end
    }
    return size === expected.length
  } catch { // Pages can be unavailable while redeploying.
    return false
  }
}

async function verifyPages(revision, site) {
  if (!sha.test(revision ?? '') || checkedOutSha() !== revision) throw new Error('Pages verification must use the deployed checkout.')
  const committed = checked(git(['cat-file', 'blob', `${revision}:${index}`], { maxBuffer: maxIndexBytes + 1 }), 'Cannot read deployed index.')
  if (committed.length > maxIndexBytes) throw new Error('Deployed index is over the download limit.')
  const staged = readFileSync(join(site, 'index.json'))
  if (!staged.equals(committed)) throw new Error(`The staged index does not match ${revision}.`)

  const assets = [
    ['index.json', staged],
    ...['plugins.html', 'plugins.zh-CN.html', 'plugins.svg', 'plugins.zh-CN.svg']
      .map((name) => [name, readFileSync(join(site, name))]),
  ].map(([name, expected]) => ({
    name, expected, url: new URL(`https://agnesai-labs.github.io/agh-plugin-market/${name}`),
  }))
  let mismatches
  for (let attempt = 0; attempt < 18; attempt++) {
    const query = new URLSearchParams({ revision, attempt }).toString()
    const matches = await Promise.all(assets.map(({ url, expected }) => {
      url.search = query
      return matchesPage(url, expected)
    }))
    if (matches.every(Boolean)) {
      log(`Pages serves the exact staged index and catalog assets from ${revision}.`)
      return
    }
    mismatches = assets.filter((_, i) => !matches[i]).map(({ name }) => name)
    if (attempt < 17) await delay(10_000)
  }
  throw new Error(`Pages assets did not match ${revision} within the verification window: ${mismatches.join(', ')}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Publisher must run against the trusted main checkout.')
    const [mode, arg, ...rest] = process.argv.slice(2)
    if (mode === 'audit' && !arg && rest.length === 0) await audit()
    else if (mode === 'merge' && arg && rest.length === 0) merge(arg)
    else if (mode === 'verify-pages' && arg && rest.length === 1 && rest[0]) await verifyPages(arg, rest[0])
    else throw new Error('Usage: publish-release.mjs audit | merge PLAN | verify-pages DEPLOYED_SHA SITE_DIR')
  } catch (error) {
    // Unknown errors can contain API responses, commit content or other untrusted input.
    console.error(error.constructor === Error ? error.message : 'Market publication could not complete.')
    process.exitCode = 1
  }
}
