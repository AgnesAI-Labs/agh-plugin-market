import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const repository = 'AgnesAI-Labs/agh-plugin-market'
const repoApi = `repos/${repository}`
const index = 'docs/index.json'
const maxIndexBytes = 2 * 1024 * 1024
const sha = /^[0-9a-f]{40}$/
const digest = /^[0-9a-f]{64}$/
const prNumber = (n) => Number.isSafeInteger(n) && n > 0
const log = (message) => console.log(message)
const includesIndexGate = (rule) => rule.type === 'required_status_checks'
  && rule.parameters?.strict_required_status_checks_policy === true
  && rule.parameters.required_status_checks?.some(({ context, integration_id }) => context === 'market / validate-index' && integration_id === 15368)
const includesApprovalGate = (rule) => rule.type === 'pull_request'
  && rule.parameters?.required_approving_review_count >= 1
  && rule.parameters.dismiss_stale_reviews_on_push === true

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

function api(path, { pages = false, payload, token = process.env.GH_TOKEN } = {}) {
  const args = ['api', '--hostname', 'github.com', `${repoApi}/${path}`]
  if (pages) args.push('--paginate', '--slurp')
  if (payload) args.push('--method', 'PUT', '--input', '-')
  const result = run('gh', args, { env: { ...process.env, GH_TOKEN: token }, input: payload && JSON.stringify(payload) })
  const data = JSON.parse(checked(result, 'GitHub API request did not complete.'))
  return pages ? data.flat() : data
}

const mainSha = () => api('git/ref/heads/main').object?.sha
const checkedOutSha = () => String(checked(git(['rev-parse', 'HEAD']), 'Trusted checkout is not available.')).trim()
const prMetadata = ({ title, body }) => createHash('sha256').update(JSON.stringify([title, body])).digest('hex')

// Only a current, independent human review counts. A newer comment is not a review decision.
function currentApprovals(reviews, head, author) {
  const decisions = new Map()
  for (const review of reviews) {
    if (review.user?.type !== 'User' || !Number.isSafeInteger(review.user.id) || review.user.id === author) continue
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) decisions.set(review.user.id, review)
  }
  return [...decisions.values()].filter((review) => review.state === 'APPROVED' && review.commit_id === head
    && /^[a-z\d](?:[a-z\d-]{0,38})$/i.test(review.user.login))
}

export function planFor(pr, base, request = api) {
  if (!prNumber(pr.number) || pr.state !== 'open' || pr.draft !== false || pr.merged !== false || pr.mergeable !== true
    || pr.base?.repo?.full_name !== repository || pr.base.ref !== 'main' || pr.base.sha !== base
    || !sha.test(base ?? '') || !sha.test(pr.head?.sha ?? '') || pr.head.sha === base
    || !Number.isSafeInteger(pr.user?.id) || typeof pr.title !== 'string'
    || (pr.body !== null && typeof pr.body !== 'string')) return null
  const head = pr.head.sha
  const candidate = { number: pr.number, base, head, metadata: prMetadata(pr) }
  const reviews = request(`pulls/${pr.number}/reviews?per_page=100`, { pages: true })
  for (const review of currentApprovals(reviews, head, pr.user.id)) {
    const access = request(`collaborators/${review.user.login}/permission`)
    if (access.user?.id === review.user.id && ['write', 'maintain', 'admin'].includes(access.permission)) return candidate
  }
  return null
}

function output(key, value) {
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`, { flag: 'a' })
}

function audit() {
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
    const paths = checked(git(['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', base, head]), 'Could not list PR paths.')
    const changed = paths.toString().split('\0').slice(0, -1)
    if (!changed.includes(index) || changed.some((path) => path !== index && path !== 'plugins.txt')) {
      log(`PR #${number}: only catalog submissions can be merged automatically.`)
      continue
    }
    const entries = String(checked(git(['ls-tree', head, '--', index, 'plugins.txt']), 'Could not read catalog Git entries.')).trimEnd().split('\n')
    if (entries.length !== 2 || entries.some((entry) => !/^100644 blob [0-9a-f]{40}\t(?:docs\/index\.json|plugins\.txt)$/.test(entry))) {
      log(`PR #${number}: catalog inputs are not both regular data files.`)
      continue
    }
    const dir = mkdtempSync(join(tmpdir(), 'market-publication-'))
    try {
      const env = { ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' }
      const validation = run(process.execPath, ['tools/validate-index.mjs', base, head], { env })
      if (validation.error || validation.status !== 0) {
        log(`PR #${number}: index validation did not pass.`)
        continue
      }
      const event = join(dir, 'event.json')
      writeFileSync(event, JSON.stringify({ pull_request: pr }), { mode: 0o600 })
      log(`PR #${number}: fresh release review.`)
      const review = run(process.execPath, ['tools/review-release.mjs', base, head, event], { env, timeout: 11 * 60_000 })
      if (review.stdout) process.stdout.write(review.stdout)
      if (review.error || review.status !== 0) {
        log(`PR #${number}: review failed or did not complete; no merge authorized.`)
        continue
      }
      log(`PR #${number}: current head is eligible for merge.`)
      output('plan', JSON.stringify(plan))
      return
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  log('No approved catalog submission is ready for automatic merge.')
}

function merge(text) {
  const plan = JSON.parse(text)
  const { number, base, head, metadata } = plan
  if (!prNumber(number) || !sha.test(base ?? '') || !sha.test(head ?? '') || !digest.test(metadata ?? '')
    || !process.env.MARKET_PUBLISHER_TOKEN) throw new Error('Invalid merge plan or missing publisher token.')
  const rules = api('rules/branches/main')
  if (!rules.some(includesIndexGate) || !rules.some(includesApprovalGate)) {
    throw new Error('Required main protections are not active; no merge attempted.')
  }
  if (checkedOutSha() !== base || mainSha() !== base) {
    log('main moved after audit; no merge attempted.')
    return
  }
  const current = planFor(api(`pulls/${number}`), base)
  if (!current || current.head !== head || current.metadata !== metadata) {
    log(`PR #${number} or its approval changed after audit; no merge attempted.`)
    return
  }
  const result = api(`pulls/${number}/merge`, {
    token: process.env.MARKET_PUBLISHER_TOKEN,
    payload: { sha: head, merge_method: 'merge', commit_title: `Market: merge approved PR #${number}`, commit_message: 'Reviewed catalog submission.' },
  })
  if (result.merged !== true || !sha.test(result.sha ?? '')) throw new Error('GitHub did not confirm the merge.')
  log(`PR #${number} merged as ${result.sha}.`)
  output('merged_sha', result.sha)
}

async function verifyPages(merged) {
  if (!sha.test(merged ?? '')) throw new Error('Invalid merge SHA.')
  checked(git(['fetch', '--no-tags', '--no-recurse-submodules', '--depth=1', 'origin', merged]), 'Cannot fetch merged index.')
  const expected = checked(git(['cat-file', 'blob', `${merged}:${index}`], { maxBuffer: maxIndexBytes + 1 }), 'Cannot read merged index.')
  if (expected.length > maxIndexBytes) throw new Error('Merged index is over the download limit.')
  const url = new URL('https://agnesai-labs.github.io/agh-plugin-market/index.json')
  for (let attempt = 0; attempt < 18; attempt++) {
    url.search = new URLSearchParams({ revision: merged, attempt })
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5_000) })
      if (response.ok && response.body) {
        const buffer = Buffer.allocUnsafe(expected.length)
        let size = 0
        for await (const chunk of response.body) {
          if (size + chunk.length > buffer.length) { size = -1; break }
          buffer.set(chunk, size)
          size += chunk.length
        }
        if (size === buffer.length && buffer.equals(expected)) {
          log(`Pages serves the exact index from ${merged}.`)
          return
        }
      } else await response.body?.cancel()
    } catch { /* Pages can be unavailable while redeploying. */ }
    if (attempt < 17) await delay(10_000)
  }
  throw new Error(`PR was merged as ${merged}, but the published index did not match within the verification window.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Publisher must run against the trusted main checkout.')
    const [mode, arg, ...rest] = process.argv.slice(2)
    if (mode === 'audit' && !arg && rest.length === 0) audit()
    else if (mode === 'merge' && arg && rest.length === 0) merge(arg)
    else if (mode === 'verify-pages' && arg && rest.length === 0) await verifyPages(arg)
    else throw new Error('Usage: publish-release.mjs audit | merge PLAN | verify-pages MERGE_SHA')
  } catch (error) {
    // Unknown errors can contain API responses, commit content or other untrusted input.
    console.error(error.constructor === Error ? error.message : 'Market publication could not complete.')
    process.exitCode = 1
  }
}
