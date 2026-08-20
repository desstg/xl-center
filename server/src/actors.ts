import { XMLParser } from 'fast-xml-parser'
import { readFileSync } from 'node:fs'

let aliasToCanonical: Map<string, string> = new Map()
let canonicalToAliases: Map<string, string[]> = new Map()

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

/** 解析 mapping_actor.xml，构建「别名 → 主名(zh_cn)」与「主名 → 别名列表」两个映射 */
export function loadActorMapping(filePath: string): void {
  const xml = readFileSync(filePath, 'utf-8')
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true })
  const doc = parser.parse(xml)
  const entries = toArray<Record<string, string>>(doc.actor?.a as any)

  const a2c = new Map<string, string>()
  const c2a = new Map<string, string[]>()

  for (const e of entries) {
    const canonical = e['@_zh_cn']?.trim()
    if (!canonical) continue

    const names = new Set<string>()
    // keyword: ,名字1,名字2,
    for (const kw of (e['@_keyword'] ?? '').split(',')) {
      const a = kw.trim()
      if (a) names.add(a)
    }
    if (e['@_zh_tw']) names.add(e['@_zh_tw'].trim())
    if (e['@_jp']) names.add(e['@_jp'].trim())
    names.add(canonical)

    for (const n of names) {
      if (!a2c.has(n)) a2c.set(n, canonical)
    }
    c2a.set(canonical, [...names].filter((n) => n !== canonical))
  }

  aliasToCanonical = a2c
  canonicalToAliases = c2a
}

export interface ActorInfo {
  canonical: string
  aliases: string[]
}

/** 按名字查找映射；命中返回主名与别名列表，未命中返回 null */
export function lookupActor(name: string): ActorInfo | null {
  const canonical = aliasToCanonical.get(name)
  if (!canonical) return null
  return { canonical, aliases: canonicalToAliases.get(canonical) ?? [] }
}

/** 映射表规模（别名总键数），用于日志/诊断 */
export function getMappingSize(): number {
  return aliasToCanonical.size
}
