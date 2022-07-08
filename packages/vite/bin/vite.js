#!/usr/bin/env node
const { performance } = require('perf_hooks')

//TODO 这里的意思这个文件不是放到node_modules文件夹里面的，而是直接在外部引用的
if (!__dirname.includes('node_modules')) {
  try {
    // only available as dev dependency #仅作为开发依赖项提供
    require('source-map-support').install()
  } catch (e) { }
}

//全局注入一个vite的开始时间
//TODO 全局变量
global.__vite_start_time = performance.now()

// check debug mode first before requiring the CLI. # check debug mode first before requiring the CLI.
// process.argv 是指在命令行执行时带的参数，是个数组
const debugIndex = process.argv.findIndex((arg) => /^(?:-d|--debug)$/.test(arg)) // 调试
const filterIndex = process.argv.findIndex((arg) =>
  /^(?:-f|--filter)$/.test(arg)
)// 过滤器
const profileIndex = process.argv.indexOf('--profile') // 概况

if (debugIndex > 0) {
  let value = process.argv[debugIndex + 1]
  if (!value || value.startsWith('-')) {
    value = 'vite:*'
  } else {
    // support debugging multiple flags with comma-separated list
    value = value
      .split(',')
      .map((v) => `vite:${v}`)
      .join(',')
  }

  //到这里value的值就可能是 vite:* 或者 vite:a,vite:b,vite:c

  //吧调试的值注入到全局变量变量里
  //TODO 全局变量
  process.env.DEBUG = value

  //这里说明只有在有debug参数的时候才会去处理filter的参数值
  if (filterIndex > 0) {
    const filter = process.argv[filterIndex + 1]
    if (filter && !filter.startsWith('-')) {
      //把过滤器的值注入到全局变量里面
      //TODO 全局变量
      process.env.VITE_DEBUG_FILTER = filter
    }
  }
}

/** 开始vite的项目 */
function start() {
  console.log('vite开始了');
  require('../dist/node/cli')
}

//
if (profileIndex > 0) {
  process.argv.splice(profileIndex, 1)
  const next = process.argv[profileIndex]
  if (next && !next.startsWith('-')) {
    process.argv.splice(profileIndex, 1)
  }
  // node的一个调试工具，可以实现在浏览器调试node的代码
  const inspector = require('inspector')
  //TODO 全局变量
  const session = (global.__vite_profile_session = new inspector.Session())
  session.connect()
  session.post('Profiler.enable', () => {
    session.post('Profiler.start', start)
  })
} else {
  start()
}
