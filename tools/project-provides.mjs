import { lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual as equal } from 'node:util'
import { editProvides } from './index-provides.mjs'
import { readReleaseMetadata } from './release-metadata.mjs'
import { validateIndex } from './validate-index.mjs'

const indexPath = 'docs/index.json'

async function project(mode, args) {
  const historical = args[0] === '--historical'
  const requested = historical ? args.slice(1) : args
  if (!['--check', '--write'].includes(mode) || new Set(requested).size !== requested.length) {
    throw new Error('Usage: node tools/project-provides.mjs (--check|--write) [--historical] [PACKAGE@VERSION ...]')
  }
  const { plugins, text } = validateIndex()
  const remaining = new Set(requested)
  const selected = []
  let ordinal = 0
  for (const { name, versions } of plugins) {
    for (const release of versions) {
      const identity = `${name}@${release.version}`
      if (requested.length ? remaining.delete(identity) : release.provides === undefined) {
        selected.push({ ordinal, name, release, identity })
      }
      ordinal++
    }
  }
  if (remaining.size) throw new Error(`Not in the index: ${[...remaining].join(', ')}`)

  const readMetadata = readReleaseMetadata({ historical })
  const edits = []
  let failed = false
  for (const { ordinal, name, release, identity } of selected) {
    try {
      const { provides } = await readMetadata(name, release)
      const source = `${identity} (${release.source.url}#${release.source.commit})`
      if (release.provides !== undefined && !equal(release.provides, provides)) {
        throw new Error(`${source}: existing provides does not match the pinned manifest; refusing to overwrite it`)
      }
      if (provides === undefined) console.log(`${source}: no agnes.provides declaration`)
      else {
        const present = release.provides !== undefined
        console.log(`${source}: ${present ? 'matches' : 'add'} ${JSON.stringify(provides)}`)
        if (!present) edits.push({ ordinal, provides })
      }
    } catch (error) {
      console.error(error.message)
      failed = true
    }
  }
  if (failed) throw new Error('Projection failed; docs/index.json was not changed. Retry, or select a verifiable batch explicitly.')
  if (!edits.length) return
  if (mode === '--check') throw new Error(`${edits.length} version(s) need provides; run --write with the same selection`)

  const next = editProvides(text, edits)
  if (Buffer.byteLength(next) > 2 * 1024 * 1024) throw new Error('Projected index would exceed 2 MiB')
  const temporary = mkdtempSync('docs/.project-provides-')
  try {
    const staged = join(temporary, 'index.json')
    const stat = lstatSync(indexPath)
    if (!stat.isFile() || readFileSync(indexPath, 'utf8') !== text) throw new Error('Index changed during projection; retry')
    writeFileSync(staged, next, { mode: stat.mode & 0o777 })
    renameSync(staged, indexPath)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

try {
  await project(process.argv[2], process.argv.slice(3))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
