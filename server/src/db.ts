import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// data 目录位于项目根目录（server/ 的上一级）；可用 XL_DATA_DIR 环境变量覆盖（Docker 挂载用）
const dataDir = process.env.XL_DATA_DIR ?? resolve(__dirname, '../../data')

let db: Database.Database | null = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('film', 'tv')),
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS library_path (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL REFERENCES library(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE(library_id, path)
);
CREATE INDEX IF NOT EXISTS idx_library_path_library ON library_path(library_id);

CREATE TABLE IF NOT EXISTS movie (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL REFERENCES library(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  num TEXT,
  file_size INTEGER,
  original_title TEXT,
  year INTEGER,
  plot TEXT,
  outline TEXT,
  rating REAL,
  votes INTEGER,
  runtime INTEGER,
  mpaa TEXT,
  premiered TEXT,
  poster TEXT,
  fanart TEXT,
  thumb TEXT,
  logo TEXT,
  banner TEXT,
  landscape TEXT,
  trailer TEXT,
  nfo_path TEXT,
  video_path TEXT NOT NULL,
  date_added TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_movie_library ON movie(library_id);
CREATE INDEX IF NOT EXISTS idx_movie_title ON movie(title);

CREATE TABLE IF NOT EXISTS tvshow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL REFERENCES library(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  original_title TEXT,
  year INTEGER,
  plot TEXT,
  rating REAL,
  votes INTEGER,
  premiered TEXT,
  poster TEXT,
  fanart TEXT,
  thumb TEXT,
  nfo_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_tvshow_library ON tvshow(library_id);

CREATE TABLE IF NOT EXISTS episode (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tvshow_id INTEGER NOT NULL REFERENCES tvshow(id) ON DELETE CASCADE,
  season INTEGER,
  episode INTEGER,
  title TEXT,
  plot TEXT,
  rating REAL,
  thumb TEXT,
  still_path TEXT,
  video_path TEXT NOT NULL,
  nfo_path TEXT,
  date_added TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_episode_tvshow ON episode(tvshow_id);
CREATE INDEX IF NOT EXISTS idx_episode_season ON episode(tvshow_id, season, episode);

CREATE TABLE IF NOT EXISTS subtitle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_type TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  language TEXT,
  codec TEXT
);
CREATE INDEX IF NOT EXISTS idx_subtitle_ref ON subtitle(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS image (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_type TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_image_ref ON image(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS actor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS actor_alias (
  actor_id INTEGER NOT NULL REFERENCES actor(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  PRIMARY KEY (actor_id, alias)
);

CREATE TABLE IF NOT EXISTS tag (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS genre (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS country (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS studio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS person (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS movie_actor (
  movie_id INTEGER NOT NULL REFERENCES movie(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES actor(id) ON DELETE CASCADE,
  role TEXT,
  thumb TEXT,
  PRIMARY KEY (movie_id, actor_id)
);

CREATE TABLE IF NOT EXISTS tvshow_actor (
  tvshow_id INTEGER NOT NULL REFERENCES tvshow(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES actor(id) ON DELETE CASCADE,
  role TEXT,
  thumb TEXT,
  PRIMARY KEY (tvshow_id, actor_id)
);

CREATE TABLE IF NOT EXISTS movie_tag (
  movie_id INTEGER NOT NULL REFERENCES movie(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (movie_id, tag_id)
);

CREATE TABLE IF NOT EXISTS tvshow_tag (
  tvshow_id INTEGER NOT NULL REFERENCES tvshow(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (tvshow_id, tag_id)
);

CREATE TABLE IF NOT EXISTS movie_genre (
  movie_id INTEGER NOT NULL REFERENCES movie(id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  PRIMARY KEY (movie_id, genre_id)
);

CREATE TABLE IF NOT EXISTS tvshow_genre (
  tvshow_id INTEGER NOT NULL REFERENCES tvshow(id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  PRIMARY KEY (tvshow_id, genre_id)
);

CREATE TABLE IF NOT EXISTS movie_country (
  movie_id INTEGER NOT NULL REFERENCES movie(id) ON DELETE CASCADE,
  country_id INTEGER NOT NULL REFERENCES country(id) ON DELETE CASCADE,
  PRIMARY KEY (movie_id, country_id)
);

CREATE TABLE IF NOT EXISTS movie_studio (
  movie_id INTEGER NOT NULL REFERENCES movie(id) ON DELETE CASCADE,
  studio_id INTEGER NOT NULL REFERENCES studio(id) ON DELETE CASCADE,
  PRIMARY KEY (movie_id, studio_id)
);

CREATE TABLE IF NOT EXISTS movie_director (
  movie_id INTEGER NOT NULL REFERENCES movie(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  PRIMARY KEY (movie_id, person_id)
);

CREATE TABLE IF NOT EXISTS movie_writer (
  movie_id INTEGER NOT NULL REFERENCES movie(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  PRIMARY KEY (movie_id, person_id)
);

-- 多对多表第二列索引（统计影片数/按标签类型演员筛选时避免全表扫描）
CREATE INDEX IF NOT EXISTS idx_movie_genre_genre ON movie_genre(genre_id);
CREATE INDEX IF NOT EXISTS idx_movie_tag_tag ON movie_tag(tag_id);
CREATE INDEX IF NOT EXISTS idx_movie_actor_actor ON movie_actor(actor_id);
CREATE INDEX IF NOT EXISTS idx_movie_country_country ON movie_country(country_id);
CREATE INDEX IF NOT EXISTS idx_movie_studio_studio ON movie_studio(studio_id);
CREATE INDEX IF NOT EXISTS idx_movie_director_person ON movie_director(person_id);
CREATE INDEX IF NOT EXISTS idx_movie_writer_person ON movie_writer(person_id);

CREATE TABLE IF NOT EXISTS favorite (
  movie_id INTEGER PRIMARY KEY REFERENCES movie(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deleted_movie (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_path_id INTEGER,
  video_path TEXT NOT NULL,
  file_size INTEGER,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deleted_movie_path ON deleted_movie(library_path_id, video_path);
`

export function initDb(): Database.Database {
  if (db) return db
  mkdirSync(dataDir, { recursive: true })
  db = new Database(resolve(dataDir, 'xlcenter.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  // 迁移：给已存在的 movie 表补 num 列（番号）
  const cols = db.prepare('PRAGMA table_info(movie)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'num')) {
    db.exec('ALTER TABLE movie ADD COLUMN num TEXT')
  }
  if (!cols.some((c) => c.name === 'file_size')) {
    db.exec('ALTER TABLE movie ADD COLUMN file_size INTEGER')
  }
  // 迁移：给已存在的 actor 表补 created_at 列
  const actorCols = db.prepare('PRAGMA table_info(actor)').all() as { name: string }[]
  if (!actorCols.some((c) => c.name === 'created_at')) {
    db.exec('ALTER TABLE actor ADD COLUMN created_at TEXT')
  }
  for (const t of ['tag', 'genre']) {
    const cs = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]
    if (!cs.some((c) => c.name === 'created_at')) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN created_at TEXT`)
    }
  }
  // 迁移：多目录支持 —— movie 加 library_path_id 列
  const movieCols = db.prepare('PRAGMA table_info(movie)').all() as { name: string }[]
  if (!movieCols.some((c) => c.name === 'library_path_id')) {
    db.exec('ALTER TABLE movie ADD COLUMN library_path_id INTEGER')
  }
  // 迁移：视频编码/分辨率（播放时探测后缓存，供详情页展示）
  if (!movieCols.some((c) => c.name === 'video_codec')) {
    db.exec('ALTER TABLE movie ADD COLUMN video_codec TEXT')
  }
  if (!movieCols.some((c) => c.name === 'video_width')) {
    db.exec('ALTER TABLE movie ADD COLUMN video_width INTEGER')
  }
  if (!movieCols.some((c) => c.name === 'video_height')) {
    db.exec('ALTER TABLE movie ADD COLUMN video_height INTEGER')
  }
  if (!movieCols.some((c) => c.name === 'video_bitrate')) {
    db.exec('ALTER TABLE movie ADD COLUMN video_bitrate INTEGER')
  }
  // 迁移：旧数据把 library.path 拆进 library_path 表（幂等）
  const oldLibs = db
    .prepare("SELECT id, path FROM library WHERE path IS NOT NULL AND TRIM(path) != ''")
    .all() as { id: number; path: string }[]
  const insPath = db.prepare('INSERT OR IGNORE INTO library_path (library_id, path) VALUES (?, ?)')
  for (const l of oldLibs) insPath.run(l.id, l.path)
  // 迁移：movie 关联 library_path_id（旧库单路径，取该库唯一那条）
  db.exec(
    'UPDATE movie SET library_path_id = (SELECT lp.id FROM library_path lp WHERE lp.library_id = movie.library_id LIMIT 1) WHERE library_path_id IS NULL',
  )
  // 修复：目录被重建导致 library_path_id 悬空时，重新关联到该库当前目录（幂等兜底）
  db.exec(
    'UPDATE movie SET library_path_id = (SELECT lp.id FROM library_path lp WHERE lp.library_id = movie.library_id ORDER BY lp.id LIMIT 1) WHERE library_path_id IS NOT NULL AND library_path_id NOT IN (SELECT id FROM library_path)',
  )
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库未初始化，请先调用 initDb()')
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
