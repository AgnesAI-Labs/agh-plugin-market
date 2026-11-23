import { isUtf8 } from 'node:buffer'
import { catalogRows, safeUnicode } from './catalog-rows.mjs'

export const readmeLocales = {
  'README.md': { locale: 'en', headings: '| Plugin | Package | Latest stable version |' },
  'README.zh-CN.md': { locale: 'zh-cn', headings: '| 插件 | 包名 | 最新稳定版 |' },
}

const start = '<!-- market-catalog:start -->'
const end = '<!-- market-catalog:end -->'

function escapeLabel(label) {
  // Entities become literal text only after GFM has parsed tables, links and markup.
  // Encode ASCII punctuation, including URL/email delimiters that could start autolinks.
  return safeUnicode(label).replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/g, (char) => `&#${char.charCodeAt(0)};`)
}

export function replaceReadmeTable(path, bytes, plugins) {
  if (!isUtf8(bytes)) throw new Error(`${path}: expected UTF-8`)
  const body = bytes.toString('utf8')
  const opening = body.indexOf(start)
  const closing = body.indexOf(end)
  const afterOpening = opening + start.length
  const newline = body.startsWith('\r\n', afterOpening) ? '\r\n' : '\n'
  if (opening < 0 || closing <= afterOpening || body.lastIndexOf(start) !== opening || body.lastIndexOf(end) !== closing
    || (opening !== 0 && body[opening - 1] !== '\n') || !body.startsWith(newline, afterOpening)
    || body[closing - 1] !== '\n' || !/^(?:\r?\n|$)/.test(body.slice(closing + end.length))) {
    throw new Error(`${path}: expected exactly one pair of standalone market catalog markers`)
  }
  const { locale, headings } = readmeLocales[path]
  const rows = catalogRows(plugins, locale).map(({ title, name, url, version }) =>
    `| [${escapeLabel(title) || escapeLabel(name)}](${url}) | \`${name}\` | \`${version}\` |`)
  const table = ['', '', headings, '| --- | --- | --- |', ...rows, '', ''].join(newline)
  return Buffer.from(body.slice(0, afterOpening) + table + body.slice(closing), 'utf8')
}
