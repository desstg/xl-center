import { Router } from 'express'
import Database from 'better-sqlite3'
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync, readdirSync, statSync, rmSync } from 'node:fs'
import { resolve, dirname, join, extname } from 'node:path'
import { getDb } from '../db.js'
import { lookupActor } from '../actors.js'
import { serializeMovieNfo, type MovieNfo, type NfoActor } from '../nfo.js'
import { getFfmpegPath } from '../ffmpeg.js'
import { resolveImage, clearImageThumbCache } from './images.js'
import { refreshMovie } from '../scanner.js'

export const moviesRouter = Router()

// ---------- 工具 ----------

function csv(v: unknown): string[] {
  if (typeof v !== 'string') return []
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

function parseYear(v: unknown): [number, number] | null {
  if (typeof v !== 'string') return null
  const m = v.match(/^(\d{4})(?:-(\d{4}))?$/)
  if (!m) return null
  return [Number(m[1]), m[2] ? Number(m[2]) : Number(m[1])]
}

function inClause(n: number): string {
  return Array.from({ length: n }, () => '?').join(',')
}

// 名字列表 → id 列表（演员需先归一化到主名）
function resolveIds(names: string[], table: 'actor' | 'tag' | 'genre'): number[] {
  const db = getDb()
  const ids: number[] = []
  for (const n of names) {
    const canonical = table === 'actor' ? (lookupActor(n)?.canonical ?? n) : n
    const row = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(canonical) as
      | { id: number }
      | undefined
    if (row) ids.push(row.id)
  }
  return ids
}

const SORTS: Record<string, string> = {
  title: 'm.title COLLATE NOCASE ASC',
  year: 'm.year DESC',
  rating: 'm.rating DESC',
  date_added: 'm.date_added DESC',
}

// ---------- 列表 + 搜索 ----------

moviesRouter.get('/movies', (req, res) => {
  const db = getDb()
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const actorNames = csv(req.query.actors)
  const tagNames = csv(req.query.tags)
  const genreNames = csv(req.query.genres)
  const year = parseYear(req.query.year)
  const libraryId = req.query.library ? Number(req.query.library) : undefined
  const num = typeof req.query.num === 'string' ? req.query.num.trim() : ''
  const filename = typeof req.query.filename === 'string' ? req.query.filename.trim() : ''
  const match = req.query.match === 'any' ? 'any' : 'all'
  const sortKey = typeof req.query.sort === 'string' && SORTS[req.query.sort] ? req.query.sort : 'date_added'
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24))
  const offset = (page - 1) * limit

  const actorIds = resolveIds(actorNames, 'actor')
  const tagIds = resolveIds(tagNames, 'tag')
  const genreIds = resolveIds(genreNames, 'genre')

  const where: string[] = []
  const params: unknown[] = []
  let joins = ''
  let groupBy = ''
  const having: string[] = []

  if (q) {
    where.push('(m.title LIKE ? OR m.original_title LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }
  if (year) {
    where.push('m.year >= ? AND m.year <= ?')
    params.push(year[0], year[1])
  }
  if (libraryId) {
    where.push('m.library_id = ?')
    params.push(libraryId)
  }
  if (num) {
    where.push('m.num LIKE ?')
    params.push(`%${num}%`)
  }
  if (filename) {
    where.push('m.video_path LIKE ?')
    params.push(`%${filename}%`)
  }

  const hasFacet = actorIds.length || tagIds.length || genreIds.length

  if (hasFacet && match === 'all') {
    // 全部匹配：JOIN + GROUP BY + HAVING COUNT >= N
    if (actorIds.length) {
      joins += '\n  JOIN movie_actor ma ON ma.movie_id = m.id'
      where.push(`ma.actor_id IN (${inClause(actorIds.length)})`)
      params.push(...actorIds)
      having.push(`COUNT(DISTINCT ma.actor_id) >= ${actorIds.length}`)
    }
    if (tagIds.length) {
      joins += '\n  JOIN movie_tag mt ON mt.movie_id = m.id'
      where.push(`mt.tag_id IN (${inClause(tagIds.length)})`)
      params.push(...tagIds)
      having.push(`COUNT(DISTINCT mt.tag_id) >= ${tagIds.length}`)
    }
    if (genreIds.length) {
      joins += '\n  JOIN movie_genre mg ON mg.movie_id = m.id'
      where.push(`mg.genre_id IN (${inClause(genreIds.length)})`)
      params.push(...genreIds)
      having.push(`COUNT(DISTINCT mg.genre_id) >= ${genreIds.length}`)
    }
    groupBy = 'GROUP BY m.id'
  } else if (hasFacet && match === 'any') {
    // 任意匹配：UNION 子查询
    const subs: string[] = []
    if (actorIds.length) subs.push(`SELECT movie_id FROM movie_actor WHERE actor_id IN (${inClause(actorIds.length)})`)
    if (tagIds.length) subs.push(`SELECT movie_id FROM movie_tag WHERE tag_id IN (${inClause(tagIds.length)})`)
    if (genreIds.length) subs.push(`SELECT movie_id FROM movie_genre WHERE genre_id IN (${inClause(genreIds.length)})`)
    where.push(`m.id IN (${subs.join('\n  UNION\n  ')})`)
    params.push(...actorIds, ...tagIds, ...genreIds)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const havingSql = having.length ? `HAVING ${having.join(' AND ')}` : ''

  const select = `SELECT m.*, l.name AS library_name,
  (SELECT COUNT(*) FROM favorite WHERE movie_id = m.id) AS favorite
  FROM movie m
  JOIN library l ON l.id = m.library_id${joins}
  ${whereSql}
  ${groupBy}
  ${havingSql}`

  const items = db
    .prepare(`${select} ORDER BY ${SORTS[sortKey]} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)

  const total = (
    db.prepare(`SELECT COUNT(*) c FROM (${select}) t`).get(...params) as { c: number }
  ).c

  res.json({ items, total, page, limit })
})

// ---------- 仪表板最近添加 ----------

function balancedRecent(pools: any[][], target: number): any[] {
  const n = pools.length
  if (n === 0) return []
  // 第一轮：每库尽量分到 target/n（不够就全取）
  const perLib = Math.floor(target / n)
  const allocated = pools.map((p) => Math.min(perLib, p.length))
  // 第二轮：剩余名额轮流分给还有余量的库
  let remaining = target - allocated.reduce((a, b) => a + b, 0)
  while (remaining > 0) {
    let changed = false
    for (let i = 0; i < n && remaining > 0; i++) {
      if (allocated[i] < pools[i].length) {
        allocated[i]++
        remaining--
        changed = true
      }
    }
    if (!changed) break
  }
  const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  const result: any[] = []
  for (let i = 0; i < n; i++) {
    result.push(...shuffle(pools[i]).slice(0, allocated[i]))
  }
  return shuffle(result)
}

// 仪表板「最近添加」：每库取最近 20 部，均衡抽样出 48 部
moviesRouter.get('/movies/recent', (_req, res) => {
  const db = getDb()
  const libs = db.prepare('SELECT id FROM library WHERE type = ? ORDER BY id').all('film') as { id: number }[]
  const pools: any[][] = []
  for (const lib of libs) {
    const items = db
      .prepare('SELECT m.*, l.name AS library_name FROM movie m JOIN library l ON l.id = m.library_id WHERE m.library_id = ? ORDER BY m.date_added DESC, m.id DESC LIMIT 20')
      .all(lib.id) as any[]
    pools.push(items)
  }
  res.json({ items: balancedRecent(pools, 48) })
})

// ---------- 详情 ----------

moviesRouter.get('/movies/:id', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const movie = db.prepare('SELECT m.*, l.name AS library_name, lp.path AS lib_path FROM movie m JOIN library l ON l.id = m.library_id LEFT JOIN library_path lp ON lp.id = m.library_path_id WHERE m.id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!movie) {
    res.status(404).json({ error: '影片不存在' })
    return
  }

  const pickNames = (sql: string) =>
    (db.prepare(sql).all(id) as { name: string }[]).map((r) => r.name)

  const actors = (
    db
      .prepare(
        `SELECT a.id, a.name, ma.role, ma.thumb,
          (SELECT GROUP_CONCAT(alias, ',') FROM actor_alias WHERE actor_id = a.id) AS aliases
        FROM movie_actor ma JOIN actor a ON a.id = ma.actor_id
        WHERE ma.movie_id = ? ORDER BY ma.rowid`,
      )
      .all(id) as { id: number; name: string; role: string | null; thumb: string | null; aliases: string | null }[]
  ).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    thumb: a.thumb,
    aliases: a.aliases ? a.aliases.split(',') : [],
  }))

  const stills = (db.prepare('SELECT path FROM image WHERE ref_type = ? AND ref_id = ? ORDER BY id').all('movie', id) as { path: string }[]).map((s) => s.path)
  const subtitles = db.prepare('SELECT path, language, codec FROM subtitle WHERE ref_type = ? AND ref_id = ?').all('movie', id)
  const favorite = !!db.prepare('SELECT 1 FROM favorite WHERE movie_id = ?').get(id)

  // 统计影片文件夹里的文件数量（不含子目录）
  let fileCount = 0
  if (movie.video_path && movie.lib_path) {
    const dir = resolve(String(movie.lib_path), dirname(String(movie.video_path)))
    try {
      fileCount = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).length
    } catch {
      fileCount = 0
    }
  }

  res.json({
    ...movie,
    file_count: fileCount,
    favorite,
    genres: pickNames('SELECT g.name FROM movie_genre mg JOIN genre g ON g.id = mg.genre_id WHERE mg.movie_id = ?'),
    tags: pickNames('SELECT t.name FROM movie_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.movie_id = ?'),
    countries: pickNames('SELECT c.name FROM movie_country mc JOIN country c ON c.id = mc.country_id WHERE mc.movie_id = ?'),
    studios: pickNames('SELECT s.name FROM movie_studio ms JOIN studio s ON s.id = ms.studio_id WHERE ms.movie_id = ?'),
    directors: pickNames('SELECT p.name FROM movie_director md JOIN person p ON p.id = md.person_id WHERE md.movie_id = ?'),
    writers: pickNames('SELECT p.name FROM movie_writer mw JOIN person p ON p.id = mw.person_id WHERE mw.movie_id = ?'),
    actors,
    stills,
    subtitles,
  })
})

// 删除影片：mode=info 只删入库信息；mode=all 连本地文件一起删
moviesRouter.delete('/movies/:id', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const mode = req.query.mode === 'all' ? 'all' : 'info'
  const movie = db
    .prepare('SELECT m.*, lp.path AS lib_path FROM movie m LEFT JOIN library_path lp ON lp.id = m.library_path_id WHERE m.id = ?')
    .get(id) as (Record<string, any> & { lib_path?: string }) | undefined
  if (!movie) {
    res.status(404).json({ error: '影片不存在' })
    return
  }

  // 记录视频文件大小作为「指纹」，供扫描时判断文件是否变化
  let fileSize = 0
  let dirAbs = ''
  if (movie.lib_path && movie.video_path) {
    const videoAbs = resolve(String(movie.lib_path), String(movie.video_path))
    dirAbs = dirname(videoAbs)
    try {
      fileSize = statSync(videoAbs).size
    } catch {
      fileSize = 0
    }
  }

  // 记入 deleted_movie（扫描时跳过，除非文件变化）
  db.prepare('INSERT INTO deleted_movie (library_path_id, video_path, file_size) VALUES (?, ?, ?)').run(
    movie.library_path_id ?? null,
    movie.video_path,
    fileSize,
  )

  // mode=all：删除整个影片文件夹
  if (mode === 'all' && dirAbs) {
    try {
      rmSync(dirAbs, { recursive: true, force: true })
    } catch (e) {
      console.error('[movie] 删除本地文件失败', (e as Error).message)
      res.status(500).json({ error: '删除本地文件失败：' + (e as Error).message })
      return
    }
  }

  // 删除 movie 记录（关联数据由外键级联删除）
  db.prepare('DELETE FROM movie WHERE id = ?').run(id)
  res.json({ ok: true })
})

// 相关影片：当前影片演员参演的其他影片（排除当前这部）
moviesRouter.get('/movies/:id/related', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const rows = db
    .prepare(
      `SELECT DISTINCT m.*, l.name AS library_name
      FROM movie m
      JOIN library l ON l.id = m.library_id
      JOIN movie_actor ma ON ma.movie_id = m.id
      WHERE ma.actor_id IN (SELECT actor_id FROM movie_actor WHERE movie_id = ?)
        AND m.id != ?
      ORDER BY m.year DESC
      LIMIT 12`,
    )
    .all(id, id)
  res.json(rows)
})

// 切换收藏：收藏/取消
moviesRouter.post('/movies/:id/favorite', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const movie = db.prepare('SELECT id FROM movie WHERE id = ?').get(id)
  if (!movie) {
    res.status(404).json({ error: '影片不存在' })
    return
  }
  const existing = db.prepare('SELECT 1 FROM favorite WHERE movie_id = ?').get(id)
  if (existing) {
    db.prepare('DELETE FROM favorite WHERE movie_id = ?').run(id)
    res.json({ favorite: false })
  } else {
    db.prepare('INSERT INTO favorite (movie_id) VALUES (?)').run(id)
    res.json({ favorite: true })
  }
})

// 刷新单部影片的元数据（重新读取该影片文件夹的 NFO/图片并更新库）
moviesRouter.post('/movies/:id/refresh', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const movie = db.prepare('SELECT id FROM movie WHERE id = ?').get(id)
  if (!movie) {
    res.status(404).json({ error: '影片不存在' })
    return
  }
  refreshMovie(id)
  res.json({ ok: true })
})

// 收藏列表
moviesRouter.get('/favorites', (_req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT m.*, l.name AS library_name
      FROM favorite f
      JOIN movie m ON m.id = f.movie_id
      JOIN library l ON l.id = m.library_id
      ORDER BY f.created_at DESC`,
    )
    .all()
  res.json(rows)
})

// 统计：今日/本周/本月新增
moviesRouter.get('/stats', (_req, res) => {
  const db = getDb()
  const today = (
    db
      .prepare("SELECT COUNT(*) c FROM movie WHERE date(date_added, 'localtime') = date('now', 'localtime')")
      .get() as { c: number }
  ).c
  const week = (
    db
      .prepare(
        "SELECT COUNT(*) c FROM movie WHERE datetime(date_added, 'localtime') >= datetime('now', 'localtime', '-7 days')",
      )
      .get() as { c: number }
  ).c
  const month = (
    db
      .prepare(
        "SELECT COUNT(*) c FROM movie WHERE datetime(date_added, 'localtime') >= datetime('now', 'localtime', '-30 days')",
      )
      .get() as { c: number }
  ).c
  res.json({ today, week, month })
})

// ---------- 下拉数据 ----------

moviesRouter.get('/actors', (req, res) => {
  const db = getDb()
  const keywords = typeof req.query.q === 'string'
    ? req.query.q.split(',').map((s) => s.trim()).filter(Boolean)
    : []
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
  const offset = (page - 1) * limit

  let where = ''
  const params: string[] = []
  if (keywords.length) {
    where =
      'WHERE ' +
      keywords
        .map(() => '(a.name LIKE ? OR EXISTS (SELECT 1 FROM actor_alias aa WHERE aa.actor_id = a.id AND aa.alias LIKE ?))')
        .join(' OR ')
    for (const k of keywords) params.push(`%${k}%`, `%${k}%`)
  }

  const select = `SELECT a.id, a.name, a.created_at,
    (SELECT GROUP_CONCAT(alias, ',') FROM actor_alias WHERE actor_id = a.id) AS aliases,
    (SELECT COUNT(*) FROM actor_alias WHERE actor_id = a.id) AS alias_count,
    (SELECT COUNT(*) FROM movie_actor ma WHERE ma.actor_id = a.id) AS movie_count
  FROM actor a ${where}`

  const items = db
    .prepare(`${select} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as { id: number; name: string; created_at: string; aliases: string | null; alias_count: number; movie_count: number }[]
  const total = (db.prepare(`SELECT COUNT(*) c FROM (${select}) t`).get(...params) as { c: number }).c
  const stats = {
    associated: (db.prepare('SELECT COUNT(*) c FROM actor WHERE (SELECT COUNT(*) FROM movie_actor WHERE actor_id = actor.id) > 0').get() as { c: number }).c,
    unused: (db.prepare('SELECT COUNT(*) c FROM actor WHERE (SELECT COUNT(*) FROM movie_actor WHERE actor_id = actor.id) = 0').get() as { c: number }).c,
  }

  res.json({
    items: items.map((a) => ({
      id: a.id,
      name: a.name,
      aliases: a.aliases ? a.aliases.split(',') : [],
      alias_count: a.alias_count,
      movie_count: a.movie_count,
      created_at: a.created_at,
    })),
    total,
    page,
    limit,
    stats,
  })
})

// 添加演员
moviesRouter.post('/actors', (req, res) => {
  const db = getDb()
  const { name } = (req.body ?? {}) as { name?: string }
  if (!name?.trim()) {
    res.status(400).json({ error: '演员名称不能为空' })
    return
  }
  try {
    const info = db.prepare('INSERT INTO actor (name) VALUES (?)').run(name.trim())
    res.status(201).json(db.prepare('SELECT * FROM actor WHERE id = ?').get(info.lastInsertRowid))
  } catch (e) {
    if ((e as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: '该演员已存在' })
      return
    }
    throw e
  }
})

// 编辑演员
moviesRouter.put('/actors/:id', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const { name, aliases } = (req.body ?? {}) as { name?: string; aliases?: string[] }
  const existing = db.prepare('SELECT id, name FROM actor WHERE id = ?').get(id) as
    | { name: string }
    | undefined
  if (!existing) {
    res.status(404).json({ error: '演员不存在' })
    return
  }
  const newName = name?.trim() || existing.name
  db.prepare('UPDATE actor SET name = ? WHERE id = ?').run(newName, id)
  // 更新别名（覆盖式）
  if (Array.isArray(aliases)) {
    db.prepare('DELETE FROM actor_alias WHERE actor_id = ?').run(id)
    const ins = db.prepare('INSERT OR IGNORE INTO actor_alias (actor_id, alias) VALUES (?, ?)')
    for (const a of aliases) {
      const alias = a.trim()
      if (alias && alias !== newName) ins.run(id, alias)
    }
  }
  res.json(db.prepare('SELECT * FROM actor WHERE id = ?').get(id))
})

// 删除演员
moviesRouter.delete('/actors/:id', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const existing = db.prepare('SELECT id FROM actor WHERE id = ?').get(id)
  if (!existing) {
    res.status(404).json({ error: '演员不存在' })
    return
  }
  db.prepare('DELETE FROM actor WHERE id = ?').run(id)
  res.json({ ok: true })
})

moviesRouter.get('/tags', (req, res) => {
  const db = getDb()
  const keywords = typeof req.query.q === 'string'
    ? req.query.q.split(',').map((s) => s.trim()).filter(Boolean)
    : []
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
  const offset = (page - 1) * limit
  let where = ''
  const params: string[] = []
  if (keywords.length) {
    where = 'WHERE ' + keywords.map(() => 't.name LIKE ?').join(' OR ')
    params.push(...keywords.map((k) => `%${k}%`))
  }
  const select = `SELECT t.id, t.name, t.created_at,
    (SELECT COUNT(*) FROM movie_tag mt WHERE mt.tag_id = t.id) AS movie_count
  FROM tag t ${where}`
  const items = db
    .prepare(`${select} ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as { id: number; name: string; created_at: string; movie_count: number }[]
  const total = (db.prepare(`SELECT COUNT(*) c FROM (${select}) t2`).get(...params) as { c: number }).c
  const stats = {
    associated: (db.prepare('SELECT COUNT(*) c FROM tag WHERE (SELECT COUNT(*) FROM movie_tag WHERE tag_id = tag.id) > 0').get() as { c: number }).c,
    unused: (db.prepare('SELECT COUNT(*) c FROM tag WHERE (SELECT COUNT(*) FROM movie_tag WHERE tag_id = tag.id) = 0').get() as { c: number }).c,
  }
  res.json({ items, total, page, limit, stats })
})

moviesRouter.post('/tags', (req, res) => {
  const db = getDb()
  const { name } = (req.body ?? {}) as { name?: string }
  if (!name?.trim()) {
    res.status(400).json({ error: '标签名称不能为空' })
    return
  }
  try {
    const info = db.prepare('INSERT INTO tag (name) VALUES (?)').run(name.trim())
    res.status(201).json(db.prepare('SELECT * FROM tag WHERE id = ?').get(info.lastInsertRowid))
  } catch (e) {
    if ((e as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: '该标签已存在' })
      return
    }
    throw e
  }
})

moviesRouter.put('/tags/:id', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const { name } = (req.body ?? {}) as { name?: string }
  if (!name?.trim()) {
    res.status(400).json({ error: '标签名称不能为空' })
    return
  }
  if (!db.prepare('SELECT id FROM tag WHERE id = ?').get(id)) {
    res.status(404).json({ error: '标签不存在' })
    return
  }
  db.prepare('UPDATE tag SET name = ? WHERE id = ?').run(name.trim(), id)
  res.json(db.prepare('SELECT * FROM tag WHERE id = ?').get(id))
})

moviesRouter.delete('/tags/:id', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  if (!db.prepare('SELECT id FROM tag WHERE id = ?').get(id)) {
    res.status(404).json({ error: '标签不存在' })
    return
  }
  db.prepare('DELETE FROM tag WHERE id = ?').run(id)
  res.json({ ok: true })
})

moviesRouter.get('/genres', (req, res) => {
  const db = getDb()
  const keywords = typeof req.query.q === 'string'
    ? req.query.q.split(',').map((s) => s.trim()).filter(Boolean)
    : []
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
  const offset = (page - 1) * limit
  let where = ''
  const params: string[] = []
  if (keywords.length) {
    where = 'WHERE ' + keywords.map(() => 'g.name LIKE ?').join(' OR ')
    params.push(...keywords.map((k) => `%${k}%`))
  }
  const select = `SELECT g.id, g.name, g.created_at,
    (SELECT COUNT(*) FROM movie_genre mg WHERE mg.genre_id = g.id) AS movie_count
  FROM genre g ${where}`
  const items = db
    .prepare(`${select} ORDER BY g.created_at DESC, g.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as { id: number; name: string; created_at: string; movie_count: number }[]
  const total = (db.prepare(`SELECT COUNT(*) c FROM (${select}) g2`).get(...params) as { c: number }).c
  const stats = {
    associated: (db.prepare('SELECT COUNT(*) c FROM genre WHERE (SELECT COUNT(*) FROM movie_genre WHERE genre_id = genre.id) > 0').get() as { c: number }).c,
    unused: (db.prepare('SELECT COUNT(*) c FROM genre WHERE (SELECT COUNT(*) FROM movie_genre WHERE genre_id = genre.id) = 0').get() as { c: number }).c,
  }
  res.json({ items, total, page, limit, stats })
})

moviesRouter.post('/genres', (req, res) => {
  const db = getDb()
  const { name } = (req.body ?? {}) as { name?: string }
  if (!name?.trim()) {
    res.status(400).json({ error: '类型名称不能为空' })
    return
  }
  try {
    const info = db.prepare('INSERT INTO genre (name) VALUES (?)').run(name.trim())
    res.status(201).json(db.prepare('SELECT * FROM genre WHERE id = ?').get(info.lastInsertRowid))
  } catch (e) {
    if ((e as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: '该类型已存在' })
      return
    }
    throw e
  }
})

moviesRouter.put('/genres/:id', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const { name } = (req.body ?? {}) as { name?: string }
  if (!name?.trim()) {
    res.status(400).json({ error: '类型名称不能为空' })
    return
  }
  if (!db.prepare('SELECT id FROM genre WHERE id = ?').get(id)) {
    res.status(404).json({ error: '类型不存在' })
    return
  }
  db.prepare('UPDATE genre SET name = ? WHERE id = ?').run(name.trim(), id)
  res.json(db.prepare('SELECT * FROM genre WHERE id = ?').get(id))
})

moviesRouter.delete('/genres/:id', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  if (!db.prepare('SELECT id FROM genre WHERE id = ?').get(id)) {
    res.status(404).json({ error: '类型不存在' })
    return
  }
  db.prepare('DELETE FROM genre WHERE id = ?').run(id)
  res.json({ ok: true })
})

// ---------- 保存 NFO（编辑影片信息） ----------

function strField(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s.length ? s : undefined
}

function numField(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function strArrField(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x).trim()).filter(Boolean)
}

// 由视频相对路径推导 NFO 相对路径（同目录、同名 .nfo）
function deriveNfoRelPath(videoPath: string): string {
  const parts = videoPath.replace(/\\/g, '/').split('/')
  const file = parts[parts.length - 1] ?? ''
  const base = file.replace(/\.[^.]+$/, '')
  const dir = parts.slice(0, -1).join('/')
  return dir ? `${dir}/${base}.nfo` : `${base}.nfo`
}

// 受控表名白名单（与 scanner.ts 保持一致）
const ID_TABLES: Record<string, 1> = {
  actor: 1,
  tag: 1,
  genre: 1,
  country: 1,
  studio: 1,
  person: 1,
}

function getOrCreateId(db: Database.Database, table: string, name: string): number {
  if (!ID_TABLES[table]) throw new Error(`非法表名: ${table}`)
  const row = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as { id: number } | undefined
  if (row) return row.id
  return Number(db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(name).lastInsertRowid)
}

// 重写 movie 的多对多关联（与 scanner.ts 的 scanMovieFolder 逻辑保持一致）
function syncMovieRelations(db: Database.Database, movieId: number, nfo: MovieNfo): void {
  for (const t of [
    'movie_genre',
    'movie_tag',
    'movie_country',
    'movie_studio',
    'movie_director',
    'movie_writer',
    'movie_actor',
  ]) {
    db.prepare(`DELETE FROM ${t} WHERE movie_id = ?`).run(movieId)
  }

  const link = (table: string, rightCol: string) => {
    const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} (movie_id, ${rightCol}) VALUES (?, ?)`)
    return (rightId: number) => stmt.run(movieId, rightId)
  }
  for (const g of nfo.genres) link('movie_genre', 'genre_id')(getOrCreateId(db, 'genre', g))
  for (const t of nfo.tags) link('movie_tag', 'tag_id')(getOrCreateId(db, 'tag', t))
  for (const c of nfo.countries) link('movie_country', 'country_id')(getOrCreateId(db, 'country', c))
  for (const s of nfo.studios) link('movie_studio', 'studio_id')(getOrCreateId(db, 'studio', s))
  for (const d of nfo.directors) link('movie_director', 'person_id')(getOrCreateId(db, 'person', d))
  for (const w of nfo.writers) link('movie_writer', 'person_id')(getOrCreateId(db, 'person', w))

  const linkActor = db.prepare('INSERT OR IGNORE INTO movie_actor (movie_id, actor_id, role, thumb) VALUES (?, ?, ?, ?)')
  const insAlias = db.prepare('INSERT OR IGNORE INTO actor_alias (actor_id, alias) VALUES (?, ?)')
  for (const a of nfo.actors) {
    const mapped = lookupActor(a.name)
    const canonical = mapped?.canonical ?? a.name
    const actorId = getOrCreateId(db, 'actor', canonical)
    if (mapped) {
      for (const alias of mapped.aliases) insAlias.run(actorId, alias)
    }
    linkActor.run(movieId, actorId, a.role ?? null, a.thumb ?? null)
  }
}

// 保存影片 NFO：写回 NFO 文件 + 更新数据库
moviesRouter.put('/movies/:id/nfo', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const movie = db
    .prepare('SELECT m.*, lp.path AS lib_path FROM movie m LEFT JOIN library_path lp ON lp.id = m.library_path_id WHERE m.id = ?')
    .get(id) as (Record<string, unknown> & { lib_path?: string }) | undefined
  if (!movie) {
    res.status(404).json({ error: '影片不存在' })
    return
  }
  const libPath = movie.lib_path
  if (!libPath) {
    res.status(400).json({ error: '无法定位影片目录（缺少库路径）' })
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const title = strField(body.title)
  if (!title) {
    res.status(400).json({ error: '标题不能为空' })
    return
  }

  const nfo: MovieNfo = {
    title,
    num: strField(body.num),
    originalTitle: strField(body.originalTitle),
    year: numField(body.year),
    plot: strField(body.plot),
    outline: strField(body.outline),
    rating: numField(body.rating),
    votes: numField(body.votes),
    runtime: numField(body.runtime),
    mpaa: strField(body.mpaa),
    premiered: strField(body.premiered),
    trailer: strField(body.trailer),
    genres: strArrField(body.genres),
    tags: strArrField(body.tags),
    countries: strArrField(body.countries),
    studios: strArrField(body.studios),
    directors: strArrField(body.directors),
    writers: strArrField(body.writers),
    actors: (Array.isArray(body.actors) ? body.actors : [])
      .map((raw) => {
        const a = raw as Record<string, unknown>
        const name = typeof a.name === 'string' ? a.name.trim() : ''
        if (!name) return null
        const actor: NfoActor = { name }
        if (typeof a.role === 'string' && a.role.trim()) actor.role = a.role.trim()
        if (typeof a.thumb === 'string' && a.thumb.trim()) actor.thumb = a.thumb.trim()
        return actor
      })
      .filter((a): a is NfoActor => a !== null),
    thumbs: [],
  }

  // 定位 NFO 文件：优先已有 nfo_path，否则按视频名在同目录新建
  const videoPath = String(movie.video_path ?? '')
  const nfoRelPath = typeof movie.nfo_path === 'string' && movie.nfo_path ? movie.nfo_path : deriveNfoRelPath(videoPath)
  const nfoAbsPath = resolve(libPath, nfoRelPath)

  // 读原 NFO（用于合并保留未知字段）
  let originalXml: string | undefined
  try {
    if (existsSync(nfoAbsPath)) originalXml = readFileSync(nfoAbsPath, 'utf-8')
  } catch {
    originalXml = undefined
  }

  // 写回 NFO 文件
  try {
    const xml = serializeMovieNfo(nfo, originalXml)
    mkdirSync(dirname(nfoAbsPath), { recursive: true })
    writeFileSync(nfoAbsPath, xml, 'utf-8')
  } catch (e) {
    console.error('[nfo] 写回 NFO 失败', (e as Error).message)
    res.status(500).json({ error: '写回 NFO 文件失败：' + (e as Error).message })
    return
  }

  // 更新 movie 表 + 多对多关联
  db.prepare(
    `UPDATE movie SET title=?, num=?, original_title=?, year=?, plot=?, outline=?, rating=?, votes=?, runtime=?, mpaa=?, premiered=?, trailer=?, nfo_path=?, updated_at=datetime('now') WHERE id=?`,
  ).run(
    nfo.title,
    nfo.num ?? null,
    nfo.originalTitle ?? null,
    nfo.year ?? null,
    nfo.plot ?? null,
    nfo.outline ?? null,
    nfo.rating ?? null,
    nfo.votes ?? null,
    nfo.runtime ?? null,
    nfo.mpaa ?? null,
    nfo.premiered ?? null,
    nfo.trailer ?? null,
    nfoRelPath,
    id,
  )
  syncMovieRelations(db, id, nfo)

  res.json({ ok: true })
})

// 裁剪海报：把当前海报（无海报则用画报）按比例裁剪为新海报
moviesRouter.post('/movies/:id/poster', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  console.log('[poster] 收到裁剪请求 id=', id, 'body=', JSON.stringify(req.body ?? {}))
  const movie = db.prepare('SELECT id, library_id, poster, fanart FROM movie WHERE id = ?').get(id) as
    | { id: number; library_id: number; poster: string | null; fanart: string | null }
    | undefined
  if (!movie) {
    res.status(404).json({ error: '影片不存在' })
    return
  }

  const srcRel = movie.fanart || movie.poster
  if (!srcRel) {
    res.status(400).json({ error: '该影片没有海报或画报可裁剪' })
    return
  }

  // 校验裁剪框（相对源图的比例，0~1）
  const { x, y, w, h } = (req.body ?? {}) as { x?: number; y?: number; w?: number; h?: number }
  if (![x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    res.status(400).json({ error: '裁剪框参数无效' })
    return
  }
  const X = x as number
  const Y = y as number
  const W = w as number
  const H = h as number
  if (W <= 0 || H <= 0 || X < 0 || Y < 0 || X + W > 1.001 || Y + H > 1.001) {
    res.status(400).json({ error: '裁剪框超出图片范围' })
    return
  }

  // 定位源图绝对路径
  const srcResolved = resolveImage(movie.library_id, srcRel)
  if (!srcResolved) {
    res.status(404).json({ error: '源图文件不存在' })
    return
  }
  const srcAbs = srcResolved.filePath

  // 输出路径：始终写入 poster.jpg（竖版海报），与裁剪源 fanart 分离
  let outRel: string
  let outAbs: string
  if (movie.poster) {
    outRel = movie.poster
    const posterResolved = resolveImage(movie.library_id, movie.poster)
    if (!posterResolved) {
      res.status(404).json({ error: '海报文件不存在' })
      return
    }
    outAbs = posterResolved.filePath
  } else {
    const dir = dirname(srcRel.replace(/\\/g, '/'))
    outRel = dir && dir !== '.' ? `${dir}/poster.jpg` : 'poster.jpg'
    outAbs = resolve(dirname(srcAbs), 'poster.jpg')
  }

  const ffmpeg = getFfmpegPath()
  if (!ffmpeg) {
    res.status(500).json({ error: 'ffmpeg 不可用' })
    return
  }

  // 先输出到临时文件（保持目标扩展名以便 ffmpeg 识别编码器），成功后再覆盖，避免失败损坏原图
  const ext = extname(outAbs).toLowerCase()
  const tmpAbs = join(dirname(outAbs), `.poster_tmp${ext}`)
  const vf = `crop=iw*${W}:ih*${H}:iw*${X}:ih*${Y}`
  const args = ['-y', '-i', srcAbs, '-vf', vf]
  if (ext === '.jpg' || ext === '.jpeg') args.push('-q:v', '3')
  args.push(tmpAbs)

  execFile(ffmpeg, args, (err) => {
    if (err || !existsSync(tmpAbs)) {
      try {
        if (existsSync(tmpAbs)) unlinkSync(tmpAbs)
      } catch {
        // 忽略清理失败
      }
      console.error('[poster] 裁剪失败', err?.message)
      res.status(500).json({ error: '裁剪海报失败' })
      return
    }
    try {
      renameSync(tmpAbs, outAbs)
    } catch (e) {
      try {
        if (existsSync(tmpAbs)) unlinkSync(tmpAbs)
      } catch {
        // 忽略清理失败
      }
      console.error('[poster] 覆盖失败', (e as Error).message)
      res.status(500).json({ error: '覆盖海报文件失败' })
      return
    }
    try {
      db.prepare("UPDATE movie SET poster = ?, updated_at = datetime('now') WHERE id = ?").run(outRel, id)
      clearImageThumbCache(movie.library_id, outRel)
      res.json({ ok: true, poster: outRel })
    } catch (e) {
      console.error('[poster] 更新数据库失败', (e as Error).message)
      res.status(500).json({ error: '裁剪成功但更新数据库失败' })
    }
  })
})
