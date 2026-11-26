import { isDeepStrictEqual as equal } from 'node:util'

export function withoutProvides(release) {
  const { provides, ...rest } = release
  return rest
}

// The input has already passed JSON.parse. Look only at the root plugins array,
// each row's versions array, and the fields immediately inside a release object.
function releaseLocations(text) {
  const tokens = text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|[^\s{}\[\],:"]+/g)
  let token = tokens.next().value
  const take = () => {
    const current = token
    token = tokens.next().value
    return current
  }
  const end = (item) => item.index + item[0].length
  const skip = () => {
    let item = take()
    if (item[0] !== '{' && item[0] !== '[') return end(item)
    let nesting = 1
    while (nesting) {
      item = take()
      if (item[0] === '{' || item[0] === '[') nesting++
      if (item[0] === '}' || item[0] === ']') nesting--
    }
    return end(item)
  }
  const object = (visit) => {
    const open = take()
    let previousEnd
    let first
    while (token[0] !== '}') {
      const key = take()
      first ??= key.index
      take() // colon
      previousEnd = visit(JSON.parse(key[0]), previousEnd, end(open))
      if (token[0] === '}') break
      take() // comma
    }
    return { end: end(take()), insertion: previousEnd, indent: text.slice(end(open), first) }
  }
  const array = (visit) => {
    take()
    while (token[0] !== ']') {
      visit()
      if (token[0] === ']') break
      take()
    }
    return end(take())
  }
  const releases = []
  const release = () => {
    let removal
    const location = object((property, previousEnd, openEnd) => {
      const valueEnd = skip()
      if (property === 'provides') {
        if (removal) throw new Error('duplicate provides in an indexed version')
        removal = previousEnd === undefined ? [openEnd, end(token)] : [previousEnd, valueEnd]
      }
      return valueEnd
    })
    releases.push({ ...location, removal })
  }
  let seenPlugins = false
  object((property) => {
    if (property !== 'plugins') return skip()
    if (seenPlugins) throw new Error('duplicate plugins property in index')
    seenPlugins = true
    return array(() => {
      let seenVersions = false
      object((property) => {
        if (property !== 'versions') return skip()
        if (seenVersions) throw new Error('duplicate versions property in indexed package')
        seenVersions = true
        return array(release)
      })
    })
  })
  return releases
}

export function editProvides(text, edits) {
  const locations = releaseLocations(text)
  const sorted = [...edits].sort((a, b) => a.ordinal - b.ordinal)
  let result = ''
  let cursor = 0
  for (const { ordinal, provides } of sorted) {
    const location = locations[ordinal]
    if (provides === undefined) {
      const [start, end] = location.removal
      result += text.slice(cursor, start)
      cursor = end
    } else {
      if (location.removal) throw new Error('refusing to overwrite indexed provides')
      result += text.slice(cursor, location.insertion) + `,${location.indent}"provides": ${JSON.stringify(provides)}`
      cursor = location.insertion
    }
  }
  return result + text.slice(cursor)
}

// null is not a metadata-only proposal. Even format-only edits outside the
// changed fields are out of scope, including property order and separators.
export function providesChange(before, after) {
  const changes = []
  let kind
  let ordinal = 0
  if (before.index.plugins.length !== after.index.plugins.length) return null
  for (const [i, row] of before.index.plugins.entries()) {
    const next = after.index.plugins[i]
    if (row.name !== next.name || row.versions.length !== next.versions.length) return null
    for (const [j, release] of row.versions.entries()) {
      const candidate = next.versions[j]
      const position = ordinal++
      if (equal(release, candidate)) continue
      const added = !Object.hasOwn(release, 'provides') && Object.hasOwn(candidate, 'provides')
      const removed = Object.hasOwn(release, 'provides') && !Object.hasOwn(candidate, 'provides')
      if ((!added && !removed) || !equal(withoutProvides(release), withoutProvides(candidate))) return null
      const direction = added ? 'enrich' : 'correct'
      if (kind && kind !== direction) return null
      kind = direction
      changes.push({ ordinal: position, name: row.name, release: added ? candidate : release })
    }
  }
  if (!kind) return null
  const edits = changes.map(({ ordinal }) => ({ ordinal }))
  const enriched = kind === 'enrich' ? after.text : before.text
  const absent = kind === 'enrich' ? before.text : after.text
  return editProvides(enriched, edits) === absent ? { kind, changes } : null
}
