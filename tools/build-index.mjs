#!/usr/bin/env node
// Build docs/index.json (plugin market index format 1, AGH flavour) from local clones of the repos in plugins.txt.
//   node tools/build-index.mjs <dir-with-clones>
// Each listed repository must be cloned as <dir>/<repo-name> with its release tags fetched. The newest vX.Y.Z tag
// whose package.json version matches is listed, pinned to the tag's commit.
// ponytail: newest tag only and local clones; the real generator (all tags, remote reads) comes with AGH market support.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const dir = process.argv[2]
if (!dir) {
  console.error('usage: build-index.mjs <dir-with-clones>')
  process.exit(2)
}
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
const text = (value, locales, key) => {
  const zh = locales?.['zh-CN']?.[key]
  return zh ? { en: value, 'zh-cn': zh } : value
}

const urls = readFileSync(join(root, 'plugins.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
const plugins = urls.map((url) => {
  const repo = join(dir, url.split('/').pop())
  const tag = git(repo, 'tag', '--list', 'v*', '--sort=-v:refname').split('\n')[0]
  if (!tag) throw new Error(`${url}: no vX.Y.Z tag`)
  const commit = git(repo, 'rev-list', '-n1', tag)
  const pkg = JSON.parse(git(repo, 'show', `${commit}:package.json`))
  if (`v${pkg.version}` !== tag) throw new Error(`${url}: tag ${tag} does not match package.json ${pkg.version}`)
  if (!pkg.agnes) throw new Error(`${url}: package.json has no agnes declaration`)
  const meta = pkg.agnes.metadata ?? {}
  return {
    name: pkg.name,
    ...(meta.displayName && { title: text(meta.displayName, meta.locales, 'displayName') }),
    ...(meta.summary && { description: text(meta.summary, meta.locales, 'summary') }),
    author: 'AgnesAI Labs',
    homepage: url,
    repository: { url },
    metadata: { keywords: pkg.keywords ?? [], labels: [], sortKeys: {} },
    versions: [
      {
        version: pkg.version,
        publishTimestamp: Number(git(repo, 'log', '-1', '--format=%ct', commit)),
        source: { type: 'git', url, commit },
        engines: pkg.engines?.agh ? { agh: pkg.engines.agh } : {},
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
