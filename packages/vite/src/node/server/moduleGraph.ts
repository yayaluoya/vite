import { extname } from 'path'
import type { ModuleInfo, PartialResolvedId } from 'rollup'
import { parse as parseUrl } from 'url'
import { isDirectCSSRequest } from '../plugins/css'
import {
  cleanUrl,
  normalizePath,
  removeImportQuery,
  removeTimestampQuery
} from '../utils'
import { FS_PREFIX } from '../constants'
import type { TransformResult } from './transformRequest'

/**
 * 模块节点
 */
export class ModuleNode {
  /**
   * 公共服务url路径，以/开头
   * Public served url path, starts with /
   */
  url: string
  /**
   * 解析的文件系统路径+查询
   * Resolved file system path + query
   */
  id: string | null = null
  //文件路径
  file: string | null = null
  type: 'js' | 'css'
  /** 模块信息 */
  info?: ModuleInfo
  meta?: Record<string, any>
  /**
   * 注意：模块间的依赖关系是双向的，你导入了我，我就被你依赖了
   */
  /** 这里可以能是导入了该模块的模块 */
  importers = new Set<ModuleNode>()
  /** 导入的模块 */
  importedModules = new Set<ModuleNode>()
  /** 接受的Hmr Deps */
  acceptedHmrDeps = new Set<ModuleNode>()
  isSelfAccepting = false
  /** 转换结果，就是打包后的结果 */
  transformResult: TransformResult | null = null
  /** ssr转换结果 */
  ssrTransformResult: TransformResult | null = null
  /** ssr模块 */
  ssrModule: Record<string, any> | null = null
  /** 上次HMR时间戳 */
  lastHMRTimestamp = 0

  constructor(url: string) {
    this.url = url
    /** 获取类型 */
    this.type = isDirectCSSRequest(url) ? 'css' : 'js'
  }
}

/**
 * 使SSR模块无效
 * @param mod 目标模块
 * @param seen 
 * @returns 
 */
function invalidateSSRModule(mod: ModuleNode, seen: Set<ModuleNode>) {
  if (seen.has(mod)) {
    return
  }
  seen.add(mod)
  mod.ssrModule = null
  mod.importers.forEach((importer) => invalidateSSRModule(importer, seen))
}

/**
 * 解析的Url
 */
export type ResolvedUrl = [
  url: string,
  resolvedId: string,
  meta: object | null | undefined
]

/**
 * 模块图
 * 这个类实例就是用来管理模块的
 */
export class ModuleGraph {
  /** url映射的模块 */
  urlToModuleMap = new Map<string, ModuleNode>()
  /** id映射的模块 */
  idToModuleMap = new Map<string, ModuleNode>()
  // a single file may corresponds to multiple modules with different queries
  /** 文件映射的模块，单个文件可以对应于具有不同查询的多个模块 */
  fileToModulesMap = new Map<string, Set<ModuleNode>>()
  /** 安全模块路径 */
  safeModulesPath = new Set<string>()

  constructor(
    private resolveId: (
      url: string,
      ssr: boolean
    ) => Promise<PartialResolvedId | null>
  ) { }

  /**
   * 通过路径获取模块
   * @param rawUrl 
   * @param ssr 
   * @returns 
   */
  async getModuleByUrl(
    rawUrl: string,
    ssr?: boolean
  ): Promise<ModuleNode | undefined> {
    const [url] = await this.resolveUrl(rawUrl, ssr)
    return this.urlToModuleMap.get(url)
  }

  /**
   * 通过模块id获取模块
   * @param id 
   * @returns 
   */
  getModuleById(id: string): ModuleNode | undefined {
    return this.idToModuleMap.get(removeTimestampQuery(id))
  }

  /**
   * 通过文件名获取模块
   * @param file 
   * @returns 
   */
  getModulesByFile(file: string): Set<ModuleNode> | undefined {
    return this.fileToModulesMap.get(file)
  }

  /**
   * 文件更改时
   * @param file 
   */
  onFileChange(file: string): void {
    const mods = this.getModulesByFile(file)
    if (mods) {
      const seen = new Set<ModuleNode>()
      mods.forEach((mod) => {
        this.invalidateModule(mod, seen)
      })
    }
  }

  /**
   * 使模块无效
   * @param mod 
   * @param seen 
   */
  invalidateModule(mod: ModuleNode, seen: Set<ModuleNode> = new Set()): void {
    mod.info = undefined
    mod.transformResult = null
    mod.ssrTransformResult = null
    invalidateSSRModule(mod, seen)
  }

  /**
   * 全部模块无效
   */
  invalidateAll(): void {
    const seen = new Set<ModuleNode>()
    this.idToModuleMap.forEach((mod) => {
      this.invalidateModule(mod, seen)
    })
  }

  /**
   * 根据模块的更新导入信息更新模块图
  *如果存在不再有任何导入程序的依赖项，它们是
  *作为一套返回。
   * Update the module graph based on a module's updated imports information
   * If there are dependencies that no longer have any importers, they are
   * returned as a Set.
   */
  async updateModuleInfo(
    /** 目标模块 */
    mod: ModuleNode,
    /** 导入的模块 */
    importedModules: Set<string | ModuleNode>,
    /** 接受的模块 */
    acceptedModules: Set<string | ModuleNode>,
    isSelfAccepting: boolean,
    ssr?: boolean
  ): Promise<Set<ModuleNode> | undefined> {
    mod.isSelfAccepting = isSelfAccepting
    //上一个
    const prevImports = mod.importedModules
    //下一个，这里重置了下 mod.importedModules
    const nextImports = (mod.importedModules = new Set())
    //不在导入的依赖项
    let noLongerImported: Set<ModuleNode> | undefined
    // update import graph
    for (const imported of importedModules) {
      const dep =
        typeof imported === 'string'
          ? await this.ensureEntryFromUrl(imported, ssr)
          : imported
      //这里可以证明这个importers是存的导入了该模块的模块
      dep.importers.add(mod)
      //重新添加到依赖的模块中
      nextImports.add(dep)
    }
    // remove the importer from deps that were imported but no longer are.
    //从已导入但不再存在的dep中删除导入程序
    prevImports.forEach((dep) => {
      //如果不存在于新生成的导入set中
      if (!nextImports.has(dep)) {
        //删除目标模块的模块依赖列表中的当前模块
        dep.importers.delete(mod)
        if (!dep.importers.size) {
          // dependency no longer imported
          ; (noLongerImported || (noLongerImported = new Set())).add(dep)
        }
      }
    })
    // update accepted hmr deps
    // 更新接受的hmr部门
    const deps = (mod.acceptedHmrDeps = new Set())
    for (const accepted of acceptedModules) {
      const dep =
        typeof accepted === 'string'
          ? await this.ensureEntryFromUrl(accepted, ssr)
          : accepted
      deps.add(dep)
    }

    //返回不在导入的依赖项
    return noLongerImported
  }

  /**
   * 确保从url进入
   * 就是通过一个url生成一个模块
   */
  async ensureEntryFromUrl(rawUrl: string, ssr?: boolean): Promise<ModuleNode> {
    const [url, resolvedId, meta] = await this.resolveUrl(rawUrl, ssr)
    //在缓存的url模块映射列表中找目标模块，如果找不到的话在实例化一个新的，同时加入到缓存中
    let mod = this.urlToModuleMap.get(url)
    if (!mod) {
      mod = new ModuleNode(url)
      if (meta) mod.meta = meta
      //加入到url模块映射缓存中
      this.urlToModuleMap.set(url, mod)
      mod.id = resolvedId
      //加入到id模块映射缓存中
      this.idToModuleMap.set(resolvedId, mod)
      //文件路径 一个剔除掉哈希值和query值的干净路径字符串
      const file = (mod.file = cleanUrl(resolvedId))
      //从文件模块映射中找对应的模块映射
      let fileMappedModules = this.fileToModulesMap.get(file)
      if (!fileMappedModules) {
        fileMappedModules = new Set()
        this.fileToModulesMap.set(file, fileMappedModules)
      }
      fileMappedModules.add(mod)
    }
    return mod
  }

  // some deps, like a css file referenced via @import, don't have its own
  // url because they are inlined into the main css import. But they still
  // need to be represented in the module graph so that they can trigger
  // hmr in the importing css file.
  // 有些dep，比如通过@import引用的css文件，没有自己的dep
  // url，因为它们被内联到主css导入中。但是他们仍然
  //需要在模块图中表示，以便它们可以触发
  //导入css文件中的hmr
  //创建仅文件条目
  createFileOnlyEntry(file: string): ModuleNode {
    file = normalizePath(file)
    let fileMappedModules = this.fileToModulesMap.get(file)
    if (!fileMappedModules) {
      fileMappedModules = new Set()
      this.fileToModulesMap.set(file, fileMappedModules)
    }

    const url = `${FS_PREFIX}${file}`
    for (const m of fileMappedModules) {
      if (m.url === url || m.id === file) {
        return m
      }
    }

    const mod = new ModuleNode(url)
    mod.file = file
    fileMappedModules.add(mod)
    return mod
  }

  // 对于传入的URL，重要的是:
  // 1.移除HMR时间戳查询(？t=xxxx)
  // 2.解析其扩展名，以便带或不带扩展名的URL都映射到
  //相同的模块
  // for incoming urls, it is important to:
  // 1. remove the HMR timestamp query (?t=xxxx)
  // 2. resolve its extension so that urls with or without extension all map to
  // the same module
  async resolveUrl(url: string, ssr?: boolean): Promise<ResolvedUrl> {
    url = removeImportQuery(removeTimestampQuery(url))
    //调用外部传入的解析id的方法解析出id
    const resolved = await this.resolveId(url, !!ssr)
    const resolvedId = resolved?.id || url
    const ext = extname(cleanUrl(resolvedId))
    const { pathname, search, hash } = parseUrl(url)
    if (ext && !pathname!.endsWith(ext)) {
      url = pathname + ext + (search || '') + (hash || '')
    }
    return [url, resolvedId, resolved?.meta]
  }
}
