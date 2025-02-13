/* eslint no-console: 0 */

import colors from 'picocolors'
import type { AddressInfo, Server } from 'net'
import os from 'os'
import readline from 'readline'
import type { RollupError } from 'rollup'
import type { ResolvedConfig } from '.'
import type { CommonServerOptions } from './http'
import type { Hostname } from './utils'
import { resolveHostname } from './utils'

export type LogType = 'error' | 'warn' | 'info'
export type LogLevel = LogType | 'silent'
export interface Logger {
  info(msg: string, options?: LogOptions): void
  warn(msg: string, options?: LogOptions): void
  /** 只打印一次的消息 */
  warnOnce(msg: string, options?: LogOptions): void
  error(msg: string, options?: LogErrorOptions): void
  clearScreen(type: LogType): void
  /** 是否打印过异常消息 */
  hasErrorLogged(error: Error | RollupError): boolean
  /** 已经发出警告 */
  hasWarned: boolean
}

export interface LogOptions {
  clear?: boolean
  timestamp?: boolean
}

export interface LogErrorOptions extends LogOptions {
  error?: Error | RollupError | null
}

export const LogLevels: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3
}

let lastType: LogType | undefined
let lastMsg: string | undefined
/** 相同计数 */
let sameCount = 0

/**
 * 清除屏幕的内容
 */
function clearScreen() {
  const repeatCount = process.stdout.rows - 2
  const blank = repeatCount > 0 ? '\n'.repeat(repeatCount) : ''
  console.log(blank)
  readline.cursorTo(process.stdout, 0, 0)
  readline.clearScreenDown(process.stdout)
}

export interface LoggerOptions {
  /** 前缀 */
  prefix?: string
  /** 允许清除屏幕，这个屏幕指的是终端的屏幕 */
  allowClearScreen?: boolean
  /** 自定义的logger */
  customLogger?: Logger
}

export function createLogger(
  level: LogLevel = 'info',
  options: LoggerOptions = {}
): Logger {

  // 如果有自定义的logger则直接返回自定义的logger
  if (options.customLogger) {
    return options.customLogger
  }

  // 弱引用的一个异常收集器
  const loggedErrors = new WeakSet<Error | RollupError>()

  const { prefix = '[vite]', allowClearScreen = true } = options

  const thresh = LogLevels[level]

  /** 是否能清屏 */
  /**
   * isTTY 表示这个流是否是tty模块的实例，它永远都是true，用来区分普通的可写流和tty模块的流
   * TODO env.CI 暂时不知道是啥东西
   */
  const canClearScreen =
    allowClearScreen && process.stdout.isTTY && !process.env.CI

  const clear = canClearScreen ? clearScreen : () => { }

  function output(type: LogType, msg: string, options: LogErrorOptions = {}) {
    // 必须当前当前配置的log等级大于当前log操作的等级才行，就相当于是个简单的权限验证
    if (thresh >= LogLevels[type]) {
      const method = type === 'info' ? 'log' : type
      const format = () => {
        //必须要有时间戳才给msg加颜色
        if (options.timestamp) {
          const tag =
            type === 'info'
              ? colors.cyan(colors.bold(prefix))
              : type === 'warn'
                ? colors.yellow(colors.bold(prefix))
                : colors.red(colors.bold(prefix))
          return `${colors.dim(new Date().toLocaleTimeString())} ${tag} ${msg}`
        } else {
          return msg
        }
      }

      // 如果有异常则加到异常列表中
      if (options.error) {
        loggedErrors.add(options.error)
      }

      //如果要清屏的话就先清屏，不然的话直接打印消息
      if (canClearScreen) {
        if (type === lastType && msg === lastMsg) {
          sameCount++
          clear()
          //会多打印这个消息的相同个数
          console[method](format(), colors.yellow(`(x${sameCount + 1})`))
        } else {
          //记录下当前的消息和消息类型，以便判断下一个消息是否是和上一个消息一样的
          sameCount = 0
          lastMsg = msg
          lastType = type
          //
          if (options.clear) {
            clear()
          }
          console[method](format())
        }
      } else {
        console[method](format())
      }
    }
  }

  const warnedMessages = new Set<string>()

  /** logger对象，实现logger接口就行 */
  const logger: Logger = {
    hasWarned: false,
    info(msg, opts) {
      output('info', msg, opts)
    },
    warn(msg, opts) {
      logger.hasWarned = true
      output('warn', msg, opts)
    },
    warnOnce(msg, opts) {
      if (warnedMessages.has(msg)) return
      logger.hasWarned = true
      output('warn', msg, opts)
      warnedMessages.add(msg)
    },
    error(msg, opts) {
      logger.hasWarned = true
      output('error', msg, opts)
    },
    clearScreen(type) {
      // 只有够权限的时候才清屏
      if (thresh >= LogLevels[type]) {
        clear()
      }
    },
    hasErrorLogged(error) {
      return loggedErrors.has(error)
    }
  }

  return logger
}

/**
 * @deprecated Use `server.printUrls()` instead
 */
export function printHttpServerUrls(
  server: Server,
  config: ResolvedConfig
): void {
  printCommonServerUrls(server, config.server, config)
}

export function printCommonServerUrls(
  server: Server,
  options: CommonServerOptions,
  config: ResolvedConfig
): void {
  const address = server.address()
  const isAddressInfo = (x: any): x is AddressInfo => x?.address
  if (isAddressInfo(address)) {
    const hostname = resolveHostname(options.host)
    const protocol = options.https ? 'https' : 'http'
    printServerUrls(
      hostname,
      protocol,
      address.port,
      config.base,
      config.logger.info
    )
  }
}

function printServerUrls(
  hostname: Hostname,
  protocol: string,
  port: number,
  base: string,
  info: Logger['info']
): void {
  if (hostname.host === '127.0.0.1') {
    const url = `${protocol}://${hostname.name}:${colors.bold(port)}${base}`
    info(`  > Local: ${colors.cyan(url)}`)
    if (hostname.name !== '127.0.0.1') {
      info(`  > Network: ${colors.dim('use `--host` to expose')}`)
    }
  } else {
    Object.values(os.networkInterfaces())
      .flatMap((nInterface) => nInterface ?? [])
      .filter((detail) => detail && detail.address && detail.family === 'IPv4')
      .map((detail) => {
        const type = detail.address.includes('127.0.0.1')
          ? 'Local:   '
          : 'Network: '
        const host = detail.address.replace('127.0.0.1', hostname.name)
        const url = `${protocol}://${host}:${colors.bold(port)}${base}`
        return `  > ${type} ${colors.cyan(url)}`
      })
      .forEach((msg) => info(msg))
  }
}
