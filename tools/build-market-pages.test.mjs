import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const generator = fileURLToPath(new URL('./build-market-pages.mjs', import.meta.url))
const files = ['plugins.html', 'plugins.svg', 'plugins.zh-CN.html', 'plugins.zh-CN.svg']

function listing(repo, title, versions, name = `@example/${repo}`) {
  const url = `https://github.com/Example/${repo}`
  return {
    name,
    title,
    homepage: 'https://example.com/not-the-repository',
    repository: { url },
    versions: versions.map((version) => ({ version, source: { type: 'git', url, commit: 'a'.repeat(40) } })),
  }
}

function assertListingOrder(output, listings) {
  let previous = -1
  for (const listing of listings) {
    const next = output.indexOf(listing.name)
    assert.ok(next > previous, `Expected ${listing.name} in catalog order`)
    previous = next
  }
}

function svgHeight(svg) {
  const [, width, height, viewWidth, viewHeight] = svg.match(/^<svg[^>]+ width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/) ?? []
  assert.ok(Number(width) > 0 && Number(height) > 0, 'Expected an explicitly sized SVG')
  assert.equal(width, viewWidth)
  assert.equal(height, viewHeight)
  return Number(height)
}

test('builds both locale variants from staged index additions, releases and removals', (t) => {
  const site = mkdtempSync(join(tmpdir(), 'market pages test-'))
  t.after(() => rmSync(site, { recursive: true }))
  const indexPath = join(site, 'index.json')
  const publish = (...plugins) => {
    const index = Buffer.from(`${JSON.stringify({ format: 1, plugins }, null, 2)}\n`)
    writeFileSync(indexPath, index)
    const result = spawnSync(process.execPath, [generator, site], { cwd: site, encoding: 'utf8' })
    assert.equal(result.status, 0, result.error?.message ?? result.stderr)
    assert.deepEqual(readdirSync(site).sort(), ['index.json', ...files])
    assert.deepEqual(readFileSync(indexPath), index)
    return Object.fromEntries(files.map((path) => [path, readFileSync(join(site, path), 'utf8')]))
  }

  const old = listing('old', { en: 'Old plugin', 'zh-cn': '旧插件' }, ['1.0.0'])
  const kept = listing('kept', { en: 'English title', 'zh-cn': ' \u0085\n' }, ['1.10.0', '1.2.0'])
  const first = publish(old, kept)
  for (const [path, output] of Object.entries(first)) {
    assertListingOrder(output, [old, kept])
    assert.ok(output.includes(path.includes('.zh-CN.') ? '旧插件' : 'Old plugin'))
    assert.ok(output.includes('English title'))
    assert.match(output, /1\.10\.0/)
    assert.doesNotMatch(output, /1\.2\.0/)
  }

  const winner = '9007199254740993.9007199254740993.9007199254740993'
  const earlier = [
    '9007199254740992.9007199254740999.9007199254740999',
    '9007199254740993.9007199254740993.9007199254740992',
    '9007199254740993.9007199254740992.9007199254740999',
  ]
  const updated = listing('kept', kept.title, [earlier[0], earlier[1], winner, earlier[2]])
  const added = listing('added', `Literal | <img src=x> & "'"\nemoji 🦊\u0000\ud800\ufffe`, ['2.0.0'])
  const escaped = 'Literal | &lt;img src=x&gt; &amp; &quot;&#39;&quot; emoji 🦊���'
  const longTitle = '超长标题'.repeat(300)
  const zhOnly = listing('zh-only', { 'zh-cn': longTitle }, ['3.0.0'], `@example/${'z'.repeat(180)}`)
  const omittedTitle = listing('omitted', undefined, ['4.0.0'])
  const next = publish(updated, added, zhOnly, omittedTitle)
  for (const [path, output] of Object.entries(next)) {
    const zh = path.includes('.zh-CN.')
    assertListingOrder(output, [updated, added, zhOnly, omittedTitle])
    assert.ok(output.includes('English title'))
    assert.equal(output.includes(longTitle), zh)
    assert.equal(output.split(zhOnly.name).length - 1, zh ? 1 : 2)
    assert.equal(output.split(omittedTitle.name).length - 1, 2)
    assert.ok(output.includes(winner))
    for (const version of earlier) assert.ok(!output.includes(version))
    assert.doesNotMatch(output, /@example\/old|Old plugin|旧插件|1\.10\.0|<img|not-the-repository/u)
    assert.ok(output.includes(escaped))

    if (path.endsWith('.html')) {
      assert.match(output, new RegExp(`<html lang="${zh ? 'zh-CN' : 'en'}">`))
      assert.ok(output.includes(`href="${zh ? 'plugins.html' : 'plugins.zh-CN.html'}"`))
      assert.match(output, /<th scope="col">/)
      assert.match(output, /<th scope="row"><a href="https:\/\/github\.com\/Example\/added">/)
    } else {
      assert.match(output, /<title id="catalog-title">[^<]+<\/title>/)
      assert.match(output, /<desc id="catalog-description">[^<]+<\/desc>/)
      assert.match(output, /<clipPath id="column-0">/)
      assert.ok(svgHeight(output) > svgHeight(first[path]))
      assert.doesNotMatch(output, /<a\b|<script\b|<foreignObject\b|href=/i)
    }
  }
})
