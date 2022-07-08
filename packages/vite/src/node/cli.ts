import { cac } from 'cac'
import colors from 'picocolors'
import { performance } from 'perf_hooks'
import type { BuildOptions } from './build'
import type { ServerOptions } from './server'
import type { LogLevel } from './logger'
import { createLogger } from './logger'
import { resolveConfig } from '.'
import { preview } from './preview'

/**
 * vite 通过bin进来的入口
 * 同时在bin中注入了一些东西到 global 和 process.env 中
 */

/** 一个命令行参数处理工具 */
const cli = cac('vite')

// global options
interface GlobalCLIOptions {
  '--'?: string[]
  c?: boolean | string
  config?: string
  base?: string
  l?: LogLevel
  logLevel?: LogLevel
  clearScreen?: boolean
  d?: boolean | string
  debug?: boolean | string
  f?: string
  filter?: string
  m?: string
  mode?: string
}

/**
 * removing global flags before passing as command specific sub-configs
 * 就是删除op上GlobalCLIOptions的配置，返回多出的那些东西
 */
function cleanOptions<Options extends GlobalCLIOptions>(
  options: Options
): Omit<Options, keyof GlobalCLIOptions> {
  const ret = { ...options }
  delete ret['--']
  delete ret.c
  delete ret.config
  delete ret.base
  delete ret.l
  delete ret.logLevel
  delete ret.clearScreen
  delete ret.d
  delete ret.debug
  delete ret.f
  delete ret.filter
  delete ret.m
  delete ret.mode
  return ret
}

cli
  .option('-c, --config <file>', `[string] use specified config file 使用指定的配置文件`)
  .option('--base <path>', `[string] public base path (default: /) 公共基路径`)
  .option('-l, --logLevel <level>', `[string] info | warn | error | silent`)
  .option('--clearScreen', `[boolean] allow/disable clear screen when logging`)
  .option('-d, --debug [feat]', `[string | boolean] show debug logs 显示调试日志`)
  .option('-f, --filter <filter>', `[string] filter debug logs 过滤调试日志`)
  .option('-m, --mode <mode>', `[string] set env mode 设定环境模式`)

// dev
cli
  .command('[root]') // default command 默认命令
  .alias('serve') // the command is called 'serve' in Vite's API
  .alias('dev') // alias to align with the script name
  .option('--host [host]', `[string] specify hostname 指定主机名`)
  .option('--port <port>', `[number] specify port 指定端口`)
  .option('--https', `[boolean] use TLS + HTTP/2 使用TLS + HTTP/2`)
  .option('--open [path]', `[boolean | string] open browser on startup 启动时打开浏览器`)
  .option('--cors', `[boolean] enable CORS 启用CORS`)
  .option('--strictPort', `[boolean] exit if specified port is already in use 如果指定的端口已被使用，则退出`)
  .option(
    '--force',
    `[boolean] force the optimizer to ignore the cache and re-bundle 强制优化器忽略缓存并重新绑定`
  )
  //开始 root 为这个命令的值 options 为选项和选项对应的值
  .action(async (root: string, options: ServerOptions & GlobalCLIOptions) => {
    // output structure is preserved even after bundling so require()
    // is ok here
    const { createServer } = await import('./server')
    try {
      //创建server 把命令行的选项传入server启动函数里面
      const server = await createServer({
        //
        root,
        base: options.base,
        mode: options.mode,
        //注意这里换了个名字
        configFile: options.config,
        logLevel: options.logLevel,
        clearScreen: options.clearScreen,
        //清除掉一些不必要的选项
        server: cleanOptions(options)
      })

      //如果找不到服务的话就抛出异常
      if (!server.httpServer) {
        throw new Error('HTTP server not available')
      }

      //开始监听
      await server.listen()

      const info = server.config.logger.info

      info(
        colors.cyan(`\n  vite v${require('vite/package.json').version}`) +
        colors.green(` dev server running at:\n`),
        {
          clear: !server.config.logger.hasWarned
        }
      )

      server.printUrls()

      // @ts-ignore
      if (global.__vite_start_time) {
        // @ts-ignore
        const startupDuration = performance.now() - global.__vite_start_time
        info(
          `\n  ${colors.cyan(`ready in ${Math.ceil(startupDuration)}ms.`)}\n`
        )
      }
    } catch (e) {
      createLogger(options.logLevel).error(
        colors.red(`error when starting dev server:\n${e.stack}`),
        { error: e }
      )
      process.exit(1)
    }
  })

// build
cli
  .command('build [root]')
  .option('--target <target>', `[string] transpile target (default: 'modules')`)
  .option('--outDir <dir>', `[string] output directory (default: dist)`)
  .option(
    '--assetsDir <dir>',
    `[string] directory under outDir to place assets in (default: _assets)`
  )
  .option(
    '--assetsInlineLimit <number>',
    `[number] static asset base64 inline threshold in bytes (default: 4096)`
  )
  .option(
    '--ssr [entry]',
    `[string] build specified entry for server-side rendering`
  )
  .option(
    '--sourcemap',
    `[boolean] output source maps for build (default: false)`
  )
  .option(
    '--minify [minifier]',
    `[boolean | "terser" | "esbuild"] enable/disable minification, ` +
    `or specify minifier to use (default: esbuild)`
  )
  .option('--manifest', `[boolean] emit build manifest json`)
  .option('--ssrManifest', `[boolean] emit ssr manifest json`)
  .option(
    '--emptyOutDir',
    `[boolean] force empty outDir when it's outside of root`
  )
  .option('-w, --watch', `[boolean] rebuilds when modules have changed on disk`)
  .action(async (root: string, options: BuildOptions & GlobalCLIOptions) => {
    const { build } = await import('./build')
    const buildOptions: BuildOptions = cleanOptions(options)

    try {
      await build({
        root,
        base: options.base,
        mode: options.mode,
        configFile: options.config,
        logLevel: options.logLevel,
        clearScreen: options.clearScreen,
        build: buildOptions
      })
    } catch (e) {
      createLogger(options.logLevel).error(
        colors.red(`error during build:\n${e.stack}`),
        { error: e }
      )
      process.exit(1)
    }
  })

// optimize
cli
  .command('optimize [root]')
  .option(
    '--force',
    `[boolean] force the optimizer to ignore the cache and re-bundle`
  )
  .action(
    async (root: string, options: { force?: boolean } & GlobalCLIOptions) => {
      const { optimizeDeps } = await import('./optimizer')
      try {
        const config = await resolveConfig(
          {
            root,
            base: options.base,
            configFile: options.config,
            logLevel: options.logLevel
          },
          'build',
          'development'
        )
        await optimizeDeps(config, options.force, true)
      } catch (e) {
        createLogger(options.logLevel).error(
          colors.red(`error when optimizing deps:\n${e.stack}`),
          { error: e }
        )
        process.exit(1)
      }
    }
  )

cli
  .command('preview [root]')
  .option('--host [host]', `[string] specify hostname`)
  .option('--port <port>', `[number] specify port`)
  .option('--strictPort', `[boolean] exit if specified port is already in use`)
  .option('--https', `[boolean] use TLS + HTTP/2`)
  .option('--open [path]', `[boolean | string] open browser on startup`)
  .action(
    async (
      root: string,
      options: {
        host?: string | boolean
        port?: number
        https?: boolean
        open?: boolean | string
        strictPort?: boolean
      } & GlobalCLIOptions
    ) => {
      try {
        const server = await preview({
          root,
          base: options.base,
          configFile: options.config,
          logLevel: options.logLevel,
          preview: {
            port: options.port,
            strictPort: options.strictPort,
            host: options.host,
            https: options.https,
            open: options.open
          }
        })
        server.printUrls()
      } catch (e) {
        createLogger(options.logLevel).error(
          colors.red(`error when starting preview server:\n${e.stack}`),
          { error: e }
        )
        process.exit(1)
      }
    }
  )

cli.help()
cli.version(require('../../package.json').version)

cli.parse()
