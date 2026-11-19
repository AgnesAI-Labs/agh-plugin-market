import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogChange, planFor } from './publish-release.mjs'

const base = 'a'.repeat(40)
const head = 'b'.repeat(40)
const repo = 'AgnesAI-Labs/agh-plugin-market'
const pr = {
  number: 7, state: 'open', draft: false, merged: false, mergeable: true,
  base: { ref: 'main', sha: base, repo: { full_name: repo } },
  head: { sha: head, repo: { full_name: repo } }, title: 'Update market entry', body: 'Release notes',
}

const url = 'https://github.com/AgnesAI-Labs/agh-app-devboard'
function release(version, source = url) {
  return { version, source: { type: 'git', url: source, commit: head }, publishTimestamp: 1, engines: {} }
}
const trusted = { name: '@agnes-showcase/devboard', repository: { url }, versions: [release('3.8.0')] }
const externalUrl = 'https://github.com/example/outside'
const external = { name: '@example/outside', repository: { url: externalUrl }, versions: [release('1.0.0', externalUrl)] }
const index = { format: 1, title: 'Plugin market', description: 'A list of plugins', plugins: [trusted, external] }
const fromMarket = { sameRepository: true, sourcesChanged: false }
const fromFork = { sameRepository: false, sourcesChanged: true }

test('the merge plan binds the checked base, head and PR text without approval APIs', () => {
  const plan = planFor(pr, base)
  assert.equal(plan.head, head)
  assert.equal(plan.base, base)
  assert.notEqual(planFor({ ...pr, body: 'Edited release notes' }, base).metadata, plan.metadata)
})

test('draft, closed, conflicting or retargeted PRs have no merge plan', () => {
  for (const patch of [
    { draft: true }, { state: 'closed' }, { mergeable: null },
    { base: { ...pr.base, sha: 'c'.repeat(40) } }, { base: { ...pr.base, ref: 'next' } },
    { base: { ...pr.base, repo: { full_name: 'someone/fork' } } },
  ]) assert.equal(planFor({ ...pr, ...patch }, base), null)
})

test('catalog presentation changes cannot alter plugin data or come from a fork', () => {
  const copy = { ...index, title: { en: 'Official plugin market', 'zh-cn': '官方插件市场' } }
  assert.equal(catalogChange(index, copy, fromMarket), 'catalog-copy')
  assert.equal(catalogChange(index, copy, { ...fromMarket, sameRepository: false }), null)
  assert.equal(catalogChange(index, { ...copy, description: '<script>test</script>' }, fromMarket), null)
  assert.equal(catalogChange(index, { ...copy, plugins: [external] }, fromMarket), null)
})

test('only newer pinned releases from already listed allowlisted repositories qualify', () => {
  const replacing = (versions) => ({ ...index, plugins: [{ ...trusted, versions }, external] })
  assert.equal(catalogChange(index, replacing([release('3.10.0')]), fromFork), 'release-update')
  assert.equal(catalogChange(index, replacing([release('3.10.0')]), fromMarket), null)
  assert.equal(catalogChange(index, replacing([release('3.7.9')]), fromFork), null)
  assert.equal(catalogChange(index, replacing([{ ...release('3.8.0'), publishTimestamp: 2 }, release('3.10.0')]), fromFork), null)
  assert.equal(catalogChange(index, replacing([{ ...release('3.10.0'), opaqueSource: 'unexpected' }]), fromFork), null)
  assert.equal(catalogChange(index, { ...index, plugins: [trusted, { ...external, versions: [release('1.1.0', externalUrl)] }] }, fromFork), null)
  assert.equal(catalogChange(index, { ...index, plugins: [trusted, external, { ...trusted, name: '@example/new' }] }, fromFork), null)
})
