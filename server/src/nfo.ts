import { XMLParser, XMLBuilder } from 'fast-xml-parser'

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
  parseAttributeValue: true,
})

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
})

// ---------- 工具 ----------

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s.length ? s : undefined
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// 评分：兼容旧版直接 <rating>8.5</rating> 与新版 <ratings><rating ...><value>..</value></rating></ratings>
function parseRating(node: Record<string, unknown>): number | undefined {
  const direct = num(node.rating)
  if (direct !== undefined) return direct
  const ratings = toArray<Record<string, unknown>>(
    (node.ratings as Record<string, unknown> | undefined)?.rating as any,
  )
  const def =
    ratings.find((r) => r?.['@_default'] === 'true') ?? ratings[0]
  if (!def) return undefined
  return num(def.value) ?? num(def)
}

// ---------- 类型 ----------

export interface NfoActor {
  name: string
  role?: string
  thumb?: string
}

export interface MovieNfo {
  title: string
  num?: string
  originalTitle?: string
  year?: number
  plot?: string
  outline?: string
  rating?: number
  votes?: number
  runtime?: number
  mpaa?: string
  premiered?: string
  trailer?: string
  genres: string[]
  tags: string[]
  countries: string[]
  studios: string[]
  directors: string[]
  writers: string[]
  actors: NfoActor[]
  thumbs: string[]
}

export interface TvshowNfo {
  title: string
  originalTitle?: string
  year?: number
  plot?: string
  rating?: number
  votes?: number
  premiered?: string
  genres: string[]
  tags: string[]
  actors: NfoActor[]
  thumbs: string[]
}

export interface EpisodeNfo {
  season?: number
  episode?: number
  title?: string
  plot?: string
  rating?: number
  thumb?: string
  actors: NfoActor[]
}

export type NfoResult =
  | { type: 'movie'; data: MovieNfo }
  | { type: 'tvshow'; data: TvshowNfo }
  | { type: 'episode'; data: EpisodeNfo }

// ---------- 构建 ----------

function buildActors(node: unknown): NfoActor[] {
  return toArray<Record<string, unknown>>(node as any)
    .map((a): NfoActor | null => {
      const name = str(a.name)
      if (!name) return null
      const actor: NfoActor = { name }
      const role = str(a.role)
      const thumb = str(a.thumb)
      if (role) actor.role = role
      if (thumb) actor.thumb = thumb
      return actor
    })
    .filter((a): a is NfoActor => a !== null)
}

function strList(node: unknown): string[] {
  return toArray<unknown>(node)
    .map((x) => str(x))
    .filter((x): x is string => !!x)
}

function buildMovie(node: Record<string, unknown>): MovieNfo {
  return {
    title: str(node.title) ?? '',
    num: str(node.num),
    originalTitle: str(node.originaltitle),
    year: num(node.year),
    plot: str(node.plot),
    outline: str(node.outline),
    rating: parseRating(node),
    votes: num(node.votes),
    runtime: num(node.runtime),
    mpaa: str(node.mpaa),
    premiered: str(node.premiered),
    trailer: str(node.trailer),
    genres: strList(node.genre),
    tags: strList(node.tag),
    countries: [...strList(node.country), ...strList(node.countrycode)],
    studios: strList(node.studio),
    directors: strList(node.director),
    writers: strList(node.credits),
    actors: buildActors(node.actor),
    thumbs: strList(node.thumb),
  }
}

function buildTvshow(node: Record<string, unknown>): TvshowNfo {
  return {
    title: str(node.title) ?? '',
    originalTitle: str(node.originaltitle),
    year: num(node.year),
    plot: str(node.plot),
    rating: parseRating(node),
    votes: num(node.votes),
    premiered: str(node.premiered),
    genres: strList(node.genre),
    tags: strList(node.tag),
    actors: buildActors(node.actor),
    thumbs: strList(node.thumb),
  }
}

function buildEpisode(node: Record<string, unknown>): EpisodeNfo {
  return {
    season: num(node.season),
    episode: num(node.episode),
    title: str(node.title),
    plot: str(node.plot),
    rating: parseRating(node),
    thumb: str(node.thumb),
    actors: buildActors(node.actor),
  }
}

// ---------- 对外接口 ----------

export function parseMovieNfo(xml: string): MovieNfo {
  const doc = parser.parse(xml)
  return buildMovie(doc.movie ?? {})
}

export function parseTvshowNfo(xml: string): TvshowNfo {
  const doc = parser.parse(xml)
  return buildTvshow(doc.tvshow ?? {})
}

export function parseEpisodeNfo(xml: string): EpisodeNfo {
  const doc = parser.parse(xml)
  return buildEpisode(doc.episodedetails ?? {})
}

/** 自动检测根节点类型并解析；无法识别返回 null */
export function parseNfo(xml: string): NfoResult | null {
  const doc = parser.parse(xml)
  if (doc.movie) return { type: 'movie', data: buildMovie(doc.movie) }
  if (doc.tvshow) return { type: 'tvshow', data: buildTvshow(doc.tvshow) }
  if (doc.episodedetails) return { type: 'episode', data: buildEpisode(doc.episodedetails) }
  return null
}

// ---------- 序列化（写回 NFO） ----------

function setText(node: Record<string, unknown>, key: string, val: string | number | undefined | null): void {
  if (val === undefined || val === null || val === '') delete node[key]
  else node[key] = typeof val === 'number' ? val : String(val)
}

// 字符串列表 → 同名标签（空则删除该键；XMLBuilder 对数组每个元素生成一个标签）
function setList(node: Record<string, unknown>, key: string, vals: string[] | undefined | null): void {
  const arr = (vals ?? []).map((v) => v.trim()).filter(Boolean)
  if (!arr.length) delete node[key]
  else node[key] = arr
}

// 评分：统一写成新版 <ratings><rating ...><value>..</value></rating></ratings>，票数写顶层 <votes>
function setRating(node: Record<string, unknown>, rating: number | undefined, votes: number | undefined): void {
  delete node.rating // 清除旧版顶层 <rating>
  if (rating !== undefined) {
    node.ratings = {
      rating: {
        '@_name': 'default',
        '@_max': '10',
        '@_default': 'true',
        value: rating,
      },
    }
  } else {
    delete node.ratings
  }
  if (votes !== undefined) node.votes = votes
  else delete node.votes
}

function setActors(node: Record<string, unknown>, actors: NfoActor[] | undefined | null): void {
  const arr = (actors ?? [])
    .filter((a) => a.name?.trim())
    .map((a) => {
      const o: Record<string, unknown> = { name: a.name.trim() }
      if (a.role?.trim()) o.role = a.role.trim()
      if (a.thumb?.trim()) o.thumb = a.thumb.trim()
      return o
    })
  if (!arr.length) delete node.actor
  else node.actor = arr
}

/** 把 MovieNfo 的字段写入 movie 节点（只覆盖已知字段，保留原 NFO 里的其他节点如 uniqueid/set 等） */
function applyNfoToNode(node: Record<string, unknown>, nfo: MovieNfo): void {
  setText(node, 'title', nfo.title)
  setText(node, 'num', nfo.num)
  setText(node, 'originaltitle', nfo.originalTitle)
  setText(node, 'year', nfo.year)
  setText(node, 'plot', nfo.plot)
  setText(node, 'outline', nfo.outline)
  setText(node, 'runtime', nfo.runtime)
  setText(node, 'mpaa', nfo.mpaa)
  setText(node, 'premiered', nfo.premiered)
  setText(node, 'trailer', nfo.trailer)

  setRating(node, nfo.rating, nfo.votes)

  setList(node, 'genre', nfo.genres)
  setList(node, 'tag', nfo.tags)
  setList(node, 'country', nfo.countries)
  setList(node, 'studio', nfo.studios)
  setList(node, 'director', nfo.directors)
  setList(node, 'credits', nfo.writers)
  setActors(node, nfo.actors)
}

/** 序列化 MovieNfo 为 Kodi 标准 movie.nfo 文本；originalXml 用于保留原文件里未解析的字段 */
export function serializeMovieNfo(nfo: MovieNfo, originalXml?: string): string {
  let node: Record<string, unknown> = {}
  if (originalXml) {
    try {
      const doc = parser.parse(originalXml)
      if (doc && typeof doc === 'object' && doc.movie && typeof doc.movie === 'object' && !Array.isArray(doc.movie)) {
        node = doc.movie as Record<string, unknown>
      }
    } catch {
      // 原 XML 解析失败则从空节点重建
    }
  }
  applyNfoToNode(node, nfo)
  const body = builder.build({ movie: node })
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n${body}`
}
