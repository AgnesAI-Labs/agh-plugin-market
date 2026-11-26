import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { readmeLocales, replaceReadmeTable } from './readme-tables.mjs'

const exec = promisify(execFile)
const tool = (name) => fileURLToPath(new URL(name, import.meta.url))
const publisher = new URL('./publish-release.mjs', import.meta.url).href
const epoch = 1795086102
const aghRange = '>=1.2.0 <2.0.0'
const env = {
  ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_EMAIL: 'fixture@example.test',
  GIT_AUTHOR_DATE: '1700000000 +0000', GIT_COMMITTER_DATE: `${epoch} -0530`,
}
const catalog = (...plugins) => ({ format: 1, title: 'Market', description: 'Plugins', plugins })
const listing = (name, ...versions) => ({ name, repository: { url: versions[0].source.url }, versions })
const json = (value) => JSON.stringify(value, null, 2) + '\n'
const without = ({ provides, ...release }) => release
const readme = Buffer.from('# Market\n\n<!-- market-catalog:start -->\n<!-- market-catalog:end -->\n')
const tagPath = (repo, version) => `/repos/${repo}/git/ref/tags/v${version}`
const tagRef = (version, sha, type = 'commit') => ({ ref: `refs/tags/v${version}`, object: { type, sha } })
const headPath = (repo) => `/repos/${repo}/commits?per_page=1`
const comparePath = (repo, pin, tip) => `/repos/${repo}/compare/${pin}...${tip}`
const git = (cwd, args, input) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
  cwd, env, input, encoding: 'utf8',
}).trim()

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'market-provides-'))
  const cwd = join(root, 'market')
  const upstream = join(root, 'upstream')
  mkdirSync(join(cwd, 'docs'), { recursive: true })
  mkdirSync(upstream)
  git(cwd, ['init', '--quiet'])
  git(upstream, ['init', '--quiet', '--bare', '--object-format=sha1', '--template='])
  const put = (path, contents) => writeFileSync(join(cwd, path), contents)
  const read = () => readFileSync(join(cwd, 'docs/index.json'), 'utf8')
  const sentinel = join(root, 'plugin-ran')
  const routes = new Map()
  const requests = []
  const server = createServer((req, res) => {
    requests.push({ path: req.url, auth: req.headers.authorization })
    const route = routes.get(req.url)
    if (typeof route?.status === 'number') res.writeHead(route.status, route.headers).end(route.body)
    else if (route) res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(route))
    else res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  })
  const endpoint = `http://127.0.0.1:${server.address().port}`
  const preload = `data:text/javascript,${encodeURIComponent(`
    const realFetch = globalThis.fetch
    globalThis.fetch = (input, options) => {
      const url = new URL(input)
      if (url.origin !== 'https://api.github.com' || (url.search && url.search !== '?per_page=1') || options.redirect !== 'error') {
        throw new Error('Unexpected GitHub request: ' + input)
      }
      if (!url.pathname.endsWith('/topics') &&
          (options.credentials !== 'omit' || !options.signal || new Headers(options.headers).has('authorization'))) {
        throw new Error('Metadata request must be credential-free and timed')
      }
      return realFetch(${JSON.stringify(endpoint)} + url.pathname + url.search, options)
    }
  `)}`
  async function node(...args) {
    try {
      const result = await exec(process.execPath, ['--import', preload, ...args], {
        cwd, env: { ...env, GH_TOKEN: 'fixture-market-token' }, timeout: 30_000,
      })
      return { ...result, status: 0 }
    } catch (error) {
      return { status: error.code, stdout: error.stdout, stderr: error.stderr }
    }
  }
  function release(repo, name, version, { provides = ['skills', 'tool'], mode = '100644', alterPkg, absent = false, raw, files = {}, parent } = {}) {
    const prefix = `/repos/${repo}/git`
    const url = `https://github.com/${repo}`
    const pkg = {
      name, version, agnes: { provides }, engines: { agh: aghRange },
      scripts: { postinstall: `touch '${sentinel}'` }, ...alterPkg,
    }
    const bytes = raw ?? JSON.stringify(pkg)
    const size = Buffer.byteLength(bytes)
    const blob = git(upstream, ['hash-object', '-w', '--stdin'], bytes)
    const entries = absent ? [] : [{ path: 'package.json', sha: blob, mode, type: 'blob', size }]
    for (const [path, content] of Object.entries(files)) {
      entries.push({ path, sha: git(upstream, ['hash-object', '-w', '--stdin'], content), mode: '100644', type: 'blob', size: Buffer.byteLength(content) })
    }
    const tree = git(upstream, ['mktree'], entries.map(({ mode, sha, path }) => `${mode} blob ${sha}\t${path}\n`).join(''))
    const commit = git(upstream, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', 'Release'])
    const time = (format) => git(upstream, ['show', '-s', `--format=${format}`, commit])
    const date = (seconds) => new Date(Number(seconds) * 1000).toISOString().replace('.000Z', 'Z')
    const paths = [`${prefix}/commits/${commit}`, `${prefix}/trees/${tree}`, `${prefix}/blobs/${blob}`]
    const data = [
      { sha: commit, tree: { sha: tree }, author: { date: date(time('%at')) }, committer: { date: date(time('%ct')) } },
      { sha: tree, truncated: false, tree: entries },
      { sha: blob, encoding: 'base64', size, content: Buffer.from(bytes).toString('base64') },
    ]
    paths.forEach((path, i) => routes.set(path, data[i]))
    routes.set(tagPath(repo, version), tagRef(version, commit))
    routes.set(`/repos/${repo}/topics`, { names: ['agh-plugin'] })
    return {
      source: { type: 'git', commit, url }, version, publishTimestamp: Number(time('%ct')),
      engines: { agh: aghRange }, provides, paths,
    }
  }
  function stage(index, pins = [], { text = json(index), extra } = {}) {
    put('docs/index.json', text)
    const lines = [...index.plugins.map(({ repository }) => repository.url), ...pins]
    put('plugins.txt', lines.length ? `${lines.join('\n')}\n` : '')
    for (const path of Object.keys(readmeLocales)) put(path, replaceReadmeTable(path, readme, index.plugins))
    if (extra) put(extra[0], extra[1])
  }
  function snapshot(parent) {
    git(cwd, ['add', '--all'])
    const tree = git(cwd, ['write-tree'])
    return git(cwd, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', 'Catalog fixture'])
  }
  function info(repo, name, version, options) {
    const { paths, ...entry } = release(repo, name, version, options)
    return { entry, paths }
  }
  return {
    cwd, root, upstream, read, put, info, stage, snapshot, routes, requests, sentinel, node,
    validate: (...refs) => node(tool('./validate-index.mjs'), ...refs),
    project: (...args) => node(tool('./project-provides.mjs'), ...args),
    async publication(base, head) {
      const result = await node('--input-type=module', '--eval',
        `import { candidateCatalog } from ${JSON.stringify(publisher)};
         console.log(JSON.stringify(await candidateCatalog(...JSON.parse(process.argv[1]))))`, JSON.stringify([base, head, false]))
      assert.equal(result.status, 0, result.stderr)
      return JSON.parse(result.stdout)
    },
  }
}

const ok = (result) => assert.equal(result.status, 0, result.stderr)
const rejects = (result, reason) => {
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, reason)
}
const pin = ({ source, version }) => `# pin: ${source.url} ${version} ${source.commit}`

test('new submissions require the named repository tag and read committer seconds and types only from the pin', async (t) => {
  const f = await fixture(t)
  const name = '@example/toolkit'
  const repo = 'example/toolkit'
  const { entry, paths } = f.info(repo, name, '1.0.0')
  f.info(repo, name, '1.0.0', { provides: ['service'] })
  const { commit } = entry.source
  const tag = tagPath(repo, entry.version)
  f.routes.set(headPath(repo), [{ sha: commit }])
  assert.equal(entry.publishTimestamp, epoch)
  const oldName = '@example/existing'
  const old = listing(oldName, without(f.info('example/existing', oldName, '1.0.0').entry))
  f.stage(catalog(old))
  const base = f.snapshot()
  const proposal = (release, extra) => {
    f.stage(catalog(old, listing(name, release)), [], { extra })
    return f.snapshot(base)
  }
  const head = proposal(entry)
  rejects(await f.validate(base, head), /refs\/tags\/v1\.0\.0.*pinned commit/)
  f.routes.delete(tag)
  rejects(await f.validate(base, head), /refs\/tags\/v1\.0\.0.*pinned commit/)
  assert.equal(f.requests.some(({ path }) => path === headPath(repo)), false, 'new submissions never fall back to default HEAD')

  f.routes.set(tag, tagRef(entry.version, commit))
  f.requests.length = 0
  ok(await f.validate(base, head))
  assert.deepEqual(f.requests.splice(0), [
    { path: `/repos/${repo}/topics`, auth: 'Bearer fixture-market-token' },
    { path: tag, auth: undefined },
    ...paths.map((path) => ({ path, auth: undefined })),
  ])
  const annotate = (target, sha, type) => {
    const object = { type, sha, url: 'https://example.test/not-a-fetch-target' }
    const tagged = git(f.upstream, ['hash-object', '-t', 'tag', '-w', '--stdin'],
      `object ${sha}\ntype ${type}\ntag ${target}\ntagger Fixture <fixture@example.test> ${epoch} +0000\n\nRelease\n`)
    f.routes.set(`/repos/${repo}/git/tags/${tagged}`, { sha: tagged, object })
    return tagged
  }
  const inner = annotate('inner', commit, 'commit')
  const outer = annotate('v1.0.0', inner, 'tag')
  f.routes.set(tag, tagRef(entry.version, outer, 'tag'))
  ok(await f.validate(base, head))
  assert.deepEqual(f.requests.splice(0).map(({ path }) => path), [
    `/repos/${repo}/topics`, tag, `/repos/${repo}/git/tags/${outer}`, `/repos/${repo}/git/tags/${inner}`, ...paths,
  ])
  let deep = outer
  for (let i = 0; i < 3; i++) deep = annotate(`nested-${i}`, deep, 'tag')
  f.routes.set(tag, tagRef(entry.version, deep, 'tag'))
  rejects(await f.validate(base, head), /too many annotated tags/)
  f.routes.set(tag, { ...tagRef(entry.version, commit), ref: 'refs/tags/v1.0.0-other' })
  rejects(await f.validate(base, head), /did not return refs\/tags\/v1\.0\.0/)
  f.routes.set(tag, tagRef(entry.version, commit))
  assert.deepEqual(await f.publication(base, head), { kind: 'new-listing' })
  f.requests.length = 0
  ok(await f.validate())
  assert.deepEqual(f.requests, [], 'main/Pages does not re-read any upstream')

  rejects(await f.validate(base, proposal(without(entry))), /new releases require provides/)
  for (const provides of [[], ['skills', 'skills'], ['other']]) {
    rejects(await f.validate(base, proposal({ ...entry, provides })), /distinct documented provides/)
  }
  rejects(await f.validate(base, proposal({ ...entry, provides: ['tool', 'skills'] })), /match the pinned package\.json/)
  for (const publishTimestamp of [1700000000, epoch + 1]) {
    rejects(await f.validate(base, proposal({ ...entry, publishTimestamp })), /committer time \(%ct\)/)
  }
  for (const publishTimestamp of [String(epoch), epoch * 1000, 1.25, 0, 253402300800]) {
    rejects(await f.validate(base, proposal({ ...entry, publishTimestamp })), /integer seconds/)
  }
  const badSource = { ...entry, source: { ...entry.source, url: 'https://github.com/other/wrong' } }
  f.stage(catalog(old, { ...listing(name, entry), versions: [badSource] }))
  rejects(await f.validate(base, f.snapshot(base)), /same repository/)
  for (const [commit, reason] of [['deadbeef', /full commit SHA/], ['a'.repeat(40), /tag.*pinned commit/]]) {
    rejects(await f.validate(base, proposal({ ...entry, source: { ...entry.source, commit } })), reason)
  }

  const candidateValidator = ['tools/validate-index.mjs', `require('node:fs').writeFileSync(${JSON.stringify(f.sentinel)}, 'ran')\n`]
  mkdirSync(join(f.cwd, 'tools'))
  ok(await f.validate(base, proposal(entry, candidateValidator)))
  assert.equal(existsSync(f.sentinel), false)
})

test('first listings and pinned updates require an exact AGH range from the root manifest', async (t) => {
  const f = await fixture(t)
  const name = '@example/compatibility'
  const repo = 'example/compatibility'
  const existingName = '@example/existing'
  const existing = listing(existingName, without(f.info('example/existing', existingName, '1.0.0').entry))
  const { engines: _, ...legacy } = f.info(repo, name, '1.0.0', { alterPkg: { engines: undefined } }).entry
  for (const [kind, retained] of [['new-listing', []], ['release-update', [legacy]]]) {
    await t.test(kind, async () => {
      const update = retained.length > 0
      f.stage(update ? catalog(existing, listing(name, ...retained)) : catalog(existing))
      const base = f.snapshot()
      const version = update ? '2.0.0' : '1.0.0'
      const range = ` ${aghRange} `
      const { entry } = f.info(repo, name, version, { alterPkg: { engines: { agh: range, node: '>=24' } } })
      const matching = { ...entry, engines: { agh: range } }
      function proposal(release) {
        f.stage(catalog(existing, listing(name, release, ...retained)), update ? [pin(release)] : [])
        return f.snapshot(base)
      }

      const accepted = proposal(matching)
      ok(await f.validate(base, accepted))
      assert.deepEqual(await f.publication(base, accepted), { kind })
      for (const engines of [undefined, {}, { agh: '' }, { agh: ' \t ' }, { agh: 'latest' }, { agh: range, node: '>=24' }]) {
        rejects(await f.validate(base, proposal({ ...entry, engines })), /index engines.*supported engines\.agh/)
      }

      const mismatch = proposal(entry)
      rejects(await f.validate(base, mismatch), /indexed engines\.agh must match the pinned root package\.json/)
      assert.match((await f.publication(base, mismatch)).reason, /pinned release metadata.*did not pass/)
      for (const engines of [undefined, { node: '>=24' }, { agh: '' }, { agh: ' \t ' }, { agh: 'latest' }, { agh: 24 }]) {
        const { entry } = f.info(repo, name, version, { alterPkg: { engines } })
        rejects(await f.validate(base, proposal(entry)), /pinned root package\.json must declare.*engines\.agh/)
      }
    })
  }
})

test('projection preserves untouched bytes, reuses a pin and never writes a partially verified batch', async (t) => {
  const f = await fixture(t)
  const name = '@example/toolkit'
  const { entry, paths } = f.info('example/toolkit', name, '1.0.0')
  const missing = f.info('example/plain', '@example/plain', '1.0.0', { alterPkg: { agnes: {} } }).entry
  const unknown = f.info('example/unknown', '@example/unknown', '1.0.0', { provides: ['invalid'] }).entry
  const historical = catalog(listing(name, without(entry)), listing('@example/plain', without(missing)), listing('@example/unknown', without(unknown)))
  const original = json(historical).replace('"format": 1', '"format" :  1').replaceAll('\n', '\r\n')
  f.stage(historical, [], { text: original })
  const base = f.snapshot()
  rejects(await f.project('--write'), /not changed/)
  assert.equal(f.read(), original)
  rejects(await f.project('--check', `${name}@1.0.0`), /1 version\(s\) need provides/)
  assert.equal(f.read(), original)
  ok(await f.project('--write', `${name}@1.0.0`, '@example/plain@1.0.0'))
  const projected = f.read()
  assert.equal(projected.replace(',\r\n          "provides": ["skills","tool"]', ''), original)
  assert.deepEqual(JSON.parse(projected).plugins[0].versions[0].provides, ['skills', 'tool'])
  assert.equal(JSON.parse(projected).plugins[1].versions[0].provides, undefined)
  ok(await f.project('--write', `${name}@1.0.0`))
  assert.equal(f.read(), projected)
  assert.equal(existsSync(f.sentinel), false)

  const enriched = f.snapshot(base)
  f.requests.length = 0
  ok(await f.validate(base, enriched))
  assert.deepEqual(f.requests, [tagPath('example/toolkit', '1.0.0'), ...paths].map((path) => ({ path, auth: undefined })))
  assert.match((await f.publication(base, enriched)).reason, /validation did not pass|do not qualify/)

  const duplicatePin = { ...without(entry), version: '1.0.1' }
  const repo = 'example/toolkit'
  f.stage(catalog(listing(name, without(entry), duplicatePin)))
  f.requests.length = 0
  rejects(await f.project('--write'), /refs\/tags\/v1\.0\.1.*pinned commit/)
  assert.deepEqual(f.requests.splice(0).map(({ path }) => path), [
    tagPath(repo, '1.0.0'), ...paths, tagPath(repo, '1.0.1'),
  ])
  f.routes.set(tagPath(repo, '1.0.1'), tagRef('1.0.1', entry.source.commit))
  rejects(await f.project('--write'), /does not match the indexed package name and version/)
  assert.deepEqual(f.requests.map(({ path }) => path), [
    tagPath(repo, '1.0.0'), ...paths, tagPath(repo, '1.0.1'),
  ])
})

test('only historical enrichment accepts an exact default tip or a proven ancestor, and leaves unproven versions unknown', async (t) => {
  const f = await fixture(t)
  const repo = 'example/history'
  const name = '@example/history'
  const { entry, paths } = f.info(repo, name, '1.0.0', { alterPkg: { engines: undefined } })
  const { commit } = entry.source
  const tip = f.info(repo, name, '2.0.0', { parent: commit, provides: ['service'] }).entry.source.commit
  const tag = tagPath(repo, entry.version)
  const head = headPath(repo)
  const compare = comparePath(repo, commit, tip)
  const target = `${name}@${entry.version}`
  f.stage(catalog(listing(name, { ...without(entry), engines: {} })))
  const original = f.read()
  const base = f.snapshot()
  f.routes.set(tag, tagRef(entry.version, tip))
  f.routes.set(head, [{ sha: commit }])
  rejects(await f.project('--write', target), /refs\/tags\/v1\.0\.0.*pinned commit/)
  assert.equal(f.read(), original)
  f.requests.length = 0
  ok(await f.project('--write', '--historical', target))
  assert.deepEqual(f.requests.splice(0).map(({ path }) => path), [tag, head, ...paths])
  const enriched = f.snapshot(base)
  assert.deepEqual(JSON.parse(f.read()).plugins[0].versions[0].provides, ['skills', 'tool'])

  f.put('docs/index.json', original)
  f.routes.delete(tag)
  f.routes.set(head, [{ sha: tip }])
  rejects(await f.validate(base, enriched), /default HEAD comparison.*HTTP 404/)
  const comparison = { base_commit: { sha: commit }, merge_base_commit: { sha: commit }, status: 'ahead', commits: [{ sha: tip }] }
  for (const response of [
    undefined,
    { ...comparison, merge_base_commit: { sha: tip } },
    { ...comparison, base_commit: { sha: tip } },
    { ...comparison, commits: [{ sha: commit }] },
    { ...comparison, status: 'diverged' },
    { ...comparison, status: 'behind' },
    { ...comparison, status: 'identical' },
  ]) {
    f.routes.set(compare, response)
    rejects(await f.project('--write', '--historical', target), /default HEAD comparison/)
    assert.equal(f.read(), original)
  }
  f.routes.set(compare, comparison)
  f.routes.set(head, [{ sha: 'main' }])
  rejects(await f.validate(base, enriched), /default HEAD.*valid commit SHA/)
  f.routes.set(head, [{ sha: tip }])
  f.requests.length = 0
  ok(await f.validate(base, enriched))
  assert.deepEqual(f.requests.splice(0), [tag, head, compare, ...paths].map((path) => ({ path, auth: undefined })))
  ok(await f.project('--write', '--historical', target))
  assert.deepEqual(JSON.parse(f.read()).plugins[0].versions[0].provides, ['skills', 'tool'])
})

test('unavailable, redirected, oversize, symlink and mismatched Git evidence fail closed', async (t) => {
  const f = await fixture(t)
  f.stage(catalog())
  const base = f.snapshot()
  const name = '@example/evidence'
  const repo = 'example/evidence'
  const headFor = (entry) => {
    f.stage(catalog(listing(name, entry)))
    return f.snapshot(base)
  }
  for (const [options, reason] of [
    [{ absent: true }, /regular root package\.json/],
    [{ mode: '120000', raw: 'subdir/manifest.json' }, /regular root package\.json/],
    [{ alterPkg: { name: '@wrong/evidence' } }, /indexed package name and version/],
    [{ alterPkg: { version: '2.0.0' } }, /indexed package name and version/],
    [{ alterPkg: { agnes: {} } }, /no agnes\.provides/],
    [{ alterPkg: { agnes: { provides: [] } } }, /invalid package\.json agnes\.provides/],
    [{ raw: ' '.repeat(256 * 1024 + 1) }, /between 1 byte and 256 KiB/],
  ]) {
    rejects(await f.validate(base, headFor(f.info(repo, name, '1.0.0', options).entry)), reason)
  }
  const { entry, paths: [commit, tree, blob] } = f.info(repo, name, '1.0.0')
  const head = headFor(entry)
  const saved = new Map(f.routes)
  const attempt = async (path, response, reason) => {
    f.routes.set(path, response)
    rejects(await f.validate(base, head), reason)
    f.routes.set(path, saved.get(path))
  }
  const tag = tagPath(repo, entry.version)
  await attempt(tag, { status: 302, headers: { Location: '/redirect-target' } }, /network failure or redirect/)
  await attempt(commit, { status: 302, headers: { Location: '/redirect-target' } }, /network failure or redirect/)
  assert.equal(f.requests.some(({ path }) => path === '/redirect-target'), false)
  await attempt(commit, { ...saved.get(commit), sha: 'a'.repeat(40) }, /requested SHA/)
  await attempt(tree, { ...saved.get(tree), truncated: true }, /tree was incomplete/)
  await attempt(tree, { status: 200, body: 'x'.repeat(2 * 1024 * 1024 + 1) }, /response exceeds 2 MiB/)
  const damage = Buffer.from(saved.get(blob).content, 'base64')
  damage[0] = 0x20
  await attempt(blob, { ...saved.get(blob), content: damage.toString('base64') }, /did not match the Git blob/)
})

test('enrichment and correction are isolated, and correction proves its origin on trusted base history', async (t) => {
  const f = await fixture(t)
  const a = '@example/a'
  const b = '@example/b'
  const first = {
    ...f.info('example/a', a, '1.0.0', { alterPkg: { engines: { agh: {} } } }).entry,
    engines: { agh: 'invalid historical range' },
  }
  const second = f.info('example/b', b, '1.0.0').entry
  const newer = f.info('example/a', a, '2.0.0', { provides: ['service'] }).entry
  const legacy = (...rows) => catalog(listing(a, without(first)), listing(b, without(second)), ...rows)
  f.stage(legacy())
  const base = f.snapshot()
  ok(await f.project('--write', `${a}@1.0.0`))
  const added = f.read()
  const enriched = f.snapshot(base)
  ok(await f.validate(base, enriched))
  const restored = added.replace(',\n          "provides": ["skills","tool"]', '')
  assert.notEqual(restored, added)

  // Later legitimate releases do not invalidate the proof for a retained old record.
  const current = JSON.parse(added)
  current.plugins[0].versions.unshift(newer)
  f.stage(current, [pin(newer)])
  const updated = f.snapshot(enriched)
  const newTag = tagPath('example/a', newer.version)
  f.routes.delete(newTag)
  f.routes.set(headPath('example/a'), [{ sha: newer.source.commit }])
  rejects(await f.validate(enriched, updated), /refs\/tags\/v2\.0\.0.*pinned commit/)
  f.routes.set(newTag, tagRef(newer.version, newer.source.commit))
  ok(await f.validate(enriched, updated))
  const later = f.read()
  const candidate = ({ text, extra } = {}) => {
    f.stage(current, [pin(newer)], { text: text ?? later, extra })
    return f.snapshot(updated)
  }
  // The correction retains the exact spacing used by the base, not the earlier projection.
  const correction = later.replace(/,\n          "provides": \[\n            "skills",\n            "tool"\n          \]/, '')
  f.requests.length = 0
  const corrected = candidate({ text: correction })
  const valid = await f.validate(updated, corrected)
  ok(valid)
  assert.match(valid.stdout, new RegExp(`enrichment recorded at ${enriched}`))
  assert.deepEqual(f.requests, [])
  assert.match((await f.publication(updated, corrected)).reason, /validation did not pass|do not qualify/)

  const trimmed = later.replace(/,\n          "provides": \[\n            "service"\n          \]/, '')
  rejects(await f.validate(updated, candidate({ text: trimmed })), /not introduced by an index-only enrichment/)
  rejects(await f.validate(updated, candidate({ text: correction.replace('"format": 1', '"format" : 1') })), /cannot change outside index-only/)
  rejects(await f.validate(updated, candidate({ text: later.replace('"skills"', '"loop"') })), /cannot change outside index-only/)
  rejects(await f.validate(updated, candidate({ text: correction, extra: ['other.txt', 'unrelated\n'] })), /must change only docs\/index\.json/)
  rmSync(join(f.cwd, 'other.txt'))
  const mixed = JSON.parse(correction)
  mixed.plugins[1].versions[0].provides = second.provides
  rejects(await f.validate(updated, candidate({ text: json(mixed) })), /cannot change outside index-only/)

  f.stage(catalog(listing(a, newer), listing(b, without(second))), [pin(newer)])
  const replacing = f.snapshot(base)
  ok(await f.validate(base, replacing))
  assert.deepEqual(await f.publication(base, replacing), { kind: 'release-update' })
  f.stage(catalog(listing(a, newer), listing(b, without(second))))
  rejects(await f.validate(base, f.snapshot(base)), /declare the intended update/)
  f.stage(catalog(listing(a, without(first), newer), listing(b, without(second))), [pin(newer)])
  const withBoth = f.snapshot(base)
  f.stage(legacy())
  rejects(await f.validate(withBoth, f.snapshot(withBoth)), /do not drop versions/)
})

test('the local rebuild reads provides and committer time from the exact tagged object', async (t) => {
  const f = await fixture(t)
  const name = '@example/upstream'
  const { entry } = f.info('example/upstream', name, '1.0.0', { alterPkg: { engines: { agh: '>=1.2.0' } } })
  const other = f.info('example/upstream', name, '1.0.0', { provides: ['service'] }).entry
  git(f.upstream, ['update-ref', 'refs/tags/v1.0.0', entry.source.commit])
  git(f.upstream, ['update-ref', 'refs/heads/main', other.source.commit])
  mkdirSync(join(f.cwd, 'tools'))
  for (const script of ['build-index.mjs', 'public-submission.mjs', 'release-metadata.mjs']) {
    f.put(`tools/${script}`, readFileSync(tool(`./${script}`)))
  }
  f.put('plugins.txt', `${entry.source.url}\n`)
  ok(await f.node('tools/build-index.mjs', f.root))
  const [plugin] = JSON.parse(f.read()).plugins
  assert.equal(plugin.name, name)
  assert.deepEqual(plugin.versions, [{ ...entry, engines: { agh: '>=1.2.0' } }])
  assert.equal(existsSync(f.sentinel), false)
  assert.deepEqual(f.requests, [])
})

test('release review still requires the tag, author delegation and scanning, and compares indexed types', async (t) => {
  const f = await fixture(t)
  const name = '@example/plugin'
  const repo = 'example/plugin'
  const { entry } = f.info(repo, name, '1.0.0', {
    alterPkg: { scripts: undefined, license: 'MIT' },
    files: { LICENSE: 'MIT License\n', 'agh.market.json': JSON.stringify({ repository: `https://github.com/${repo}`, submitters: [42] }) },
  })
  const differentTag = f.info(repo, name, '1.0.0', { provides: ['service'] }).entry
  git(f.upstream, ['update-ref', 'refs/tags/v1.0.0', entry.source.commit])
  f.stage(catalog())
  const base = f.snapshot()
  const bin = join(f.root, 'bin')
  mkdirSync(bin)
  const originalGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const launch = join(bin, 'git')
  const publicRemote = `${entry.source.url}.git`
  writeFileSync(launch, `#!${process.execPath}
const { spawnSync } = require('node:child_process')
const args = process.argv.slice(2)
const fetch = args.indexOf('fetch')
if (fetch !== -1) {
  if (process.env.GH_TOKEN || !args.includes(${JSON.stringify(publicRemote)}) || !args.includes('--no-recurse-submodules') ||
      !args.includes('http.followRedirects=false') || args.at(-1) !== 'refs/tags/v1.0.0') process.exit(70)
  args.splice(args.indexOf(${JSON.stringify(publicRemote)}), 1, ${JSON.stringify(f.upstream)})
  args.splice(fetch, 0, '-c', 'protocol.file.allow=always')
}
const result = spawnSync(${JSON.stringify(originalGit)}, args, { stdio: 'inherit' })
process.exit(result.status ?? 70)
`, { mode: 0o755 })
  writeFileSync(join(bin, 'gitleaks'), '#!/bin/sh\nexit "${FIXTURE_SCANNER_STATUS:-0}"\n', { mode: 0o755 })
  const event = join(f.root, 'event.json')
  async function review(release, { actor = 42, scannerStatus = 0 } = {}) {
    f.stage(catalog(listing(name, release)))
    const head = f.snapshot(base)
    writeFileSync(event, JSON.stringify({
      pull_request: { base: { sha: base }, head: { sha: head }, user: { id: actor }, title: 'Submit plugin' },
    }))
    const args = [tool('./review-release.mjs'), base, head, event]
    const reviewEnv = { ...env, PATH: `${bin}:${env.PATH}`, GH_TOKEN: 'fixture-market-token', FIXTURE_SCANNER_STATUS: String(scannerStatus) }
    try {
      const result = await exec(process.execPath, args, { cwd: f.cwd, env: reviewEnv, timeout: 30_000 })
      return { ...result, status: 0 }
    } catch (error) {
      return { status: error.code, stdout: error.stdout, stderr: error.stderr }
    }
  }
  const valid = await review(entry)
  ok(valid)
  assert.match(valid.stdout, /Release review: passed/)
  for (const [release, options, reason] of [
    [{ ...entry, provides: ['tool', 'skills'] }, {}, /PROVIDES_MISMATCH/],
    [without(entry), {}, /PROVIDES_MISMATCH/],
    [entry, { actor: 7 }, /PUBLIC_PROOF/],
    [entry, { scannerStatus: 21 }, /RELEASE_SECRET/],
  ]) {
    const result = await review(release, options)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stdout, reason)
  }
  git(f.upstream, ['update-ref', 'refs/tags/v1.0.0', differentTag.source.commit])
  const moved = await review(entry)
  assert.equal(moved.status, 1, moved.stderr)
  assert.match(moved.stdout, /TAG_MISMATCH/)
  assert.equal(existsSync(f.sentinel), false)
})

test('the required workflow rejects a moved PR and reports only against the event head', async (t) => {
  const f = await fixture(t)
  const workflow = readFileSync(tool('../.github/workflows/market.yml'), 'utf8')
  const [, block] = /^        run: \|\n(          set -euo pipefail[\s\S]*)$/m.exec(workflow)
  const shell = block.replace(/^          /gm, '')
  const base = 'a'.repeat(40)
  const head = 'b'.repeat(40)
  const newer = 'c'.repeat(40)
  const fixtures = `
    gh() { printf '%s\\n' "$*"; }
    git() {
      case "$*" in
        'rev-parse HEAD') printf '%s\\n' "$BASE_SHA";;
        'rev-parse FETCH_HEAD') printf '%s\\n' "$FIXTURE_FETCHED";;
        *'refs/pull/7/head') :;;
        *) exit 99;;
      esac
    }
    node() { printf 'validator %s\\n' "$*"; }
  `
  async function check(fetched) {
    try {
      const result = await exec('bash', ['-c', fixtures + '\n' + shell], { cwd: f.cwd, env: {
        ...env, PR_NUMBER: '7', BASE_SHA: base, HEAD_SHA: head, FIXTURE_FETCHED: fetched,
        GITHUB_REPOSITORY: 'example/market', GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '100',
      } })
      return { ...result, status: 0 }
    } catch (error) {
      return { status: error.code, stdout: error.stdout, stderr: error.stderr }
    }
  }
  const moved = await check(newer)
  assert.equal(moved.status, 1, moved.stderr)
  assert.match(moved.stdout, /head moved/)
  assert.equal(moved.stdout.includes('validator '), false)

  // The workflow intentionally discards gh stdout, so keep a trace on stderr.
  const visible = fixtures.replace(`printf '%s\\n' "$*";`, `printf '%s\\n' "$*" >&2;`)
  const result = await exec('bash', ['-c', visible + '\n' + shell], { cwd: f.cwd, env: {
    ...env, PR_NUMBER: '7', BASE_SHA: base, HEAD_SHA: head, FIXTURE_FETCHED: head,
    GITHUB_REPOSITORY: 'example/market', GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '100',
  } })
  assert.match(result.stdout, new RegExp(`validator tools/validate-index.mjs ${base} ${head}`))
  assert.match(result.stderr, new RegExp(`statuses/${head}.*state=success`))
  assert.equal(result.stderr.includes(`statuses/${newer}`), false)
})
