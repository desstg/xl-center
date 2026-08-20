import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import Database from 'better-sqlite3'
import { getDb } from './db.js'
import { parseMovieNfo, type MovieNfo } from './nfo.js'
import { lookupActor } from './actors.js'

const VIDEO_EXTS = new Set([
  '.mp4', '.mkv', '.avi', '.ts', '.m2ts', '.webm', '.mov', '.m4v', '.flv', '.wmv', '.strm',
])
const SUBTITLE_EXTS = new Set(['.srt', '.ass', '.ssa', '.sub', '.vtt'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

interface LibraryRow {
  id: number
  name: string
  path: string
  type: 'film' | 'tv'
}

export interface ScanProgress {
  running: boolean
  manual: boolean
  libraryName: string
  mode: 'scan' | 'refresh'
  total: number
  scanned: number
  added: number
  current: string
}

const progress: ScanProgress = {
  running: false,
  manual: false,
  libraryName: '',
  mode: 'scan',
  total: 0,
  scanned: 0,
  added: 0,
  current: '',
}

export function getScanProgress(): ScanProgress {
  return { ...progress }
}

export interface ScanResult {
  libraryId: number
  libraryName: string
  scanned: number
  movies: number
  tvshows: number
  episodes: number
}

function listDir(p: string): string[] {
  try {
    return readdirSync(p)
  } catch {
    return []
  }
}

// 列出子目录（用 withFileTypes 一次性获取类型，避免对网络盘逐个 statSync）
function listSubdirs(p: string): string[] {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

// 从文件名提取语言标记，如 xxx.zh-CN.ass → zh-CN
function langFromFilename(name: string): string | undefined {
  const base = basename(name, extname(name))
  const m = base.match(/\.([a-zA-Z]{2}(?:-[a-zA-Z]{2})?)$/)
  return m?.[1]
}

// 受控表名白名单
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
  const row = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as
    | { id: number }
    | undefined
  if (row) return row.id
  return Number(db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(name).lastInsertRowid)
}

// 判断某路径本身是否是一个影片文件夹（含视频文件，排除以视频扩展名命名的目录）
function isMovieFolder(p: string): boolean {
  return listDir(p).some((f) => isFile(join(p, f)) && VIDEO_EXTS.has(extname(f).toLowerCase()))
}

// 递归收集目录树中的所有影片文件夹（含视频文件的目录），返回相对库路径的目录列表
function collectMovieFolders(absPath: string, relDir: string, depth: number, maxDepth: number): string[] {
  const result: string[] = []
  if (depth >= maxDepth) return result
  if (isMovieFolder(absPath)) {
    result.push(relDir)
    return result
  }
  for (const sub of listSubdirs(absPath)) {
    const childRel = relDir ? `${relDir}/${sub}` : sub
    result.push(...collectMovieFolders(join(absPath, sub), childRel, depth + 1, maxDepth))
  }
  return result
}

// 扫描一个电影文件夹，返回 movie id；不是有效电影返回 null
function scanMovieFolder(
  db: Database.Database,
  libraryId: number,
  libraryPathId: number,
  folderPath: string,
  relDir: string,
  update = false,
): number | null {
  const folder = folderPath
  const rel = (name: string) => (relDir ? `${relDir}/${name}` : name)
  const entries = listDir(folder)
  if (!entries.length) return null

  const videos = entries.filter((f) => isFile(join(folder, f)) && VIDEO_EXTS.has(extname(f).toLowerCase()))
  if (!videos.length) return null
  const videoFile = videos.find((f) => basename(f, extname(f)) === basename(folderPath)) ?? videos[0]
  const videoBase = basename(videoFile, extname(videoFile))
  let fileSize: number | null = null
  try {
    fileSize = statSync(join(folder, videoFile)).size
  } catch {
    // 忽略获取失败
  }

  const nfos = entries.filter((f) => isFile(join(folder, f)) && extname(f).toLowerCase() === '.nfo')
  const nfoFile = nfos.find((f) => basename(f, extname(f)) === videoBase) ?? nfos[0]

  const poster = entries.find((f) => isFile(join(folder, f)) && /^poster\.(jpg|png|webp)$/i.test(f))
  const fanart = entries.find((f) => isFile(join(folder, f)) && /^(fanart|backdrop|backdrop1)\.(jpg|png|webp)$/i.test(f))
  const thumb = entries.find((f) => isFile(join(folder, f)) && /^thumb\.(jpg|png|webp)$/i.test(f))
  const logo = entries.find((f) => isFile(join(folder, f)) && /^logo\.(png|jpg|webp)$/i.test(f))

  // 无 NFO 的影片：至少要有 fanart 背景图才入库（有 NFO 的不受此限制）
  if (!nfoFile && !fanart) return null

  // 剧照：extrafanart/ 目录 + backdropN.jpg
  const stills: string[] = []
  const extrafanartDir = join(folder, 'extrafanart')
  if (isDir(extrafanartDir)) {
    for (const f of listDir(extrafanartDir)) {
      if (isFile(join(extrafanartDir, f)) && IMAGE_EXTS.has(extname(f).toLowerCase())) stills.push(`extrafanart/${f}`)
    }
  }
  for (const f of entries) {
    if (isFile(join(folder, f)) && /^backdrop\d+\.(jpg|png|webp)$/i.test(f)) stills.push(f)
  }

  const subtitles = entries.filter((f) => isFile(join(folder, f)) && SUBTITLE_EXTS.has(extname(f).toLowerCase()))

  // 解析 NFO
  let nfo: MovieNfo | null = null
  if (nfoFile) {
    try {
      nfo = parseMovieNfo(readFileSync(join(folder, nfoFile), 'utf-8'))
    } catch (e) {
      console.error(`[scanner] 解析 NFO 失败: ${join(folder, nfoFile)}`, (e as Error).message)
    }
  }

  const videoPath = rel(videoFile)
  const title = nfo?.title || basename(folderPath)

  // upsert movie
  const existing = db
    .prepare('SELECT id FROM movie WHERE library_id = ? AND video_path = ?')
    .get(libraryId, videoPath) as { id: number } | undefined

  const common = [
    title,
    nfo?.num ?? null,
    fileSize,
    nfo?.originalTitle ?? null,
    nfo?.year ?? null,
    nfo?.plot ?? null,
    nfo?.outline ?? null,
    nfo?.rating ?? null,
    nfo?.votes ?? null,
    nfo?.runtime ?? null,
    nfo?.mpaa ?? null,
    nfo?.premiered ?? null,
    poster ? rel(poster) : null,
    fanart ? rel(fanart) : null,
    thumb ? rel(thumb) : null,
    logo ? rel(logo) : null,
    nfo?.trailer ?? null,
    nfoFile ? rel(nfoFile) : null,
  ]

  let movieId: number
  if (existing) {
    // 增量扫描（update=false）：已入库影片跳过；刷新元数据（update=true）：仅更新有变化的影片
    if (!update) return null
    movieId = existing.id
    // 变化检测：比较 NFO 解析结果与库内现有元数据，无变化则不算更新
    const old = db
      .prepare(
        'SELECT title, num, file_size, original_title, year, plot, outline, rating, votes, runtime, mpaa, premiered, poster, fanart, thumb, logo, trailer, nfo_path FROM movie WHERE id = ?',
      )
      .get(movieId) as Record<string, unknown>
    const baseFields = ['title', 'num', 'file_size', 'original_title', 'year', 'plot', 'outline', 'rating', 'votes', 'runtime', 'mpaa', 'premiered', 'poster', 'fanart', 'thumb', 'logo', 'trailer', 'nfo_path']
    const changed = baseFields.some((name, i) => (common[i] ?? null) !== (old[name] ?? null))
    if (!changed) return null
    db
      .prepare(
        `UPDATE movie SET title=?, num=?, file_size=?, original_title=?, year=?, plot=?, outline=?, rating=?, votes=?, runtime=?, mpaa=?, premiered=?, poster=?, fanart=?, thumb=?, logo=?, trailer=?, nfo_path=? WHERE id=?`,
      )
      .run(...common, movieId)
  } else {
    const info = db
      .prepare(
        `INSERT INTO movie (library_id, library_path_id, title, num, file_size, original_title, year, plot, outline, rating, votes, runtime,
          mpaa, premiered, poster, fanart, thumb, logo, trailer, nfo_path, video_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(libraryId, libraryPathId, ...common, videoPath)
    movieId = Number(info.lastInsertRowid)
  }

  // 多对多关联：先清后插
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
  db.prepare('DELETE FROM image WHERE ref_type = ? AND ref_id = ?').run('movie', movieId)
  db.prepare('DELETE FROM subtitle WHERE ref_type = ? AND ref_id = ?').run('movie', movieId)

  const link = (table: string, rightCol: string) => {
    const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} (movie_id, ${rightCol}) VALUES (?, ?)`)
    return (rightId: number) => stmt.run(movieId, rightId)
  }
  const linkGenre = link('movie_genre', 'genre_id')
  const linkTag = link('movie_tag', 'tag_id')
  const linkCountry = link('movie_country', 'country_id')
  const linkStudio = link('movie_studio', 'studio_id')
  const linkDirector = link('movie_director', 'person_id')
  const linkWriter = link('movie_writer', 'person_id')

  for (const g of nfo?.genres ?? []) linkGenre(getOrCreateId(db, 'genre', g))
  for (const t of nfo?.tags ?? []) linkTag(getOrCreateId(db, 'tag', t))
  for (const c of nfo?.countries ?? []) linkCountry(getOrCreateId(db, 'country', c))
  for (const s of nfo?.studios ?? []) linkStudio(getOrCreateId(db, 'studio', s))
  for (const d of nfo?.directors ?? []) linkDirector(getOrCreateId(db, 'person', d))
  for (const w of nfo?.writers ?? []) linkWriter(getOrCreateId(db, 'person', w))

  // 演员（含别名归一化）
  const linkActor = db.prepare(
    'INSERT OR IGNORE INTO movie_actor (movie_id, actor_id, role, thumb) VALUES (?, ?, ?, ?)',
  )
  const insAlias = db.prepare('INSERT OR IGNORE INTO actor_alias (actor_id, alias) VALUES (?, ?)')
  for (const a of nfo?.actors ?? []) {
    const mapped = lookupActor(a.name)
    const canonical = mapped?.canonical ?? a.name
    const actorId = getOrCreateId(db, 'actor', canonical)
    if (mapped) {
      for (const alias of mapped.aliases) insAlias.run(actorId, alias)
    }
    linkActor.run(movieId, actorId, a.role ?? null, a.thumb ?? null)
  }

  // 剧照
  const insImage = db.prepare('INSERT INTO image (ref_type, ref_id, kind, path) VALUES (?, ?, ?, ?)')
  for (const s of stills) insImage.run('movie', movieId, 'still', rel(s))

  // 字幕
  const insSub = db.prepare(
    'INSERT INTO subtitle (ref_type, ref_id, path, language, codec) VALUES (?, ?, ?, ?, ?)',
  )
  for (const s of subtitles) {
    insSub.run('movie', movieId, rel(s), langFromFilename(s) ?? null, extname(s).slice(1))
  }

  return movieId
}

async function scanFilmLibrary(libraryId: number, limit?: number): Promise<{ scanned: number; movies: number }> {
  const db = getDb()
  const lib = db.prepare('SELECT * FROM library WHERE id = ?').get(libraryId) as
    | LibraryRow
    | undefined
  if (!lib) throw new Error(`媒体库不存在: ${libraryId}`)

  // 遍历该媒体库的所有目录
  const paths = db
    .prepare('SELECT id, path FROM library_path WHERE library_id = ? ORDER BY position, id')
    .all(libraryId) as { id: number; path: string }[]

  // 递归收集所有影片文件夹（相对库路径的目录），一次性统计 total
  type FolderTarget = { lp: { id: number; path: string }; rel: string }
  const targets: FolderTarget[] = []
  for (const lp of paths) {
    // 已入库影片的目录集合（增量扫描时跳过，避免对网络盘重复 listDir）
    const existingPaths = db
      .prepare('SELECT video_path FROM movie WHERE library_id = ? AND library_path_id = ?')
      .all(libraryId, lp.id) as { video_path: string }[]
    const existingDirs = new Set(
      existingPaths.map((p) => {
        const idx = p.video_path.lastIndexOf('/')
        return idx >= 0 ? p.video_path.slice(0, idx) : ''
      }),
    )

    // 已删除影片的目录 → 删除时的视频文件大小（判断文件是否变化用）
    const deletedRows = db
      .prepare('SELECT video_path, file_size FROM deleted_movie WHERE library_path_id = ?')
      .all(lp.id) as { video_path: string; file_size: number | null }[]
    const deletedByDir = new Map<string, number>()
    for (const d of deletedRows) {
      const idx = d.video_path.lastIndexOf('/')
      const dir = idx >= 0 ? d.video_path.slice(0, idx) : ''
      deletedByDir.set(dir, d.file_size ?? 0)
    }

    for (const rel of collectMovieFolders(lp.path, '', 0, 12)) {
      if (existingDirs.has(rel)) continue
      // 已删除的影片：文件大小没变则跳过（不重新入库），变了则清除记录重新入库
      if (deletedByDir.has(rel)) {
        const folderAbs = join(lp.path, rel)
        let currentSize = 0
        for (const f of listDir(folderAbs)) {
          if (isFile(join(folderAbs, f)) && VIDEO_EXTS.has(extname(f).toLowerCase())) {
            try {
              currentSize = statSync(join(folderAbs, f)).size
            } catch {
              currentSize = 0
            }
            break
          }
        }
        if (currentSize === deletedByDir.get(rel)) continue
        db.prepare('DELETE FROM deleted_movie WHERE library_path_id = ? AND video_path LIKE ?').run(lp.id, rel + '/%')
      }
      targets.push({ lp, rel })
    }
  }
  const finalTargets = limit && limit > 0 ? targets.slice(0, limit) : targets
  progress.total = finalTargets.length

  let scanned = 0
  let movies = 0

  for (const { lp, rel } of finalTargets) {
    scanned++
    progress.scanned++
    progress.current = rel
    if (scanMovieFolder(db, libraryId, lp.id, join(lp.path, rel), rel)) {
      movies++
      progress.added++
    }
    await new Promise((r) => setImmediate(r))
  }
  return { scanned, movies }
}

export async function scanLibrary(libraryId: number, limit?: number): Promise<ScanResult> {
  const db = getDb()
  const lib = db.prepare('SELECT * FROM library WHERE id = ?').get(libraryId) as
    | LibraryRow
    | undefined
  if (!lib) throw new Error(`媒体库不存在: ${libraryId}`)

  let scanned = 0
  let movies = 0
  let tvshows = 0
  let episodes = 0

  if (lib.type === 'film') {
    const r = await scanFilmLibrary(libraryId, limit)
    scanned = r.scanned
    movies = r.movies
  } else {
    throw new Error('剧集库扫描尚未实现')
  }

  return { libraryId, libraryName: lib.name, scanned, movies, tvshows, episodes }
}

// 后台异步扫描所有（或指定）媒体库，进度通过 getScanProgress 查询
export function startScan(libraryId?: number, limit?: number, manual = false): void {
  if (progress.running) return
  progress.running = true
  progress.manual = manual
  progress.mode = 'scan'
  progress.libraryName = ''
  progress.total = 0
  progress.scanned = 0
  progress.added = 0
  progress.current = ''

  setImmediate(async () => {
    try {
      const db = getDb()
      const libs = libraryId
        ? [db.prepare('SELECT * FROM library WHERE id = ?').get(libraryId) as LibraryRow | undefined]
        : (db.prepare('SELECT * FROM library').all() as LibraryRow[])
      for (const lib of libs) {
        if (!lib) continue
        progress.libraryName = lib.name
        if (lib.type === 'film') {
          await scanFilmLibrary(lib.id, limit)
        }
      }
    } catch (e) {
      console.error('[scan] 扫描失败', e)
    } finally {
      progress.running = false
      progress.manual = false
      progress.current = ''
      progress.libraryName = ''
    }
  })
}

// 刷新元数据：重新读取所有影片的 NFO 并更新元数据（不新增影片）
async function refreshFilmLibrary(libraryId: number): Promise<{ scanned: number; updated: number }> {
  const db = getDb()
  const lib = db.prepare('SELECT * FROM library WHERE id = ?').get(libraryId) as
    | LibraryRow
    | undefined
  if (!lib) throw new Error(`媒体库不存在: ${libraryId}`)

  const paths = db
    .prepare('SELECT id, path FROM library_path WHERE library_id = ? ORDER BY position, id')
    .all(libraryId) as { id: number; path: string }[]

  // 递归收集所有影片文件夹，一次性统计总数
  type FolderTarget = { lp: { id: number; path: string }; rel: string }
  const targets: FolderTarget[] = []
  for (const lp of paths) {
    for (const rel of collectMovieFolders(lp.path, '', 0, 12)) {
      targets.push({ lp, rel })
    }
  }
  progress.total = targets.length

  let scanned = 0
  let updated = 0
  for (const { lp, rel } of targets) {
    scanned++
    progress.scanned++
    progress.current = rel
    if (scanMovieFolder(db, libraryId, lp.id, join(lp.path, rel), rel, true)) {
      updated++
      progress.added++
    }
    await new Promise((r) => setImmediate(r))
  }
  return { scanned, updated }
}

// 后台异步刷新元数据（进度通过 getScanProgress 查询，mode = 'refresh'）
export function startRefresh(libraryId?: number, manual = false): void {
  if (progress.running) return
  progress.running = true
  progress.manual = manual
  progress.mode = 'refresh'
  progress.libraryName = ''
  progress.total = 0
  progress.scanned = 0
  progress.added = 0
  progress.current = ''

  setImmediate(async () => {
    try {
      const db = getDb()
      const libs = libraryId
        ? [db.prepare('SELECT * FROM library WHERE id = ?').get(libraryId) as LibraryRow | undefined]
        : (db.prepare('SELECT * FROM library').all() as LibraryRow[])
      for (const lib of libs) {
        if (!lib) continue
        progress.libraryName = lib.name
        if (lib.type === 'film') {
          await refreshFilmLibrary(lib.id)
        }
      }
    } catch (e) {
      console.error('[refresh] 刷新失败', e)
    } finally {
      progress.running = false
      progress.manual = false
      progress.mode = 'scan'
      progress.current = ''
      progress.libraryName = ''
    }
  })
}

// 清理已删除的影片：视频文件已不存在的 movie 记录
export function cleanupMissingMovies(): number {
  const db = getDb()
  const movies = db
    .prepare('SELECT m.id, m.video_path, lp.path AS lib_path FROM movie m JOIN library_path lp ON lp.id = m.library_path_id')
    .all() as { id: number; video_path: string; lib_path: string }[]
  let removed = 0
  for (const m of movies) {
    const fullPath = join(m.lib_path, m.video_path)
    if (!existsSync(fullPath)) {
      db.prepare('DELETE FROM movie WHERE id = ?').run(m.id)
      removed++
    }
  }
  return removed
}

// 刷新单部影片的元数据（详情页「刷新元数据」调用）：重新读取该影片文件夹的 NFO/图片并更新库
export function refreshMovie(movieId: number): boolean {
  const db = getDb()
  const movie = db
    .prepare('SELECT id, library_id, library_path_id, video_path FROM movie WHERE id = ?')
    .get(movieId) as { id: number; library_id: number; library_path_id: number; video_path: string } | undefined
  if (!movie) return false
  const libPath = db.prepare('SELECT path FROM library_path WHERE id = ?').get(movie.library_path_id) as
    | { path: string }
    | undefined
  if (!libPath) return false
  const idx = movie.video_path.lastIndexOf('/')
  const relDir = idx >= 0 ? movie.video_path.slice(0, idx) : ''
  const folderPath = join(libPath.path, relDir)
  return scanMovieFolder(db, movie.library_id, movie.library_path_id, folderPath, relDir, true) !== null
}
