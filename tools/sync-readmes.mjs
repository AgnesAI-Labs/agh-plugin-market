import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const startMarker = '<!-- market-list:start -->'
const endMarker = '<!-- market-list:end -->'
const readmes = [
  { file: 'README.md', locale: 'en', header: '| Plugin | Package | Latest stable version |' },
  { file: 'README.zh-CN.md', locale: 'zh-cn', header: '| 插件 | 包名 | 最新稳定版 |' },
]

const singleLine = (text) => text?.replace(/[\s\u0085]+/g, ' ').trim() || ''

function titleFor(title, locale, name) {
  const label = typeof title === 'string' ? singleLine(title) :
    singleLine(title?.[locale]) || (locale === 'en' ? '' : singleLine(title?.en))
  // Encode ASCII punctuation so GFM treats the entire link label as literal table text.
  return (label || name).replace(/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/g, (char) => `&#${char.charCodeAt(0)};`)
}

function latestVersion(versions) {
  let latest
  let highest
  for (const { version } of versions) {
    // Validated versions have three numeric components, possibly larger than MAX_SAFE_INTEGER.
    const parts = version.split('.').map(BigInt)
    const difference = highest?.findIndex((part, i) => part !== parts[i])
    if (!highest || (difference !== -1 && parts[difference] > highest[difference])) {
      latest = version.trimEnd()
      highest = parts
    }
  }
  return latest
}

function renderReadme(file, current, table) {
  const start = current.indexOf(startMarker)
  const end = current.indexOf(endMarker)
  if (start < 0 || end < start || start !== current.lastIndexOf(startMarker) || end !== current.lastIndexOf(endMarker)) {
    throw new Error(`${file}: expected exactly one ordered pair of market list markers`)
  }
  return `${current.slice(0, start + startMarker.length)}\n\n${table}\n\n${current.slice(end)}`
}

function sync(check) {
  // Run tools/validate-index.mjs first. Use the validated repository URL, never the homepage.
  const index = JSON.parse(readFileSync(new URL('docs/index.json', root), 'utf8'))
  const plugins = index.plugins.map(({ name, title, repository, versions }) => ({
    name: name.trimEnd(), title, url: repository.url.trimEnd(), version: latestVersion(versions),
  }))
  const stale = []
  for (const { file, locale, header } of readmes) {
    const path = new URL(file, root)
    const current = readFileSync(path, 'utf8')
    const rows = plugins.map(({ name, title, url, version }) =>
      `| [${titleFor(title, locale, name)}](${url}) | \`${name}\` | \`${version}\` |`)
    const table = [header, '| --- | --- | --- |', ...rows].join('\n')
    const next = renderReadme(file, current, table)
    if (next !== current) stale.push({ file, path, next })
  }
  if (check && stale.length) {
    console.error(`${stale.map(({ file }) => file).join(', ')}: stale market tables; run node tools/sync-readmes.mjs`)
    process.exitCode = 1
  } else {
    for (const { path, next } of stale) writeFileSync(path, next)
  }
}

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  console.error('Usage: node tools/sync-readmes.mjs [--check]')
  process.exitCode = 2
} else {
  try {
    sync(args.length === 1)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
