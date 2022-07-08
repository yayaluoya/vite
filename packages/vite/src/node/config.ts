import fs from 'fs'
import path from 'path'
import type { Plugin } from './plugin'
import type { BuildOptions } from './build'
import { resolveBuildOptions } from './build'
import type { ResolvedServerOptions, ServerOptions } from './server'
import { resolveServerOptions } from './server'
import type { ResolvedPreviewOptions, PreviewOptions } from './preview'
import { resolvePreviewOptions } from './preview'
import type { CSSOptions } from './plugins/css'
import {
  arraify,
  createDebugger,
  isExternalUrl,
  isObject,
  lookupFile,
  normalizePath,
  dynamicImport
} from './utils'
import { resolvePlugins } from './plugins'
import colors from 'picocolors'
import type { ESBuildOptions } from './plugins/esbuild'
import dotenv from 'dotenv'
import dotenvExpand from 'dotenv-expand'
import type { Alias, AliasOptions } from 'types/alias'
import { CLIENT_ENTRY, ENV_ENTRY, DEFAULT_ASSETS_RE } from './constants'
import type { InternalResolveOptions, ResolveOptions } from './plugins/resolve'
import { resolvePlugin } from './plugins/resolve'
import type { Logger, LogLevel } from './logger'
import { createLogger } from './logger'
import type { DepOptimizationOptions } from './optimizer'
import { createFilter } from '@rollup/pluginutils'
import type { ResolvedBuildOptions } from '.'
import { parse as parseUrl } from 'url'
import type { JsonOptions } from './plugins/json'
import type { PluginContainer } from './server/pluginContainer'
import { createPluginContainer } from './server/pluginContainer'
import aliasPlugin from '@rollup/plugin-alias'
import { build } from 'esbuild'
import { performance } from 'perf_hooks'
import type { PackageCache } from './packages'
import type { RollupOptions } from 'rollup'

const debug = createDebugger('vite:config')

// NOTE: every export in this file is re-exported from ./index.ts so it will
// be part of the public API.
export interface ConfigEnv {
  command: 'build' | 'serve'
  mode: string
}

export type UserConfigFn = (env: ConfigEnv) => UserConfig | Promise<UserConfig>
export type UserConfigExport = UserConfig | Promise<UserConfig> | UserConfigFn

/**
 * Type helper to make it easier to use vite.config.ts
 * accepts a direct {@link UserConfig} object, or a function that returns it.
 * The function receives a {@link ConfigEnv} object that exposes two properties:
 * `command` (either `'build'` or `'serve'`), and `mode`.
 */
export function defineConfig(config: UserConfigExport): UserConfigExport {
  return config
}

export type PluginOption = Plugin | false | null | undefined

export interface UserConfig {
  /**
   * 项目根目录
   * Project root directory. Can be an absolute path, or a path relative from
   * the location of the config file itself.
   * @default process.cwd()
   */
  root?: string
  /**
   * 在开发或生产中提供服务时的基础公共路径。
   * Base public path when served in development or production.
   * @default '/'
   */
  base?: string
  /**
   * Directory to serve as plain static assets. Files in this directory are
   * served and copied to build dist dir as-is without transform. The value
   * can be either an absolute file system path or a path relative to <root>.
   *
   * Set to `false` or an empty string to disable copied static assets to build dist dir.
   * @default 'public'
   */
  publicDir?: string | false
  /**
   * 保存缓存文件的目录。此目录中的文件是预先捆绑的
    * deps或其他一些由vite生成的缓存文件，这可以改进
    *性能。您可以使用`- force '标志或手动删除该目录
    *重新生成缓存文件。该值可以是绝对文件
    *系统路径或相对于<根目录>的路径
   * Directory to save cache files. Files in this directory are pre-bundled
   * deps or some other cache files that generated by vite, which can improve
   * the performance. You can use `--force` flag or manually delete the directory
   * to regenerate the cache files. The value can be either an absolute file
   * system path or a path relative to <root>.
   * @default 'node_modules/.vite'
   */
  cacheDir?: string
  /**
   * 显式设置运行模式。这将覆盖的默认模式
*每个命令，并且可以被命令行模式选项覆盖
   * Explicitly set a mode to run in. This will override the default mode for
   * each command, and can be overridden by the command line --mode option.
   */
  mode?: string
  /**
   * 定义全局变量替换。
*条目将在开发期间在“窗口”上定义，并在构建期间替换
   * Define global variable replacements.
   * Entries will be defined on `window` during dev and replaced during build.
   */
  define?: Record<string, any>
  /**
   * Array of vite plugins to use.
   */
  plugins?: (PluginOption | PluginOption[])[]
  /**
   * Configure resolver
   */
  resolve?: ResolveOptions & { alias?: AliasOptions }
  /**
   * CSS related options (preprocessors and CSS modules)
   */
  css?: CSSOptions
  /**
   * JSON loading options
   */
  json?: JsonOptions
  /**
   * Transform options to pass to esbuild.
   * Or set to `false` to disable esbuild.
   */
  esbuild?: ESBuildOptions | false
  /**
   * 指定将被视为静态资产的附加微微匹配模式。
   * Specify additional picomatch patterns to be treated as static assets.
   */
  assetsInclude?: string | RegExp | (string | RegExp)[]
  /**
   * 服务器特定选项，例如主机、端口、https...
   * Server specific options, e.g. host, port, https...
   */
  server?: ServerOptions
  /**
   * Build specific options
   */
  build?: BuildOptions
  /**
   * 预览特定选项，例如主机、端口、https...
   * Preview specific options, e.g. host, port, https...
   */
  preview?: PreviewOptions
  /**
   * Dep优化选项
   * Dep optimization options
   */
  optimizeDeps?: DepOptimizationOptions
  /**
   * SSR特定选项
   * SSR specific options
   * @alpha
   */
  ssr?: SSROptions
  /**
   * Log level.
   * Default: 'info'
   */
  logLevel?: LogLevel
  /**
   * Custom logger.
   */
  customLogger?: Logger
  /**
   * Default: true
   */
  clearScreen?: boolean
  /**
   * Environment files directory. Can be an absolute path, or a path relative from
   * the location of the config file itself.
   * @default root
   */
  envDir?: string
  /**
   * Env variables starts with `envPrefix` will be exposed to your client source code via import.meta.env.
   * @default 'VITE_'
   */
  envPrefix?: string | string[]
  /**
   * Import aliases
   * @deprecated use `resolve.alias` instead
   */
  alias?: AliasOptions
  /**
   * Force Vite to always resolve listed dependencies to the same copy (from
   * project root).
   * @deprecated use `resolve.dedupe` instead
   */
  dedupe?: string[]
  /**
   * 工作捆绑包选项
   * Worker bundle options
   */
  worker?: {
    /**
     * Output format for worker bundle
     * @default 'iife'
     */
    format?: 'es' | 'iife'
    /**
     * Vite plugins that apply to worker bundle
     */
    plugins?: (PluginOption | PluginOption[])[]
    /**
     * Rollup options to build worker bundle
     */
    rollupOptions?: Omit<
      RollupOptions,
      'plugins' | 'input' | 'onwarn' | 'preserveEntrySignatures'
    >
  }
}

export type SSRTarget = 'node' | 'webworker'

export interface SSROptions {
  external?: string[]
  noExternal?: string | RegExp | (string | RegExp)[] | true
  /**
   * Define the target for the ssr build. The browser field in package.json
   * is ignored for node but used if webworker is the target
   * Default: 'node'
   */
  target?: SSRTarget
}

export interface InlineConfig extends UserConfig {
  /** 配置文件路径 */
  configFile?: string | false
  envFile?: false
}

export type ResolvedConfig = Readonly<
  Omit<
    UserConfig,
    'plugins' | 'alias' | 'dedupe' | 'assetsInclude' | 'optimizeDeps'
  > & {
    configFile: string | undefined
    configFileDependencies: string[]
    inlineConfig: InlineConfig
    root: string
    base: string
    publicDir: string
    command: 'build' | 'serve'
    mode: string
    isProduction: boolean
    env: Record<string, any>
    resolve: ResolveOptions & {
      alias: Alias[]
    }
    plugins: readonly Plugin[]
    server: ResolvedServerOptions
    build: ResolvedBuildOptions
    preview: ResolvedPreviewOptions
    assetsInclude: (file: string) => boolean
    logger: Logger
    createResolver: (options?: Partial<InternalResolveOptions>) => ResolveFn
    optimizeDeps: Omit<DepOptimizationOptions, 'keepNames'>
    /** @internal */
    packageCache: PackageCache
  }
>

export type ResolveFn = (
  id: string,
  importer?: string,
  aliasOnly?: boolean,
  ssr?: boolean
) => Promise<string | undefined>

/**
 * 解析配置文件
 * @param inlineConfig 命令行带入的参数
 * @param command 
 * @param defaultMode 默认的模式
 * @returns 
 */
export async function resolveConfig(
  inlineConfig: InlineConfig,
  //打包还是server
  command: 'build' | 'serve',
  defaultMode = 'development'
): Promise<ResolvedConfig> {
  //从命令行传入的配置数据
  let config = inlineConfig
  // 配置中的依赖列表
  let configFileDependencies: string[] = []
  //模式
  let mode = inlineConfig.mode || defaultMode

  // some dependencies e.g. @vue/compiler-* relies on NODE_ENV for getting
  // production-specific behavior, so set it here even though we haven't
  // resolve the final mode yet
  // 如果是生产环境的话就存到一个全局变量中
  if (mode === 'production') {
    //TODO 全局变量
    process.env.NODE_ENV = 'production'
  }

  const configEnv = {
    mode,
    command
  }

  //从传入的配置中找配置文件的路径
  let { configFile } = config
  if (configFile !== false) {
    //从文件中加载配置
    const loadResult = await loadConfigFromFile(
      configEnv,
      configFile,
      config.root,
      config.logLevel,
    )
    if (loadResult) {
      //合并配置文件
      config = mergeConfig(loadResult.config, config)
      //
      configFile = loadResult.path
      configFileDependencies = loadResult.dependencies
    }
  }

  // Define logger
  const logger = createLogger(config.logLevel, {
    allowClearScreen: config.clearScreen,
    customLogger: config.customLogger
  })

  // user config may provide an alternative mode. But --mode has a higher priority
  mode = inlineConfig.mode || config.mode || mode
  configEnv.mode = mode

  // resolve plugins
  const rawUserPlugins = (config.plugins || []).flat().filter((p) => {
    if (!p) {
      return false
    } else if (!p.apply) {
      return true
    } else if (typeof p.apply === 'function') {
      return p.apply({ ...config, mode }, configEnv)
    } else {
      return p.apply === command
    }
  }) as Plugin[]
  const [prePlugins, normalPlugins, postPlugins] =
    sortUserPlugins(rawUserPlugins)

  // run config hooks
  const userPlugins = [...prePlugins, ...normalPlugins, ...postPlugins]
  for (const p of userPlugins) {
    if (p.config) {
      const res = await p.config(config, configEnv)
      if (res) {
        config = mergeConfig(config, res)
      }
    }
  }

  // resolve root
  const resolvedRoot = normalizePath(
    config.root ? path.resolve(config.root) : process.cwd()
  )

  const clientAlias = [
    { find: /^[\/]?@vite\/env/, replacement: () => ENV_ENTRY },
    { find: /^[\/]?@vite\/client/, replacement: () => CLIENT_ENTRY }
  ]

  // resolve alias with internal client alias
  const resolvedAlias = mergeAlias(
    // @ts-ignore because @rollup/plugin-alias' type doesn't allow function
    // replacement, but its implementation does work with function values.
    clientAlias,
    config.resolve?.alias || config.alias || []
  )

  const resolveOptions: ResolvedConfig['resolve'] = {
    dedupe: config.dedupe,
    ...config.resolve,
    alias: resolvedAlias
  }

  // load .env files
  const envDir = config.envDir
    ? normalizePath(path.resolve(resolvedRoot, config.envDir))
    : resolvedRoot
  const userEnv =
    inlineConfig.envFile !== false &&
    loadEnv(mode, envDir, resolveEnvPrefix(config))

  // Note it is possible for user to have a custom mode, e.g. `staging` where
  // production-like behavior is expected. This is indicated by NODE_ENV=production
  // loaded from `.staging.env` and set by us as VITE_USER_NODE_ENV
  const isProduction = (process.env.VITE_USER_NODE_ENV || mode) === 'production'
  if (isProduction) {
    // in case default mode was not production and is overwritten
    process.env.NODE_ENV = 'production'
  }

  // resolve public base url
  const BASE_URL = resolveBaseUrl(config.base, command === 'build', logger)
  const resolvedBuildOptions = resolveBuildOptions(
    resolvedRoot,
    config.build,
    command === 'build'
  )

  // resolve cache directory
  const pkgPath = lookupFile(
    resolvedRoot,
    [`package.json`],
    true /* pathOnly */
  )
  const cacheDir = config.cacheDir
    ? path.resolve(resolvedRoot, config.cacheDir)
    : pkgPath && path.join(path.dirname(pkgPath), `node_modules/.vite`)

  const assetsFilter = config.assetsInclude
    ? createFilter(config.assetsInclude)
    : () => false

  // create an internal resolver to be used in special scenarios, e.g.
  // optimizer & handling css @imports
  const createResolver: ResolvedConfig['createResolver'] = (options) => {
    let aliasContainer: PluginContainer | undefined
    let resolverContainer: PluginContainer | undefined
    return async (id, importer, aliasOnly, ssr) => {
      let container: PluginContainer
      if (aliasOnly) {
        container =
          aliasContainer ||
          (aliasContainer = await createPluginContainer({
            ...resolved,
            plugins: [aliasPlugin({ entries: resolved.resolve.alias })]
          }))
      } else {
        container =
          resolverContainer ||
          (resolverContainer = await createPluginContainer({
            ...resolved,
            plugins: [
              aliasPlugin({ entries: resolved.resolve.alias }),
              resolvePlugin({
                ...resolved.resolve,
                root: resolvedRoot,
                isProduction,
                isBuild: command === 'build',
                ssrConfig: resolved.ssr,
                asSrc: true,
                preferRelative: false,
                tryIndex: true,
                ...options
              })
            ]
          }))
      }
      return (await container.resolveId(id, importer, { ssr }))?.id
    }
  }

  const { publicDir } = config
  const resolvedPublicDir =
    publicDir !== false && publicDir !== ''
      ? path.resolve(
        resolvedRoot,
        typeof publicDir === 'string' ? publicDir : 'public'
      )
      : ''

  const server = resolveServerOptions(resolvedRoot, config.server)

  const resolved: ResolvedConfig = {
    ...config,
    configFile: configFile ? normalizePath(configFile) : undefined,
    configFileDependencies,
    inlineConfig,
    root: resolvedRoot,
    base: BASE_URL,
    resolve: resolveOptions,
    publicDir: resolvedPublicDir,
    cacheDir,
    command,
    mode,
    isProduction,
    plugins: userPlugins,
    server,
    build: resolvedBuildOptions,
    preview: resolvePreviewOptions(config.preview, server),
    env: {
      ...userEnv,
      BASE_URL,
      MODE: mode,
      DEV: !isProduction,
      PROD: isProduction
    },
    assetsInclude(file: string) {
      return DEFAULT_ASSETS_RE.test(file) || assetsFilter(file)
    },
    logger,
    packageCache: new Map(),
    createResolver,
    optimizeDeps: {
      ...config.optimizeDeps,
      esbuildOptions: {
        keepNames: config.optimizeDeps?.keepNames,
        preserveSymlinks: config.resolve?.preserveSymlinks,
        ...config.optimizeDeps?.esbuildOptions
      }
    }
  }

    ; (resolved.plugins as Plugin[]) = await resolvePlugins(
      resolved,
      prePlugins,
      normalPlugins,
      postPlugins
    )

  // call configResolved hooks
  await Promise.all(userPlugins.map((p) => p.configResolved?.(resolved)))

  if (process.env.DEBUG) {
    debug(`using resolved config: %O`, {
      ...resolved,
      plugins: resolved.plugins.map((p) => p.name)
    })
  }

  // TODO Deprecation warnings - remove when out of beta

  const logDeprecationWarning = (
    deprecatedOption: string,
    hint: string,
    error?: Error
  ) => {
    logger.warn(
      colors.yellow(
        colors.bold(
          `(!) "${deprecatedOption}" option is deprecated. ${hint}${error ? `\n${error.stack}` : ''
          }`
        )
      )
    )
  }

  if (config.build?.base) {
    logDeprecationWarning(
      'build.base',
      '"base" is now a root-level config option.'
    )
    config.base = config.build.base
  }
  Object.defineProperty(resolvedBuildOptions, 'base', {
    enumerable: false,
    get() {
      logDeprecationWarning(
        'build.base',
        '"base" is now a root-level config option.',
        new Error()
      )
      return resolved.base
    }
  })

  if (config.alias) {
    logDeprecationWarning('alias', 'Use "resolve.alias" instead.')
  }
  Object.defineProperty(resolved, 'alias', {
    enumerable: false,
    get() {
      logDeprecationWarning(
        'alias',
        'Use "resolve.alias" instead.',
        new Error()
      )
      return resolved.resolve.alias
    }
  })

  if (config.dedupe) {
    logDeprecationWarning('dedupe', 'Use "resolve.dedupe" instead.')
  }
  Object.defineProperty(resolved, 'dedupe', {
    enumerable: false,
    get() {
      logDeprecationWarning(
        'dedupe',
        'Use "resolve.dedupe" instead.',
        new Error()
      )
      return resolved.resolve.dedupe
    }
  })

  if (config.optimizeDeps?.keepNames) {
    logDeprecationWarning(
      'optimizeDeps.keepNames',
      'Use "optimizeDeps.esbuildOptions.keepNames" instead.'
    )
  }
  Object.defineProperty(resolved.optimizeDeps, 'keepNames', {
    enumerable: false,
    get() {
      logDeprecationWarning(
        'optimizeDeps.keepNames',
        'Use "optimizeDeps.esbuildOptions.keepNames" instead.',
        new Error()
      )
      return resolved.optimizeDeps.esbuildOptions?.keepNames
    }
  })

  if (config.build?.polyfillDynamicImport) {
    logDeprecationWarning(
      'build.polyfillDynamicImport',
      '"polyfillDynamicImport" has been removed. Please use @vitejs/plugin-legacy if your target browsers do not support dynamic imports.'
    )
  }

  Object.defineProperty(resolvedBuildOptions, 'polyfillDynamicImport', {
    enumerable: false,
    get() {
      logDeprecationWarning(
        'build.polyfillDynamicImport',
        '"polyfillDynamicImport" has been removed. Please use @vitejs/plugin-legacy if your target browsers do not support dynamic imports.',
        new Error()
      )
      return false
    }
  })

  if (config.build?.cleanCssOptions) {
    logDeprecationWarning(
      'build.cleanCssOptions',
      'Vite now uses esbuild for CSS minification.'
    )
  }

  if (config.build?.terserOptions && config.build.minify === 'esbuild') {
    logger.warn(
      colors.yellow(
        `build.terserOptions is specified but build.minify is not set to use Terser. ` +
        `Note Vite now defaults to use esbuild for minification. If you still ` +
        `prefer Terser, set build.minify to "terser".`
      )
    )
  }

  return resolved
}

/**
 * Resolve base. Note that some users use Vite to build for non-web targets like
 * electron or expects to deploy
 */
function resolveBaseUrl(
  base: UserConfig['base'] = '/',
  isBuild: boolean,
  logger: Logger
): string {
  // #1669 special treatment for empty for same dir relative base
  if (base === '' || base === './') {
    return isBuild ? base : '/'
  }
  if (base.startsWith('.')) {
    logger.warn(
      colors.yellow(
        colors.bold(
          `(!) invalid "base" option: ${base}. The value can only be an absolute ` +
          `URL, ./, or an empty string.`
        )
      )
    )
    base = '/'
  }

  // external URL
  if (isExternalUrl(base)) {
    if (!isBuild) {
      // get base from full url during dev
      const parsed = parseUrl(base)
      base = parsed.pathname || '/'
    }
  } else {
    // ensure leading slash
    if (!base.startsWith('/')) {
      logger.warn(
        colors.yellow(
          colors.bold(`(!) "base" option should start with a slash.`)
        )
      )
      base = '/' + base
    }
  }

  // ensure ending slash
  if (!base.endsWith('/')) {
    logger.warn(
      colors.yellow(colors.bold(`(!) "base" option should end with a slash.`))
    )
    base += '/'
  }

  return base
}

function mergeConfigRecursively(
  defaults: Record<string, any>,
  overrides: Record<string, any>,
  rootPath: string
) {
  const merged: Record<string, any> = { ...defaults }
  for (const key in overrides) {
    const value = overrides[key]
    if (value == null) {
      continue
    }

    const existing = merged[key]
    if (Array.isArray(existing) && Array.isArray(value)) {
      merged[key] = [...existing, ...value]
      continue
    }
    if (isObject(existing) && isObject(value)) {
      merged[key] = mergeConfigRecursively(
        existing,
        value,
        rootPath ? `${rootPath}.${key}` : key
      )
      continue
    }

    // fields that require special handling
    if (existing != null) {
      if (key === 'alias' && (rootPath === 'resolve' || rootPath === '')) {
        merged[key] = mergeAlias(existing, value)
        continue
      } else if (key === 'assetsInclude' && rootPath === '') {
        merged[key] = [].concat(existing, value)
        continue
      } else if (key === 'noExternal' && existing === true) {
        continue
      }
    }

    merged[key] = value
  }
  return merged
}

/**
 * 合并配置文件
 * @param defaults 
 * @param overrides 
 * @param isRoot 
 * @returns 
 */
export function mergeConfig(
  defaults: Record<string, any>,
  overrides: Record<string, any>,
  isRoot = true
): Record<string, any> {
  return mergeConfigRecursively(defaults, overrides, isRoot ? '' : '.')
}

function mergeAlias(a: AliasOptions = [], b: AliasOptions = []): Alias[] {
  return [...normalizeAlias(a), ...normalizeAlias(b)]
}

function normalizeAlias(o: AliasOptions): Alias[] {
  return Array.isArray(o)
    ? o.map(normalizeSingleAlias)
    : Object.keys(o).map((find) =>
      normalizeSingleAlias({
        find,
        replacement: (o as any)[find]
      })
    )
}

// https://github.com/vitejs/vite/issues/1363
// work around https://github.com/rollup/plugins/issues/759
function normalizeSingleAlias({ find, replacement }: Alias): Alias {
  if (
    typeof find === 'string' &&
    find.endsWith('/') &&
    replacement.endsWith('/')
  ) {
    find = find.slice(0, find.length - 1)
    replacement = replacement.slice(0, replacement.length - 1)
  }
  return { find, replacement }
}

export function sortUserPlugins(
  plugins: (Plugin | Plugin[])[] | undefined
): [Plugin[], Plugin[], Plugin[]] {
  const prePlugins: Plugin[] = []
  const postPlugins: Plugin[] = []
  const normalPlugins: Plugin[] = []

  if (plugins) {
    plugins.flat().forEach((p) => {
      if (p.enforce === 'pre') prePlugins.push(p)
      else if (p.enforce === 'post') postPlugins.push(p)
      else normalPlugins.push(p)
    })
  }

  return [prePlugins, normalPlugins, postPlugins]
}

/**
 * 从文件加载配置文件
 * @param configEnv 
 * @param configFile 
 * @param configRoot 
 * @param logLevel 
 * @returns 
 */
export async function loadConfigFromFile(
  configEnv: ConfigEnv,
  configFile?: string,
  configRoot: string = process.cwd(),
  logLevel?: LogLevel
): Promise<{
  /** 配置文件的路径 */
  path: string
  /** 配置内容 */
  config: UserConfig
  /** 依赖列表 */
  dependencies: string[]
} | null> {
  const start = performance.now()
  const getTime = () => `${(performance.now() - start).toFixed(2)}ms`

  //配置文件的路径
  let resolvedPath: string | undefined
  let isTS = false
  let isESM = false
  let dependencies: string[] = []

  // check package.json for type: "module" and set `isMjs` to true
  // 这里只是为了判断项目是否是使用esm规范的模块
  try {
    const pkg = lookupFile(configRoot, ['package.json'])
    //判断是否使用的是esm的规范，如果不是module则默认使用CommonJs规范
    if (pkg && JSON.parse(pkg).type === 'module') {
      isESM = true
    }
  } catch (e) { }

  if (configFile) {
    // explicit config path is always resolved from cwd
    // 只用path.resolve方法就能获取一个绝对的路径，根本就不用通过判断是否是绝对路径再来拼接cwd的路径
    resolvedPath = path.resolve(configFile)
    //如果配置文件是ts结尾的则表示是ts项目
    isTS = configFile.endsWith('.ts')

    // 如果配置文件是.mjs结尾的就表示使用esm模块，因为node就是根据这个来判断是否是esm模块的
    if (configFile.endsWith('.mjs')) {
      isESM = true
    }
  } else {
    // implicit config file loaded from inline root (if present)
    // otherwise from cwd
    // 从当前项目路径下隐式配置文件
    // 最后会通过三种后缀去查找 .js .mjs .ts
    const jsconfigFile = path.resolve(configRoot, 'vite.config.js')

    if (fs.existsSync(jsconfigFile)) {
      resolvedPath = jsconfigFile
    }

    if (!resolvedPath) {
      const mjsconfigFile = path.resolve(configRoot, 'vite.config.mjs')
      if (fs.existsSync(mjsconfigFile)) {
        resolvedPath = mjsconfigFile
        isESM = true
      }
    }

    if (!resolvedPath) {
      const tsconfigFile = path.resolve(configRoot, 'vite.config.ts')
      if (fs.existsSync(tsconfigFile)) {
        resolvedPath = tsconfigFile
        isTS = true
      }
    }
  }

  //如果还没找到配置文件的路径的话就抛出异常
  if (!resolvedPath) {
    debug('no config file found.')
    return null
  }

  try {
    let userConfig: UserConfigExport | undefined

    // 如果配置文件是esm规范的话
    if (isESM) {
      //pathToFileURL确保path绝对解析，并且在转换为文件 URL 时正确编码 URL 控制字符。
      const fileUrl = require('url').pathToFileURL(resolvedPath)
      const bundled = await bundleConfigFile(resolvedPath, true)
      dependencies = bundled.dependencies
      if (isTS) {
        // before we can register loaders without requiring users to run node
        // with --experimental-loader themselves, we have to do a hack here:
        // bundle the config file w/ ts transforms first, write it to disk,
        // load it with native Node ESM, then delete the file.
        // 这里先生成.js的文件，然后加载，加载完了再删除
        fs.writeFileSync(resolvedPath + '.js', bundled.code)
        userConfig = (await dynamicImport(`${fileUrl}.js?t=${Date.now()}`))
          .default
        fs.unlinkSync(resolvedPath + '.js')
        //然后打印加载了目标配置的提示
        debug(`TS + native esm config loaded in ${getTime()}`, fileUrl)
      } else {
        // using Function to avoid this from being compiled away by TS/Rollup
        // append a query so that we force reload fresh config in case of
        // server restart
        userConfig = (await dynamicImport(`${fileUrl}?t=${Date.now()}`)).default
        debug(`native esm config loaded in ${getTime()}`, fileUrl)
      }
    }

    // 这里的处理很特殊，好像是处理不是.js.mjs.ts结尾的文件
    if (!userConfig) {
      // Bundle config file and transpile it to cjs using esbuild.
      const bundled = await bundleConfigFile(resolvedPath)
      dependencies = bundled.dependencies
      userConfig = await loadConfigFromBundledFile(resolvedPath, bundled.code)
      debug(`bundled config file loaded in ${getTime()}`)
    }

    //此时得到的userConfig是用户定义的，它可以是个异步或者同步的返回config的方法，也肯能直接是个config
    const config = await (typeof userConfig === 'function'
      ? userConfig(configEnv)
      : userConfig)

    //如果此时获取的config不是对象的话就报错
    if (!isObject(config)) {
      throw new Error(`config must export or return an object.`)
    }
    return {
      path: normalizePath(resolvedPath),
      config,
      dependencies
    }
  } catch (e) {
    createLogger(logLevel).error(
      colors.red(`failed to load config from ${resolvedPath}`),
      { error: e }
    )
    throw e
  }
}

/**
 * 打包配置文件信息，因为配置文件不一定是js写的，所有这里要打包一次
 * @param fileName 文件路径
 * @param isESM 是否是esm模块规范
 * @returns 
 */
async function bundleConfigFile(
  fileName: string,
  isESM = false
): Promise<{ code: string; dependencies: string[] }> {
  //用esbuild来解析配置文件，因为该配置文件也可能是ts写的
  const result = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [fileName],
    outfile: 'out.js',
    write: false,
    platform: 'node',
    bundle: true,
    format: isESM ? 'esm' : 'cjs',
    sourcemap: 'inline',
    metafile: true,
    plugins: [
      {
        name: 'externalize-deps',
        setup(build) {
          //esbuild 的这个回调会在filter指定的模块的每个导入路径上运行
          build.onResolve({ filter: /.*/ }, (args) => {
            const id = args.path
            // 如果path不是以.开头的，并且它不是一个绝对路径，则它是一个包
            if (id[0] !== '.' && !path.isAbsolute(id)) {
              return {
                // 将此设置true为将模块标记为external，这意味着它不会包含在包中，而是会在运行时导入。
                external: true
              }
            }
          })
        }
      },
      {
        //静态替换掉一些东西  
        name: 'replace-import-meta',
        setup(build) {
          build.onLoad({ filter: /\.[jt]s$/ }, async (args) => {
            const contents = await fs.promises.readFile(args.path, 'utf8')
            return {
              loader: args.path.endsWith('.ts') ? 'ts' : 'js',
              contents: contents
                //这里把import.meta.url替换成文件路径，只是为了做兼容处理
                .replace(
                  /\bimport\.meta\.url\b/g,
                  JSON.stringify(`file://${args.path}`)
                )
                .replace(
                  /\b__dirname\b/g,
                  JSON.stringify(path.dirname(args.path))
                )
                .replace(/\b__filename\b/g, JSON.stringify(args.path))
            }
          })
        }
      }
    ]
  })
  const { text } = result.outputFiles[0]
  return {
    code: text,
    //esbuild打包后的metafile中的inputs，应该是该文件的依赖列表
    dependencies: result.metafile ? Object.keys(result.metafile.inputs) : []
  }
}

interface NodeModuleWithCompile extends NodeModule {
  _compile(code: string, filename: string): any
}

/**
 * 从捆绑文件加载配置
 * @param fileName 
 * @param bundledCode 
 * @returns 
 */
async function loadConfigFromBundledFile(
  fileName: string,
  bundledCode: string
): Promise<UserConfig> {
  //扩展名
  const extension = path.extname(fileName)
  // require.extensions 指定require如何处理某些文件的扩展名，先获取原来的处理器
  const defaultLoader = require.extensions[extension]!
  // 再封装一下这个处理器
  require.extensions[extension] = (module: NodeModule, filename: string) => {
    if (filename === fileName) {
      ; (module as NodeModuleWithCompile)._compile(bundledCode, filename)
    } else {
      defaultLoader(module, filename)
    }
  }
  // clear cache in case of server restart
  delete require.cache[require.resolve(fileName)]
  const raw = require(fileName)
  const config = raw.__esModule ? raw.default : raw
  //在替换为原先的处理器
  require.extensions[extension] = defaultLoader
  return config
}

export function loadEnv(
  mode: string,
  envDir: string,
  prefixes: string | string[] = 'VITE_'
): Record<string, string> {
  if (mode === 'local') {
    throw new Error(
      `"local" cannot be used as a mode name because it conflicts with ` +
      `the .local postfix for .env files.`
    )
  }
  prefixes = arraify(prefixes)
  const env: Record<string, string> = {}
  const envFiles = [
    /** mode local file */ `.env.${mode}.local`,
    /** mode file */ `.env.${mode}`,
    /** local file */ `.env.local`,
    /** default file */ `.env`
  ]

  // check if there are actual env variables starting with VITE_*
  // these are typically provided inline and should be prioritized
  for (const key in process.env) {
    if (
      prefixes.some((prefix) => key.startsWith(prefix)) &&
      env[key] === undefined
    ) {
      env[key] = process.env[key] as string
    }
  }

  for (const file of envFiles) {
    const path = lookupFile(envDir, [file], true)
    if (path) {
      const parsed = dotenv.parse(fs.readFileSync(path), {
        debug: !!process.env.DEBUG || undefined
      })

      // let environment variables use each other
      dotenvExpand({
        parsed,
        // prevent process.env mutation
        ignoreProcessEnv: true
      } as any)

      // only keys that start with prefix are exposed to client
      for (const [key, value] of Object.entries(parsed)) {
        if (
          prefixes.some((prefix) => key.startsWith(prefix)) &&
          env[key] === undefined
        ) {
          env[key] = value
        } else if (key === 'NODE_ENV') {
          // NODE_ENV override in .env file
          process.env.VITE_USER_NODE_ENV = value
        }
      }
    }
  }
  return env
}

export function resolveEnvPrefix({
  envPrefix = 'VITE_'
}: UserConfig): string[] {
  envPrefix = arraify(envPrefix)
  if (envPrefix.some((prefix) => prefix === '')) {
    throw new Error(
      `envPrefix option contains value '', which could lead unexpected exposure of sensitive information.`
    )
  }
  return envPrefix
}
