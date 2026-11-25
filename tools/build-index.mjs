#!/usr/bin/env node
// Build docs/index.json (plugin market index format 1, AGH flavour) from local clones of the repos in plugins.txt.
//   node tools/build-index.mjs <dir-with-clones>
// Each listed repository must be cloned as <dir>/<repo-name> with its release tags fetched. The newest vX.Y.Z tag
// whose package.json version matches is listed, pinned to the tag's commit.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalRepository, publicRepository } from './public-submission.mjs'
import { fullSha, manifestProvides, maxManifestBytes, validAghRange, validTimestamp } from './release-metadata.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = process.argv[2]
if (!dir) {
  console.error('usage: build-index.mjs <dir-with-clones>')
  process.exit(2)
}
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], {
  encoding: 'utf8', maxBuffer: maxManifestBytes + 1, timeout: 15_000,
  env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' },
}).trim()
const text = (value, locales, key) => {
  const zh = locales?.['zh-CN']?.[key]
  return zh ? { en: value, 'zh-cn': zh } : value
}

const urls = readFileSync(join(root, 'plugins.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
const plugins = urls.map((url) => {
  if (!canonicalRepository(url)) throw new Error(`${url}: expected a public GitHub repository URL`)
  const repo = join(dir, url.split('/').pop())
  const tag = git(repo, 'tag', '--list', 'v*', '--sort=-v:refname').split('\n')[0]
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) throw new Error(`${url}: expected a stable vX.Y.Z release tag`)
  const commit = git(repo, 'rev-parse', '--verify', `refs/tags/${tag}^{commit}`)
  if (!fullSha.test(commit)) throw new Error(`${url}: expected a full commit SHA`)
  const file = /^100(?:644|755) blob ([0-9a-f]{40}) +([0-9]+)\tpackage\.json$/.exec(
    git(repo, 'ls-tree', '-l', commit, '--', 'package.json'),
  )
  if (!file || Number(file[2]) > maxManifestBytes) throw new Error(`${url}: expected a regular root package.json of up to 256 KiB`)
  const pkg = JSON.parse(git(repo, 'cat-file', 'blob', file[1]))
  if (`v${pkg.version}` !== tag) throw new Error(`${url}: tag ${tag} does not match package.json ${pkg.version}`)
  if (!pkg.agnes) throw new Error(`${url}: package.json has no agnes declaration`)
  const provides = manifestProvides(pkg, { name: pkg.name, version: pkg.version })
  const publishTimestamp = Number(git(repo, 'show', '-s', '--no-show-signature', '--no-notes', '--format=%ct', commit))
  if (!validTimestamp(publishTimestamp)) throw new Error(`${url}: invalid Git committer time`)
  const agh = pkg.engines?.agh
  if (agh !== undefined && !validAghRange(agh)) throw new Error(`${url}: unsupported engines.agh range`)
  const meta = pkg.agnes.metadata ?? {}
  return {
    name: pkg.name,
    ...(meta.displayName && { title: text(meta.displayName, meta.locales, 'displayName') }),
    ...(meta.summary && { description: text(meta.summary, meta.locales, 'summary') }),
    author: publicRepository(pkg.name, url) ? url.split('/')[3] :
      (typeof pkg.author === 'string' ? pkg.author : pkg.author?.name) || 'AgnesAI Labs',
    homepage: url,
    repository: { url },
    metadata: { keywords: pkg.keywords ?? [], labels: [], sortKeys: {} },
    versions: [
      {
        version: pkg.version,
        publishTimestamp,
        source: { type: 'git', url, commit },
        engines: agh === undefined ? {} : { agh },
        ...(provides !== undefined && { provides }),
      },
    ],
  }
})

const index = {
  format: 1,
  title: { en: 'Agnes Harness official plugins', 'zh-cn': 'Agnes Harness 官方插件' },
  description: { en: 'Official AGH plugins, one GitHub repository each.', 'zh-cn': 'AGH 官方插件，每个插件一个 GitHub 仓库。' },
  metadata: { categories: {}, labels: {}, sortKeys: {} },
  plugins,
}
mkdirSync(join(root, 'docs'), { recursive: true })
writeFileSync(join(root, 'docs/index.json'), `${JSON.stringify(index, null, 2)}\n`)
console.log(`docs/index.json: ${plugins.map((p) => `${p.name}@${p.versions[0].version}`).join(', ')}`)
