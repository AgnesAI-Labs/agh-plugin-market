import { writeFileSync } from 'node:fs'
import { readmeLocales, replaceReadmeTable } from './readme-tables.mjs'
import { readCatalogFile, validateIndex } from './validate-index.mjs'

try {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/sync-readmes.mjs')
  const { plugins } = validateIndex()
  const updates = Object.keys(readmeLocales).map((path) => {
    const before = readCatalogFile(path)
    const after = replaceReadmeTable(path, before, plugins)
    return { path, before, after }
  })
  for (const { path, before, after } of updates) {
    if (!before.equals(after)) writeFileSync(path, after)
  }
  console.log('Market README tables synchronized.')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
