import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const locales = [
  {
    lang: 'en', key: 'en', stem: 'plugins', label: 'English',
    heading: 'Agnes Harness plugin directory',
    columns: ['Plugin', 'Package', 'Latest stable version'],
    description: 'Plugin titles, packages, and latest stable versions. Open the directory page for full labels and repository links.',
  },
  {
    lang: 'zh-CN', key: 'zh-cn', stem: 'plugins.zh-CN', label: '简体中文',
    heading: 'Agnes Harness 插件目录',
    columns: ['插件', '包名', '最新稳定版'],
    description: '插件名称、包名及最新稳定版。打开目录网页即可查看完整名称和仓库链接。',
  },
]

const singleLine = (text) => text?.replace(/[\s\u0085]+/g, ' ').trim() || ''
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeMarkup(text) {
  // Replace invalid XML 1.0 scalars (including unpaired surrogates) in both formats.
  return text.replace(/[^\x09\x0a\x0d\x20-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '\ufffd')
    .replace(/[&<>"']/g, (character) => entities[character])
}

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

function renderHtml(locale, alternate, rows) {
  const { lang, heading, columns } = locale
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${heading}</title>
  <style>
    :root { color-scheme: light dark; background: Canvas; color: CanvasText; font: 100%/1.5 system-ui, sans-serif; }
    body { max-width: 72rem; margin: 1.5rem auto; padding: 0 .75rem; }
    h1 { font-size: clamp(1.5rem, 5vw, 2.2rem); }
    table { border-collapse: collapse; table-layout: fixed; width: 100%; }
    th, td { border-bottom: 1px solid GrayText; padding: .65rem .5rem; text-align: start; vertical-align: top; overflow-wrap: anywhere; }
    thead th:last-child { width: 23%; }
    tbody th { font-weight: normal; }
  </style>
</head>
<body>
<main>
  <nav><a href="${alternate.stem}.html" hreflang="${alternate.lang}" lang="${alternate.lang}">${alternate.label}</a></nav>
  <h1 id="directory-title">${heading}</h1>
  <table aria-labelledby="directory-title">
    <thead><tr>${columns.map((column) => `<th scope="col">${column}</th>`).join('')}</tr></thead>
    <tbody>
${rows.map(({ title, name, version, url }) => `      <tr><th scope="row"><a href="${url}"><bdi>${title}</bdi></a></th><td><code>${name}</code></td><td><code>${version}</code></td></tr>`).join('\n')}
    </tbody>
  </table>
</main>
</body>
</html>
`
}

function renderSvg(locale, rows) {
  const { lang, heading, description, columns } = locale
  const width = 920
  const headerTop = 46
  const bodyTop = 80
  const rowHeight = 30
  const height = bodyTop + rows.length * rowHeight + 8
  const starts = [16, 380, 716, width]
  const cell = (text, i, y, attributes = '') =>
    `<text x="${starts[i]}" y="${y}" clip-path="url(#column-${i})"${attributes}>${text}</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="catalog-title" aria-describedby="catalog-description" xml:lang="${lang}">
  <title id="catalog-title">${heading}</title>
  <desc id="catalog-description">${description}</desc>
  <defs>
${columns.map((_, i) => `    <clipPath id="column-${i}"><rect x="${starts[i]}" y="0" width="${starts[i + 1] - starts[i] - 16}" height="${height}"/></clipPath>`).join('\n')}
  </defs>
  <rect width="${width}" height="${height}" fill="#fff" rx="6"/>
  <rect y="${headerTop}" width="${width}" height="${bodyTop - headerTop}" fill="#dce8f4"/>
  <g font-family="system-ui, sans-serif" fill="#182539">
    <text x="16" y="31" font-size="22" font-weight="700">${heading}</text>
    <g font-size="15" font-weight="700">${columns.map((column, i) => cell(column, i, 68)).join('')}</g>
    <g font-size="15">
${rows.map(({ title, name, version }, i) => {
    const y = bodyTop + i * rowHeight
    return `      <g>${i % 2 ? `<rect y="${y}" width="${width}" height="${rowHeight}" fill="#eef3f9"/>` : ''}${cell(title, 0, y + 20)}${cell(name, 1, y + 20, ' font-family="monospace"')}${cell(version, 2, y + 20, ' font-family="monospace"')}</g>`
  }).join('\n')}
    </g>
  </g>
</svg>
`
}

function build(site) {
  // The deployment validates the staged index before calling this generator.
  const { plugins } = JSON.parse(readFileSync(join(site, 'index.json'), 'utf8'))
  const entries = plugins.map(({ name, title, repository, versions }) => ({
    name: name.trimEnd(),
    title,
    url: `https://github.com/${repository.url.slice('https://github.com/'.length).trimEnd()}`,
    version: latestVersion(versions),
  }))
  for (const [i, locale] of locales.entries()) {
    const rows = entries.map((entry) => ({
      ...entry,
      name: escapeMarkup(entry.name),
      title: escapeMarkup(titleFor(entry.title, locale.key, entry.name)),
    }))
    writeFileSync(join(site, `${locale.stem}.html`), renderHtml(locale, locales[1 - i], rows))
    writeFileSync(join(site, `${locale.stem}.svg`), renderSvg(locale, rows))
  }
}

const args = process.argv.slice(2)
if (args.length !== 1) {
  console.error('Usage: node tools/build-market-pages.mjs SITE_DIR')
  process.exitCode = 2
} else {
  try {
    build(args[0])
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
