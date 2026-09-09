import type { UserConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-prompt-inject'

const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-locale/client',
  '@deepseek-ai/dsh-client-ui-conversation',
] as const

export default [
  {
    // host：Node 侧 ESM
    entry: { index: 'src/host/index.ts' },
    outDir: 'lib/host',
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    dts: true,
    clean: true,
  },
  {
    // client：浏览器侧 CJS 单文件 + __ModuleLoader__.load banner（dsh 客户端插件契约）
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib/client',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    clean: true,
    deps: { neverBundle: [...CLIENT_EXTERNALS] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
