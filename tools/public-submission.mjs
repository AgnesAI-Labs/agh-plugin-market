const githubUrl = /^https:\/\/github\.com\/([a-z0-9][a-z0-9-]{0,38})\/([a-z0-9_.-]{1,100})$/i
const scopedName = /^@([a-z0-9][a-z0-9-]{0,38})\/[a-z0-9][a-z0-9._-]*$/
const reservedScopes = new Set(['agnes', 'agnesai', 'agnes-ai', 'agnesai-labs', 'agnes-harness', 'agnes-showcase'])

export function canonicalRepository(url) {
  const match = typeof url === 'string' && githubUrl.exec(url)
  if (match && !/^\.{1,2}$|\.git$/i.test(match[2])) return `${match[1]}/${match[2]}`.toLowerCase()
}

export function publicRepository(name, url) {
  const scope = typeof name === 'string' && scopedName.exec(name)?.[1]
  return Boolean(scope && !reservedScopes.has(scope) && canonicalRepository(url)?.startsWith(`${scope}/`))
}

export function authorizedSubmitter(value, url, actor) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'repository') || !Object.hasOwn(value, 'submitters')) return false
  const repo = canonicalRepository(url)
  const { repository, submitters } = value
  if (!repo || canonicalRepository(repository) !== repo ||
      !Array.isArray(submitters) || submitters.length < 1 || submitters.length > 32) return false
  const ids = new Set()
  for (const id of submitters) {
    if (!Number.isSafeInteger(id) || id < 1 || ids.has(id)) return false
    ids.add(id)
  }
  // A catalog rehearsal has no PR actor, but still checks format and repository binding.
  return actor === undefined || ids.has(actor)
}
