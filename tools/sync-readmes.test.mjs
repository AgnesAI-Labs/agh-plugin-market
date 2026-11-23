import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const readmes = ['README.md', 'README.zh-CN.md']
const fixture = `# Market

Keep this introduction.

<!-- market-list:start -->
Old table.
<!-- market-list:end -->

Keep this footer.
`

function listing(name, title, versions) {
  const url = `https://github.com/example/${name.split('/').at(-1)}`
  return {
    name,
    title,
    repository: { url },
    versions: versions.map(version => ({ version, source: { type: 'git', url, commit: 'a'.repeat(40) } })),
  }
}

test('synchronizes both locales on additions, releases and removals', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'market-readme-test-'))
  t.after(() => rmSync(cwd, { recursive: true }))
  mkdirSync(join(cwd, 'tools'))
  mkdirSync(join(cwd, 'docs'))
  copyFileSync(new URL('./sync-readmes.mjs', import.meta.url), join(cwd, 'tools/sync-readmes.mjs'))
  for (const path of readmes) writeFileSync(join(cwd, path), fixture)
  const publish = (...plugins) => writeFileSync(join(cwd, 'docs/index.json'), JSON.stringify({ format: 1, plugins }))
  const read = (path) => readFileSync(join(cwd, path), 'utf8')
  const run = (expected, ...args) => {
    const result = spawnSync(process.execPath, ['tools/sync-readmes.mjs', ...args], { cwd, encoding: 'utf8' })
    assert.equal(result.status, expected, result.error?.message ?? result.stderr)
  }
  const old = listing('@example/old', { en: 'Old plugin', 'zh-cn': '旧插件' }, ['1.0.0'])
  const kept = listing('@example/kept', { en: 'English title' }, ['1.10.0', '1.2.0'])
  publish(old, kept)
  run(1, '--check')
  for (const path of readmes) assert.equal(read(path), fixture)
  run(0)
  run(0, '--check')
  assert.match(read(readmes[0]), /Old plugin/)
  assert.match(read(readmes[1]), /旧插件/)
  for (const path of readmes) {
    assert.match(read(path), /English title/)
    assert.match(read(path), /1\.10\.0/)
    assert.doesNotMatch(read(path), /1\.2\.0/)
  }

  const added = listing('@example/added', { en: 'Literal | <img src=x>\n[click](https://example.com)' }, ['1.0.0'])
  const updated = listing(kept.name, kept.title, ['9007199254740992.99.0', '9007199254740993.0.0'])
  publish(updated, added)
  run(0)
  run(0, '--check')
  for (const path of readmes) {
    const text = read(path)
    assert.match(text, /Keep this introduction\./)
    assert.match(text, /Keep this footer\./)
    assert.doesNotMatch(text, /@example\/old/)
    assert.match(text, /9007199254740993\.0\.0/)
    assert.match(text, /@example\/added/)
    const row = text.split('\n').find(line => line.includes('@example/added'))
    assert.equal(row.split('|').length, 5, row)
    assert.doesNotMatch(row, /<img|\[click\]\(https:\/\/example\.com\)/)
  }
})
