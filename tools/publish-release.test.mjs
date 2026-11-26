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
  return {
    version, source: { type: 'git', url: source, commit: head }, publishTimestamp: 1,
    engines: { agh: '>=1.2.0 <2.0.0' }, provides: ['bundle', 'skills'],
  }
}
const trusted = { name: '@agnes-showcase/devboard', repository: { url }, versions: [{ ...release('3.8.0'), engines: {} }] }
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

test('legacy allowlisted and namespaced listings qualify only for newer pinned releases', () => {
  const replacing = (versions) => ({ ...index, plugins: [{ ...trusted, versions }, external] })
  assert.equal(catalogChange(index, replacing([release('3.10.0')]), fromFork), 'release-update')
  assert.equal(catalogChange(index, replacing([release('3.10.0')]), fromMarket), null)
  assert.equal(catalogChange(index, replacing([release('3.7.9')]), fromFork), null)
  assert.equal(catalogChange(index, replacing([{ ...trusted.versions[0], publishTimestamp: 2 }, release('3.10.0')]), fromFork), null)
  assert.equal(catalogChange(index, replacing([{ ...release('3.10.0'), opaqueSource: 'unexpected' }]), fromFork), null)
  assert.equal(catalogChange(index, replacing([...trusted.versions, release('3.10.0')]), fromFork), 'release-update')
  for (const patch of [
    { provides: undefined }, { provides: [] }, { provides: ['bundle', 'bundle'] }, { provides: ['other'] },
    { publishTimestamp: 1795086102000 }, { engines: undefined }, { engines: {} },
    { engines: { agh: '' } }, { engines: { agh: ' \t ' } }, { engines: { agh: '1.2.0 || 2.0.0' } }, { engines: { agh: '>=1.2.0<script>' } },
    { engines: { agh: '>=1.2.0 <2.0.0', node: '>=24' } },
  ]) assert.equal(catalogChange(index, replacing([{ ...release('3.10.0'), ...patch }]), fromFork), null)
  assert.equal(catalogChange(index, { ...index, plugins: [trusted, { ...external, versions: [release('1.1.0', externalUrl)] }] }, fromFork), 'release-update')
})

test('a fork can append one namespaced first release without editing existing rows', () => {
  const url = 'https://github.com/Personal-Owner/agh-welcome'
  const listing = { name: '@personal-owner/welcome', repository: { url }, versions: [release('1.0.0', url)] }
  const adding = (row) => ({ ...index, plugins: [...index.plugins, row] })
  assert.equal(catalogChange(index, adding(listing), fromFork), 'new-listing')
  for (const engines of [undefined, {}, { agh: ' ' }, { agh: 'latest' }]) {
    assert.equal(catalogChange(index, adding({ ...listing, versions: [{ ...listing.versions[0], engines }] }), fromFork), null)
  }
  assert.equal(catalogChange(index, adding({ ...listing, name: '@agnes/fake' }), fromFork), null)
  assert.equal(catalogChange(index, adding({ ...listing, name: '@someone-else/welcome' }), fromFork), null)
  assert.equal(catalogChange(index, adding({ ...listing, homepage: 'https://example.org' }), fromFork), null)
  assert.equal(catalogChange(index, adding({ ...listing, author: 'AgnesAI Labs' }), fromFork), null)
  assert.equal(catalogChange(index, adding({ ...listing, versions: [...listing.versions, release('2.0.0', url)] }), fromFork), null)
  assert.equal(catalogChange(index, { ...adding(listing), plugins: [external, trusted, listing] }, fromFork), null)
  assert.equal(catalogChange(index, adding(listing), { ...fromFork, sourcesChanged: false }), null)
})

test('adding, removing, or changing only historical provides never qualifies for unattended publication', () => {
  const { provides, ...legacy } = trusted.versions[0]
  const withVersion = (value) => ({ ...index, plugins: [{ ...trusted, versions: [value] }, external] })
  const previous = withVersion(legacy)
  assert.equal(catalogChange(previous, index, fromMarket), null)
  assert.equal(catalogChange(index, previous, fromMarket), null)
  assert.equal(catalogChange(index, withVersion({ ...legacy, provides: ['tool'] }), fromMarket), null)
  const mixed = { ...index, plugins: [{ ...trusted, versions: [{ ...legacy, provides }, release('3.9.0')] }, external] }
  assert.equal(catalogChange(previous, mixed, fromFork), null)
})
