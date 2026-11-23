import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { replaceReadmeTable } from './readme-tables.mjs'

const sync = fileURLToPath(new URL('./sync-readmes.mjs', import.meta.url))
const validate = fileURLToPath(new URL('./validate-index.mjs', import.meta.url))
const publisher = new URL('./publish-release.mjs', import.meta.url).href
const paths = ['README.md', 'README.zh-CN.md']
const start = '<!-- market-catalog:start -->'
const end = '<!-- market-catalog:end -->'
const template = (heading) => Buffer.from(`${heading}\n\n${start}\n\n${end}\n\nAfter the catalog.\n`)
const commit = 'a'.repeat(40)
const release = (version, url) => ({
  version, publishTimestamp: 1, source: { type: 'git', url, commit }, engines: {},
})
const listing = (repo, title, version = '1.0.0') => {
  const url = `https://github.com/Example/${repo}`
  return { name: `@example/${repo}`, title, repository: { url }, versions: [release(version, url)] }
}

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'market-readmes-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const put = (path, contents) => writeFileSync(join(cwd, path), contents)
  const read = (path) => readFileSync(join(cwd, path))
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim()
  const node = (...args) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' })
  const topics = {}
  const withTopics = (...args) => node('--import', `data:text/javascript,${encodeURIComponent(`
    const topics = ${JSON.stringify(topics)}
    globalThis.fetch = async (url) => {
      const names = topics[url]
      return names === undefined ? new Response(null, { status: 503 }) : Response.json({ names })
    }
  `)}`, ...args)
  const success = ({ status, stderr }) => assert.equal(status, 0, stderr)
  const guide = 'docs/submit-plugin.md'
  const chineseGuide = 'docs/submit-plugin.zh-CN.md'
  function snapshot(parent) {
    git('add', '--all')
    const tree = git('write-tree')
    return git('-c', 'user.name=Catalog test', '-c', 'user.email=test@example.com', 'commit-tree', tree,
      ...(parent ? ['-p', parent] : []), '-m', 'Catalog fixture')
  }
  const catalog = { format: 1, title: 'Market', description: 'Catalog overview', plugins: [listing('existing', 'Existing')] }
  const setIndex = (index) => put('docs/index.json', JSON.stringify(index))
  const setData = (index) => {
    setIndex(index)
    put('plugins.txt', index.plugins.map(({ repository }) => `${repository.url}\n`).join(''))
  }
  git('init', '--quiet')
  mkdirSync(join(cwd, 'docs'))
  setData(catalog)
  put(guide, 'Contributing\n')
  put(chineseGuide, '投稿\n')
  for (const path of paths) put(path, template(`# ${path}`))
  success(node(sync))
  const base = snapshot()
  return {
    cwd, put, read, setData, setIndex, catalog, guide, chineseGuide,
    snapshot: () => snapshot(base),
    sync: () => success(node(sync)),
    setTopics: (repo, names) => { topics[`https://api.github.com/repos/${repo}/topics`] = names },
    validate: (head) => withTopics(validate, base, head),
    candidate(head, sameRepository = false) {
      const result = withTopics('--input-type=module', '--eval',
        `import { candidateCatalog } from ${JSON.stringify(publisher)};
         console.log(JSON.stringify(await candidateCatalog(...JSON.parse(process.argv[1]))))`,
        JSON.stringify([base, head, sameRepository]))
      success(result)
      return JSON.parse(result.stdout)
    },
  }
}

const expectFailure = ({ status, stderr }, pattern) => {
  assert.equal(status, 1)
  assert.match(stderr, pattern)
}

test('both locale blocks preserve outside bytes and contain only literal labels and repository links', () => {
  const label = 'Literal [x](https://elsewhere.test) | <img> &copy; `\\*\ntext\u2028next\u202e 🦊\u0000'
  const escaped = 'Literal &#91;x&#93;&#40;https&#58;&#47;&#47;elsewhere&#46;test&#41; &#124; &#60;img&#62; &#38;copy&#59; &#96;&#92;&#42; text next 🦊�'
  const row = listing('scoped', { en: label, 'zh-cn': '中文 | 插件' })
  row.homepage = 'https://elsewhere.test'
  const winner = '9007199254740993.10.0'
  row.versions = ['9007199254740993.2.0', winner, '9007199254740992.100.0']
    .map((version) => release(version, row.repository.url))
  const fallback = listing('fallback', { en: 'Fallback', 'zh-cn': '\t\u0085' })
  const untranslated = listing('untranslated', { 'zh-cn': '只提供中文' })
  const prefix = `\uFEFF# Catalog\r\n \t\r\n${start}`
  const suffix = `${end}\r\n\r\nAfter\t \r\n`
  const source = Buffer.from(`${prefix}\r\nOld contents\r\n${suffix}`)
  for (const path of paths) {
    const english = path === 'README.md'
    const plugins = [row, fallback, untranslated]
    const generated = replaceReadmeTable(path, source, plugins)
    const text = generated.toString('utf8')
    assert.ok(text.startsWith(`${prefix}\r\n\r\n`))
    assert.ok(text.endsWith(suffix))
    const lines = text.split('\r\n').filter((line) => line.startsWith('| ['))
    assert.equal(lines.length, 3)
    assert.equal(lines[0], `| [${english ? escaped : '中文 &#124; 插件'}](https://github.com/Example/scoped) | \`@example/scoped\` | \`${winner}\` |`)
    assert.match(lines[1], /\[Fallback\]/)
    assert.ok(lines[2].includes(english ? '[&#64;example&#47;untranslated]' : '[只提供中文]'))
    assert.deepEqual(replaceReadmeTable(path, generated, plugins), generated)
  }
})

test('trusted validation and publisher accept pinned fork blobs only with canonical table contents', (t) => {
  const repo = fixture(t)
  const appended = listing('welcome', { en: 'Plugin | [Welcome]', 'zh-cn': '欢迎' })
  repo.setData({ ...repo.catalog, plugins: [...repo.catalog.plugins, appended] })
  expectFailure(repo.validate(repo.snapshot()), /README\.md: stale catalog table/)
  repo.sync()
  const added = repo.snapshot()
  const english = repo.read(paths[0])
  const chinese = repo.read(paths[1])
  repo.put(paths[0], 'Broken README in the working tree (not the verified head)')
  expectFailure(repo.validate(added), /example\/welcome: could not verify required GitHub Topic agh-plugin \(HTTP 503\)/)
  repo.setTopics('example/welcome', ['agh-plugin-market'])
  expectFailure(repo.validate(added), /example\/welcome: missing required GitHub Topic agh-plugin/)
  assert.match(repo.candidate(added).reason, /submission Topic/)
  repo.setTopics('example/welcome', ['unrelated', 'agh-plugin'])
  assert.equal(repo.validate(added).status, 0)
  assert.deepEqual(repo.candidate(added), { kind: 'new-listing' })
  repo.put(paths[0], english)
  repo.put(paths[1], chinese.toString().replace('欢迎', 'Hand-edit'))
  expectFailure(repo.validate(repo.snapshot()), /README\.zh-CN\.md: stale catalog table/)
  assert.match(repo.candidate(repo.snapshot()).reason, /generated-only README/)
  repo.put(paths[1], chinese.toString().replace(appended.repository.url, 'https://elsewhere.test/redirect'))
  expectFailure(repo.validate(repo.snapshot()), /README\.zh-CN\.md: stale catalog table/)
  repo.put(paths[1], `${chinese}\n${end}\n`)
  expectFailure(repo.validate(repo.snapshot()), /exactly one pair/)
  repo.put(paths[1], Buffer.concat([Buffer.from([0xff]), chinese]))
  expectFailure(repo.validate(repo.snapshot()), /expected UTF-8/)
  repo.put(paths[1], Buffer.alloc(2 * 1024 * 1024 + 1))
  expectFailure(repo.validate(repo.snapshot()), /exceeds 2 MiB/)
  rmSync(join(repo.cwd, paths[1]))
  symlinkSync(paths[0], join(repo.cwd, paths[1]))
  const symlink = repo.snapshot()
  expectFailure(repo.validate(symlink), /expected a regular file/)
  assert.match(repo.candidate(symlink).reason, /regular non-executable files/)
})

test('the same gate permits generated update rows, unchanged tables, and reviewed prose only on the required check', (t) => {
  const repo = fixture(t)
  repo.setIndex({ ...repo.catalog, title: 'Official market' })
  assert.equal(repo.validate(repo.snapshot()).status, 0)
  assert.deepEqual(repo.candidate(repo.snapshot(), true), { kind: 'catalog-copy' })
  assert.match(repo.candidate(repo.snapshot()).reason, /do not qualify/)

  const [existing] = repo.catalog.plugins
  const { url } = existing.repository
  const newRelease = release('2.0.0', url)
  repo.setData({ ...repo.catalog, plugins: [{ ...existing, versions: [newRelease, ...existing.versions] }] })
  repo.put('plugins.txt', `${url}\n# pin: ${url} 2.0.0 ${commit}\n`)
  repo.sync()
  expectFailure(repo.validate(repo.snapshot()), /example\/existing: could not verify required GitHub Topic agh-plugin/)
  repo.setTopics('example/existing', [])
  expectFailure(repo.validate(repo.snapshot()), /example\/existing: missing required GitHub Topic agh-plugin/)
  assert.match(repo.candidate(repo.snapshot()).reason, /submission Topic/)
  repo.setTopics('example/existing', ['agh-plugin'])
  assert.deepEqual(repo.candidate(repo.snapshot()), { kind: 'release-update' })
  const generated = repo.read(paths[0])
  repo.put(paths[0], repo.read(paths[0]).toString().replace('After the catalog.', 'Reviewed maintenance copy.'))
  assert.equal(repo.validate(repo.snapshot()).status, 0)
  assert.match(repo.candidate(repo.snapshot()).reason, /generated-only README/)

  repo.put(repo.guide, 'Updated contributing steps\n')
  expectFailure(repo.validate(repo.snapshot()), /Update both contribution tutorials together/)
  repo.put(repo.chineseGuide, '更新投稿步骤\n')
  assert.equal(repo.validate(repo.snapshot()).status, 0)
  assert.match(repo.candidate(repo.snapshot()).reason, /only catalog submissions/)
  repo.put(repo.guide, 'Contributing\n')
  repo.put(repo.chineseGuide, '投稿\n')
  repo.put(paths[0], generated)
  mkdirSync(join(repo.cwd, 'tools'))
  repo.put('tools/sync-readmes.mjs', 'throw new Error("Do not execute contributor code")\n')
  assert.match(repo.candidate(repo.snapshot()).reason, /only catalog submissions/)
  rmSync(join(repo.cwd, 'tools'), { recursive: true })

  repo.setData({ ...repo.catalog, plugins: [] })
  repo.setTopics('example/existing', [])
  repo.sync()
  const removal = repo.snapshot()
  assert.equal(repo.validate(removal).status, 0)
  assert.match(repo.candidate(removal).reason, /do not qualify/)
})
