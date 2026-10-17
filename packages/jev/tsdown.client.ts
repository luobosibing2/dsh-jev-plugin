/** Standalone DSH Client bundle, using the Host module-loader factory handoff. */

import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import type { TsdownPlugin, UserConfig } from 'tsdown'

const PACKAGE = '@dsh-jev/plugin'
const ROOT = dirname(fileURLToPath(import.meta.url))
const CSS_PREFIX = '\0jev-css:'
const CSS_SUFFIX = '.mjs'
const EXTERNAL = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
])

const styles: TsdownPlugin = {
  name: 'jev-css-modules',
  resolveId: {
    order: 'pre',
    handler(source, importer) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      return `${CSS_PREFIX}${resolve(dirname(importer), source)}${CSS_SUFFIX}`
    },
  },
  async load(id) {
    if (!id.startsWith(CSS_PREFIX)) return null
    const filename = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
    const sourcePath = relative(ROOT, filename).split(sep).join('/')
    this.addWatchFile(filename)
    const { code, exports } = transform({
      filename: sourcePath,
      code: await readFile(filename),
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classes = Object.fromEntries(Object.entries(exports ?? {})
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, value]) => [key, value.name]))
    const tag = `${PACKAGE}/${sourcePath}`
    return [
      `const tag = ${JSON.stringify(tag)};`,
      `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tag) + ']') === null) {`,
      `  const element = document.createElement('style');`,
      `  element.dataset.plugin = ${JSON.stringify(PACKAGE)};`,
      `  element.dataset.pluginCss = tag;`,
      `  element.textContent = ${JSON.stringify(code.toString())};`,
      `  document.head.appendChild(element);`,
      `}`,
      `export default ${JSON.stringify(classes)};`,
    ].join('\n')
  },
}

const requireOnlyHostModules: TsdownPlugin = {
  name: 'jev-host-module-table-only',
  generateBundle(_options, bundle) {
    for (const output of Object.values(bundle)) {
      if (output.type !== 'chunk') continue
      for (const source of [...output.imports, ...output.dynamicImports]) {
        if (source in bundle || EXTERNAL.has(source)) continue
        throw new Error(`Jev Client bundle cannot resolve ${source} from the Host module table`)
      }
    }
  },
}

const config: UserConfig = {
  name: `${PACKAGE}/client`,
  entry: { client: resolve(ROOT, 'src/client/index.ts') },
  outDir: resolve(ROOT, 'lib'),
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (source: string) => EXTERNAL.has(source),
    alwaysBundle: (source: string) => !EXTERNAL.has(source),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [styles, requireOnlyHostModules],
  outputOptions: {
    entryFileNames: 'client.js',
    chunkFileNames: 'client.[name].js',
    banner: (chunk) => `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default config
