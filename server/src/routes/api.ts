import { Router } from 'express'
import { getDb } from '../db.js'
import { startScan, startRefresh, getScanProgress } from '../scanner.js'

export const apiRouter = Router()

function validType(t: unknown): t is 'film' | 'tv' {
  return t === 'film' || t === 'tv'
}

// 列出所有媒体库（含条目数 + 最近海报）
apiRouter.get('/libraries', (_req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT l.*,
        CASE l.type
          WHEN 'film' THEN (SELECT COUNT(*) FROM movie WHERE library_id = l.id)
          WHEN 'tv' THEN (SELECT COUNT(*) FROM tvshow WHERE library_id = l.id)
          ELSE 0
        END AS item_count
      FROM library l ORDER BY l.id`,
    )
    .all() as { id: number; posters?: string[]; paths?: string[] }[]
  const posterStmt = db.prepare(
    'SELECT poster FROM movie WHERE library_id = ? AND poster IS NOT NULL ORDER BY date_added DESC LIMIT 5',
  )
  const pathStmt = db.prepare('SELECT path FROM library_path WHERE library_id = ? ORDER BY position, id')
  for (const row of rows) {
    row.posters = (posterStmt.all(row.id) as { poster: string }[]).map((p) => p.poster)
    row.paths = (pathStmt.all(row.id) as { path: string }[]).map((p) => p.path)
  }
  res.json(rows)
})

// 添加媒体库
apiRouter.post('/libraries', (req, res) => {
  const { name, path, paths, type } = (req.body ?? {}) as {
    name?: string
    path?: string
    paths?: string[]
    type?: string
  }
  // 目录：优先 paths 数组，兼容旧版单 path
  const rawPaths = Array.isArray(paths) ? paths : path ? [path] : []
  const pathList = rawPaths.map((p) => String(p).trim()).filter(Boolean)
  if (!name?.trim() || !pathList.length || !validType(type)) {
    res.status(400).json({ error: 'name/paths 必填，type 需为 film 或 tv' })
    return
  }
  const db = getDb()
  try {
    const info = db
      .prepare('INSERT INTO library (name, path, type) VALUES (?, ?, ?)')
      .run(name.trim(), pathList[0], type)
    const libId = Number(info.lastInsertRowid)
    const ins = db.prepare('INSERT INTO library_path (library_id, path, position) VALUES (?, ?, ?)')
    pathList.forEach((p, i) => ins.run(libId, p, i))
    const row = db.prepare('SELECT * FROM library WHERE id = ?').get(libId)
    res.status(201).json(row)
  } catch (e) {
    if ((e as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: '该路径已存在媒体库' })
      return
    }
    throw e
  }
})

// 修改媒体库
apiRouter.put('/libraries/:id', (req, res) => {
  const id = Number(req.params.id)
  const db = getDb()
  const existing = db.prepare('SELECT * FROM library WHERE id = ?').get(id) as
    | { name: string; path: string; type: string }
    | undefined
  if (!existing) {
    res.status(404).json({ error: '媒体库不存在' })
    return
  }
  const { name, path, paths, type } = (req.body ?? {}) as {
    name?: string
    path?: string
    paths?: string[]
    type?: string
  }
  const newName = name?.trim() || existing.name
  const newType = type ?? existing.type
  if (!validType(newType)) {
    res.status(400).json({ error: 'type 需为 film 或 tv' })
    return
  }
  db.prepare('UPDATE library SET name = ?, type = ? WHERE id = ?').run(newName, newType, id)
  // 目录增量更新：传了 paths/path 才处理；保留的目录 id 不变，被移除的目录连同其影片一起删除
  const rawPaths = Array.isArray(paths) ? paths : path ? [path] : undefined
  if (rawPaths !== undefined) {
    const pathList = rawPaths.map((p) => String(p).trim()).filter(Boolean)
    if (!pathList.length) {
      res.status(400).json({ error: 'paths 不能为空' })
      return
    }
    const oldPaths = db.prepare('SELECT id, path FROM library_path WHERE library_id = ?').all(id) as {
      id: number
      path: string
    }[]
    const oldMap = new Map(oldPaths.map((p) => [p.path, p.id]))
    const newSet = new Set(pathList)
    // 被移除的目录：删除其下的影片 + 目录记录
    for (const op of oldPaths) {
      if (!newSet.has(op.path)) {
        db.prepare('DELETE FROM movie WHERE library_path_id = ?').run(op.id)
        db.prepare('DELETE FROM library_path WHERE id = ?').run(op.id)
      }
    }
    // 新增目录 / 更新保留目录的 position
    const ins = db.prepare('INSERT INTO library_path (library_id, path, position) VALUES (?, ?, ?)')
    const upd = db.prepare('UPDATE library_path SET position = ? WHERE id = ?')
    pathList.forEach((p, i) => {
      const oldId = oldMap.get(p)
      if (oldId !== undefined) {
        upd.run(i, oldId)
      } else {
        ins.run(id, p, i)
      }
    })
    db.prepare('UPDATE library SET path = ? WHERE id = ?').run(pathList[0], id)
  }
  res.json(db.prepare('SELECT * FROM library WHERE id = ?').get(id))
})

// 删除媒体库（级联删除其中条目）
apiRouter.delete('/libraries/:id', (req, res) => {
  const id = Number(req.params.id)
  const db = getDb()
  const existing = db.prepare('SELECT * FROM library WHERE id = ?').get(id)
  if (!existing) {
    res.status(404).json({ error: '媒体库不存在' })
    return
  }
  db.prepare('DELETE FROM library WHERE id = ?').run(id)
  res.json({ ok: true })
})

// 触发扫描：POST /api/scan?limit=N   body 可选 { libraryId }；不传则扫描所有库
apiRouter.post('/scan', (req, res) => {
  const { libraryId } = (req.body ?? {}) as { libraryId?: number }
  const limitRaw = req.query.limit as string | undefined
  const limit = limitRaw ? Number(limitRaw) : undefined
  // 后台异步扫描（手动触发）
  startScan(libraryId, limit, true)
  res.json({ started: true })
})

// 刷新元数据：重新读取影片 NFO 更新元数据（后台异步）
apiRouter.post('/libraries/:id/refresh', (req, res) => {
  const id = Number(req.params.id)
  startRefresh(id, true)
  res.json({ started: true })
})

// 扫描进度
apiRouter.get('/scan/status', (_req, res) => {
  res.json(getScanProgress())
})
