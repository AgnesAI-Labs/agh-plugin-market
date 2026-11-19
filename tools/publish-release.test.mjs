import assert from 'node:assert/strict'
import test from 'node:test'
import { planFor } from './publish-release.mjs'

const base = 'a'.repeat(40)
const head = 'b'.repeat(40)
const author = { id: 1, login: 'contributor', type: 'User' }
const maintainer = { id: 2, login: 'maintainer', type: 'User' }
const other = { id: 3, login: 'outside-reviewer', type: 'User' }
const bot = { id: 4, login: 'automation[bot]', type: 'Bot' }
const pr = {
  number: 7, state: 'open', draft: false, merged: false, mergeable: true,
  base: { ref: 'main', sha: base, repo: { full_name: 'AgnesAI-Labs/agh-plugin-market' } },
  head: { sha: head }, user: author, title: 'Update market entry', body: 'Release notes',
}
const approval = { user: maintainer, state: 'APPROVED', commit_id: head }
const request = (reviews) => (path) => {
  if (path.startsWith('pulls/7/reviews?')) return reviews
  if (path === 'collaborators/maintainer/permission') return { permission: 'maintain', user: maintainer }
  if (path === 'collaborators/outside-reviewer/permission') return { permission: 'read', user: other }
  throw new Error('Approval must come from an independent human reviewer with write access')
}

test('the merge plan binds a current approval to the approved commit and checked PR text', () => {
  const fromGithub = request([approval, { ...approval, state: 'COMMENTED' }])
  const plan = planFor(pr, base, fromGithub)
  assert.equal(plan.head, head)
  assert.equal(plan.base, base)
  assert.notEqual(planFor({ ...pr, body: 'Edited release notes' }, base, fromGithub).metadata, plan.metadata)
})

test('only a current, independent human approval with repository write access counts', () => {
  for (const [label, reviews] of Object.entries({
    noApproval: [], oldCommit: [{ ...approval, commit_id: 'c'.repeat(40) }],
    revoked: [approval, { ...approval, state: 'DISMISSED' }],
    changesRequested: [approval, { ...approval, state: 'CHANGES_REQUESTED' }],
    author: [{ ...approval, user: author }], external: [{ ...approval, user: other }],
    bot: [{ ...approval, user: bot }],
  })) assert.equal(planFor(pr, base, request(reviews)), null, label)
})

test('even a valid approval cannot authorize a draft, closed PR or stale or foreign base', () => {
  const fromGithub = request([approval])
  for (const patch of [
    { draft: true }, { state: 'closed' }, { mergeable: null },
    { base: { ...pr.base, sha: 'c'.repeat(40) } }, { base: { ...pr.base, ref: 'next' } },
    { base: { ...pr.base, repo: { full_name: 'someone/fork' } } },
  ]) assert.equal(planFor({ ...pr, ...patch }, base, fromGithub), null)
})
