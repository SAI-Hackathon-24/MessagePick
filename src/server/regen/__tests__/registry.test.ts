/**
 * MOD-008 模板库（mod-008 §3.3 / §8 决策 3；§7.3 性能基线）。
 *
 * 断言口径：
 * - 加载：元数据保真、顺序稳定、按标识查询（不在清单 → undefined，交调用方落 `INVALID_INPUT`）；
 * - 校验：启动期报错、不静默降级（标识唯一 / 槽位矩形在画布内 / 引用素材存在 / tiers 非空 / 版本合法）；
 * - 读取期纵深防御：内置素材路径不能越出模板库目录；
 * - 性能：模板库加载 < 100 ms（§7.3）。
 *
 * 夹具一律在临时目录构造（不碰打包资源与真实应用数据）；模板库资源本体尚未随实现落盘
 * （见本轮报告），默认目录只做形态断言。
 */

import { isAbsolute, basename } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  TemplateLibraryError,
  builtinAssetRefs,
  createTemplateRegistry,
  defaultTemplatesDir,
  relativeToTemplates,
} from '../render/registry'
import { PNG_HEADER, TemplateFixture, templateEntry } from './harness'

const fixtures: TemplateFixture[] = []

/** 登记夹具，测试结束统一清理（临时目录）。 */
function fixture(): TemplateFixture {
  const created = new TemplateFixture()
  fixtures.push(created)
  return created
}

/** 单模板 + 单个内置素材的最小库。 */
function library(overrides: Record<string, unknown> = {}): TemplateFixture {
  const created = fixture()
  created.writeAsset('assets/base.png')
  created.writeManifest({ templates: [templateEntry({ builtinAssets: ['assets/base.png'], ...overrides })] })
  return created
}

/** 断言加载抛出 `TemplateLibraryError` 并返回该错误。 */
function loadError(dir: string): TemplateLibraryError {
  try {
    createTemplateRegistry({ dir })
  } catch (error) {
    if (error instanceof TemplateLibraryError) return error
    throw error
  }
  throw new Error('期望抛出 TemplateLibraryError，但模板库加载成功')
}

afterEach(() => {
  for (const created of fixtures.splice(0)) created.dispose()
})

describe('模板库加载与查询（§3.3 / §8 决策 3）', () => {
  it('加载合法清单：顺序稳定、字段保真、未知标识返回 undefined', () => {
    const created = fixture()
    created.writeAsset('assets/base.png')
    created.writeAsset('assets/alt.png', new Uint8Array([1, 2, 3]))
    created.writeManifest({
      templates: [
        templateEntry({ id: 'tpl-a', name: '甲模板', builtinAssets: ['assets/base.png'] }),
        templateEntry({
          id: 'tpl-b',
          version: 2,
          name: '乙模板',
          tiers: ['参考群内图片', '改编热门表情包', '纯模板生成'],
          builtinAssets: ['assets/alt.png'],
        }),
      ],
    })

    const registry = createTemplateRegistry({ dir: created.dir })
    expect(registry.list().map((template) => template.id)).toEqual(['tpl-a', 'tpl-b'])
    expect(registry.get('tpl-a')?.name).toBe('甲模板')
    expect(registry.get('tpl-b')?.version).toBe(2)
    expect(registry.get('tpl-b')?.tiers).toEqual(['参考群内图片', '改编热门表情包', '纯模板生成'])
    expect(registry.get('tpl-missing')).toBeUndefined()
    expect(registry.dir).toBe(created.dir)
  })

  it('元数据保真：文本槽 / 媒体槽 / 字体权重 / 内置素材逐字段保留', () => {
    const created = fixture()
    created.writeAsset('assets/base.png')
    const entry = {
      id: 'tpl-adv',
      version: 3,
      name: '进阶模板',
      tiers: ['参考群内图片', '改编热门表情包', '纯模板生成'],
      size: { w: 600, h: 480 },
      textSlots: [
        {
          id: 'caption',
          box: { x: 0, y: 0, w: 600, h: 100 },
          font: { family: 'sans', sizePx: 32, weight: 700 },
          maxLines: 3,
          align: 'left',
        },
      ],
      mediaSlots: [
        {
          id: 'avatar',
          box: { x: 20, y: 120, w: 200, h: 200 },
          shape: 'circle',
          required: true,
          sources: ['memberAvatar', 'memberPhoto'],
          memberBound: true,
        },
      ],
      builtinAssets: ['assets/base.png'],
    }
    created.writeManifest({ templates: [entry] })

    const registry = createTemplateRegistry({ dir: created.dir })
    expect(registry.get('tpl-adv')).toEqual(entry)
  })

  it('内置素材字节原样读回；MIME 按扩展名映射、未知为 application/octet-stream', () => {
    const created = library()
    const registry = createTemplateRegistry({ dir: created.dir })

    expect(Array.from(registry.assetBytes('assets/base.png'))).toEqual(Array.from(PNG_HEADER))
    expect(registry.assetMime('assets/base.png')).toBe('image/png')
    expect(registry.assetMime('a.jpg')).toBe('image/jpeg')
    expect(registry.assetMime('a.jpeg')).toBe('image/jpeg')
    expect(registry.assetMime('a.gif')).toBe('image/gif')
    expect(registry.assetMime('a.webp')).toBe('image/webp')
    expect(registry.assetMime('a.bin')).toBe('application/octet-stream')
    expect(registry.assetMime('no-extension')).toBe('application/octet-stream')
  })

  it('支持自定义清单文件名；槽位标识在模板之间互不冲突（按模板命名空间）', () => {
    const created = fixture()
    created.writeManifest({ templates: [templateEntry({ id: 't1' }), templateEntry({ id: 't2' })] }, 'templates.json')
    const registry = createTemplateRegistry({ dir: created.dir, manifestFile: 'templates.json' })
    expect(registry.list().map((template) => template.id)).toEqual(['t1', 't2'])
  })

  it('builtinAssetRefs / relativeToTemplates 暴露只读素材路径', () => {
    const created = library()
    const registry = createTemplateRegistry({ dir: created.dir })
    const template = registry.get('tpl-basic')
    expect(template).toBeDefined()
    expect(builtinAssetRefs(template!)).toEqual(['assets/base.png'])
    expect(relativeToTemplates(created.dir, 'assets/base.png')).toBe('assets/base.png')
  })

  it('合法边界值：画布恰好 1080、槽位恰好贴边允许加载', () => {
    const created = fixture()
    created.writeManifest({
      templates: [
        templateEntry({
          size: { w: 1080, h: 1080 },
          textSlots: [
            {
              id: 's',
              box: { x: 800, y: 0, w: 280, h: 60 },
              font: { family: 'sans', sizePx: 24 },
              maxLines: 1,
              align: 'left',
            },
          ],
        }),
      ],
    })
    expect(createTemplateRegistry({ dir: created.dir }).list()).toHaveLength(1)
  })
})

describe('清单级校验失败（启动期报错，不静默降级；§3.3）', () => {
  it('目录无清单 → 拒绝；非法 JSON → 拒绝', () => {
    const missing = fixture()
    expect(loadError(missing.dir).reasons.join('；')).toContain('模板清单不存在')

    const broken = fixture()
    broken.writeManifest('{ not json')
    expect(loadError(broken.dir).reasons.join('；')).toContain('不是合法 JSON')
  })

  it('根结构非法 / templates 非数组 / 空清单 → 拒绝', () => {
    const arrayRoot = fixture()
    arrayRoot.writeManifest([])
    expect(loadError(arrayRoot.dir).reasons.join('；')).toContain('结构非法')

    const notArray = fixture()
    notArray.writeManifest({ templates: 'nope' })
    expect(loadError(notArray.dir).reasons.join('；')).toContain('结构非法')

    const empty = fixture()
    empty.writeManifest({ templates: [] })
    expect(loadError(empty.dir).reasons.join('；')).toContain('模板清单为空')
  })

  it('模板标识重复 → 拒绝加载', () => {
    const created = fixture()
    created.writeManifest({ templates: [templateEntry(), templateEntry()] })
    expect(loadError(created.dir).reasons.some((reason) => reason.includes('重复'))).toBe(true)
  })

  it('部分模板非法 → 整体加载失败（valid + invalid 不静默跳过）', () => {
    const created = fixture()
    created.writeManifest({ templates: [templateEntry(), templateEntry({ id: 'bad', version: 0 })] })
    const error = loadError(created.dir)
    expect(error.reasons.some((reason) => reason.includes('version 应为正整数'))).toBe(true)
  })

  it('模板条目非对象 → 拒绝；错误对象带目录与全部失败原因（可排障）', () => {
    const created = fixture()
    created.writeManifest({ templates: ['nope'] })
    const error = loadError(created.dir)
    expect(error.reasons.join('；')).toContain('不是对象')
    expect(error.message).toContain(created.dir)
    expect(error.name).toBe('TemplateLibraryError')
  })
})

describe('单条目字段校验（逐项；§3.3 启动校验口径）', () => {
  interface InvalidCase {
    name: string
    mutate: (template: Record<string, unknown>) => void
    reason: string
  }

  const textSlot = (template: Record<string, unknown>): Record<string, unknown> =>
    (template.textSlots as Record<string, unknown>[])[0]!

  const mediaSlotEntry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'photo',
    box: { x: 20, y: 120, w: 100, h: 100 },
    shape: 'rect',
    required: false,
    sources: ['memberPhoto'],
    memberBound: true,
    ...overrides,
  })

  const invalidCases: InvalidCase[] = [
    {
      name: '标识为空串',
      mutate: (template) => { template.id = '' },
      reason: 'id 应为非空字符串',
    },
    {
      name: '版本为 0',
      mutate: (template) => { template.version = 0 },
      reason: 'version 应为正整数',
    },
    {
      name: '版本为小数',
      mutate: (template) => { template.version = 1.5 },
      reason: 'version 应为正整数',
    },
    {
      name: '名称为空白',
      mutate: (template) => { template.name = '   ' },
      reason: 'name 应为非空字符串',
    },
    {
      name: '档位为空数组',
      mutate: (template) => { template.tiers = [] },
      reason: 'tiers 应为非空数组',
    },
    {
      name: '档位含闭集外取值',
      mutate: (template) => { template.tiers = ['热门'] },
      reason: '含非法档位值',
    },
    {
      name: '画布尺寸非对象',
      mutate: (template) => { template.size = 300 },
      reason: 'size 应为 { w, h }',
    },
    {
      name: '画布宽高非正整数',
      mutate: (template) => { template.size = { w: 0, h: 300 } },
      reason: 'size.w 应为正整数',
    },
    {
      name: '画布超过 1080 上限',
      mutate: (template) => { template.size = { w: 1081, h: 300 } },
      reason: '超过单张画布上限',
    },
    {
      name: 'textSlots 非数组',
      mutate: (template) => { template.textSlots = 'nope' },
      reason: 'textSlots 应为数组',
    },
    {
      name: '文本槽非对象',
      mutate: (template) => { template.textSlots = ['nope'] },
      reason: '不是对象',
    },
    {
      name: '文本槽 box 非对象',
      mutate: (template) => { textSlot(template).box = 'box' },
      reason: 'box 应为 { x, y, w, h }',
    },
    {
      name: '文本槽坐标为负',
      mutate: (template) => { textSlot(template).box = { x: -1, y: 10, w: 280, h: 60 } },
      reason: '应为非负整数',
    },
    {
      name: '文本槽宽为 0',
      mutate: (template) => { textSlot(template).box = { x: 10, y: 10, w: 0, h: 60 } },
      reason: '宽高必须为正',
    },
    {
      name: '文本槽越出画布',
      mutate: (template) => { textSlot(template).box = { x: 290, y: 10, w: 30, h: 60 } },
      reason: '越出画布',
    },
    {
      name: '文本槽字体非对象',
      mutate: (template) => { textSlot(template).font = 'sans' },
      reason: 'font 应为 { family, sizePx }',
    },
    {
      name: '文本槽字体缺尺寸',
      mutate: (template) => { textSlot(template).font = { family: 'sans' } },
      reason: 'font.sizePx 应为正整数',
    },
    {
      name: '文本槽行数上限为 0',
      mutate: (template) => { textSlot(template).maxLines = 0 },
      reason: 'maxLines 应为正整数',
    },
    {
      name: '文本槽对齐方式非法',
      mutate: (template) => { textSlot(template).align = 'right' },
      reason: 'align 应为 left / center',
    },
    {
      name: '文本槽标识重复（同一模板内）',
      mutate: (template) => { template.textSlots = [textSlot(template), { ...textSlot(template) }] },
      reason: '与既有槽位重复',
    },
    {
      name: '媒体槽标识与文本槽重复',
      mutate: (template) => { template.mediaSlots = [mediaSlotEntry({ id: 'caption' })] },
      reason: '与既有槽位重复',
    },
    {
      name: '媒体槽形状非法',
      mutate: (template) => { template.mediaSlots = [mediaSlotEntry({ shape: 'oval' })] },
      reason: 'shape 应为 rect / circle',
    },
    {
      name: '媒体槽 required 非布尔',
      mutate: (template) => { template.mediaSlots = [mediaSlotEntry({ required: 'yes' })] },
      reason: 'required 应为布尔',
    },
    {
      name: '媒体槽 memberBound 缺失',
      mutate: (template) => { template.mediaSlots = [mediaSlotEntry({ memberBound: undefined })] },
      reason: 'memberBound 应为布尔',
    },
    {
      name: '媒体槽 sources 为空数组',
      mutate: (template) => { template.mediaSlots = [mediaSlotEntry({ sources: [] })] },
      reason: 'sources 应为非空数组',
    },
    {
      name: '媒体槽 sources 含未知素材类别',
      mutate: (template) => { template.mediaSlots = [mediaSlotEntry({ sources: ['wechatSticker'] })] },
      reason: '含未知素材类别',
    },
    {
      name: '媒体槽越出画布',
      mutate: (template) => { template.mediaSlots = [mediaSlotEntry({ box: { x: 200, y: 120, w: 200, h: 200 } })] },
      reason: '越出画布',
    },
    {
      name: 'mediaSlots 非数组',
      mutate: (template) => { template.mediaSlots = 'nope' },
      reason: 'mediaSlots 应为数组',
    },
    {
      name: 'builtinAssets 非数组',
      mutate: (template) => { template.builtinAssets = 'assets/base.png' },
      reason: 'builtinAssets 应为数组',
    },
    {
      name: 'builtinAssets 条目非字符串',
      mutate: (template) => { template.builtinAssets = [123] },
      reason: 'builtinAssets[0] 应为非空字符串',
    },
    {
      name: 'builtinAssets 引用绝对路径',
      mutate: (template) => { template.builtinAssets = ['/etc/passwd'] },
      reason: '必须是模板库目录内的相对路径',
    },
    {
      name: 'builtinAssets 引用越出目录',
      mutate: (template) => { template.builtinAssets = ['../outside.png'] },
      reason: '必须是模板库目录内的相对路径',
    },
    {
      name: 'builtinAssets 引用的素材不存在',
      mutate: (template) => { template.builtinAssets = ['assets/missing.png'] },
      reason: '引用的素材不存在',
    },
  ]

  for (const invalid of invalidCases) {
    it(`拒绝：${invalid.name}`, () => {
      const created = fixture()
      const template = templateEntry()
      invalid.mutate(template)
      created.writeManifest({ templates: [template] })
      expect(loadError(created.dir).reasons.some((reason) => reason.includes(invalid.reason))).toBe(true)
    })
  }
})

describe('素材路径守卫（读取期纵深防御；§8 决策 3 只读资源）', () => {
  it('assetBytes / relativeToTemplates 拒绝路径穿越与绝对路径', () => {
    const created = library()
    const registry = createTemplateRegistry({ dir: created.dir })
    for (const ref of ['../secret.png', '../../etc/passwd', '/etc/passwd']) {
      expect(() => registry.assetBytes(ref), ref).toThrow(TemplateLibraryError)
      expect(() => relativeToTemplates(created.dir, ref), ref).toThrow(TemplateLibraryError)
    }
  })
})

describe('默认目录与性能基线（§7.3）', () => {
  it('defaultTemplatesDir 指向模块内 templates/（随应用版本打包、只读）', () => {
    const dir = defaultTemplatesDir()
    expect(isAbsolute(dir)).toBe(true)
    expect(basename(dir)).toBe('templates')
  })

  it('模板库加载耗时 < 100 ms（§7.3 性能基线）', () => {
    const created = fixture()
    created.writeAsset('assets/a.png')
    created.writeAsset('assets/b.png')
    created.writeManifest({
      templates: [
        templateEntry(),
        templateEntry({ id: 'tpl-b', builtinAssets: ['assets/a.png'] }),
        templateEntry({ id: 'tpl-c', builtinAssets: ['assets/b.png'] }),
      ],
    })

    const start = performance.now()
    const registry = createTemplateRegistry({ dir: created.dir })
    const elapsed = performance.now() - start

    expect(registry.list()).toHaveLength(3)
    expect(elapsed).toBeLessThan(100)
  })
})
