const singleLine = (text) => text?.replace(/[\s\u0085]+/g, ' ').trim() || ''

// Replace invalid XML 1.0 scalars (including unpaired surrogates) for all renderers.
export const safeUnicode = (text) => text.replace(/[^\x09\x0a\x0d\x20-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '\ufffd')

function titleFor(title, locale, name) {
  const label = typeof title === 'string' ? singleLine(title) :
    singleLine(title?.[locale]) || (locale === 'en' ? '' : singleLine(title?.en))
  return label || name
}

function latestVersion(versions) {
  let latest
  let highest
  for (const { version } of versions) {
    // Validation allows only stable versions, with numeric components beyond MAX_SAFE_INTEGER.
    const parts = version.split('.').map(BigInt)
    const difference = highest?.findIndex((part, i) => part !== parts[i])
    if (!highest || (difference !== -1 && parts[difference] > highest[difference])) {
      latest = version.trimEnd()
      highest = parts
    }
  }
  return latest
}

// Callers supply a validated format-1 index.
export function catalogRows(plugins, locale) {
  return plugins.map(({ name, title, repository, versions }) => {
    name = name.trimEnd()
    return {
      name,
      title: titleFor(title, locale, name),
      url: 'https://github.com/' + repository.url.slice('https://github.com/'.length).trimEnd(),
      version: latestVersion(versions),
    }
  })
}
