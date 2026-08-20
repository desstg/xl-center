import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { resolve } from 'node:path'
import { loadConfig, type Library, resolveProjectPath } from './config.js'
import { initDb, getDb } from './db.js'
import { apiRouter } from './routes/api.js'
import { imagesRouter } from './routes/images.js'
import { moviesRouter } from './routes/movies.js'
import { fsRouter } from './routes/fs.js'
import { subtitlesRouter } from './routes/subtitles.js'
import { streamRouter } from './routes/stream.js'
import { authRouter, requireAuth } from './routes/auth.js'
import { loadActorMapping, getMappingSize } from './actors.js'
import { startScan, cleanupMissingMovies, getScanProgress } from './scanner.js'
import { detectHardwareAccel, cleanupIdleTranscodes } from './ffmpeg.js'

const config = loadConfig()

const app = express()
app.use(cors())
app.use(express.json())

// 初始化数据库（建 schema + 连接）
initDb()
seedLibraries(config.libraries)
console.log('数据库初始化完成')

// 检测硬件加速能力（VAAPI 硬解，用于 4K HEVC 转码）
await detectHardwareAccel()

// 加载演员映射表（mapping_actor.xml）
if (config.actorIndexFile) {
  try {
    loadActorMapping(resolveProjectPath(config.actorIndexFile))
    console.log(`演员映射表加载完成：${getMappingSize()} 个别名`)
  } catch (e) {
    console.error('演员映射表加载失败：', (e as Error).message)
  }
}

// 健康检查
app.get('/api/health', (_req, res) => {
  const db = getDb()
  const libCount = (db.prepare('SELECT COUNT(*) c FROM library').get() as { c: number }).c
  res.json({
    status: 'ok',
    name: 'XL Center',
    time: new Date().toISOString(),
    libraries: libCount,
  })
})

// 认证：登录接口免认证，其余 /api 需要 token
app.use('/api/auth', authRouter)
app.use('/api', requireAuth)
// API 路由
app.use('/api', apiRouter)
app.use('/api', moviesRouter)
app.use('/api', fsRouter)
app.use('/api', subtitlesRouter)
// 图片服务（img 标签不便带 token，不保护）
app.use('/images', imagesRouter)
// 视频流服务（video 标签不便带 token，不保护）
app.use('/stream', streamRouter)

// 生产模式：托管前端构建产物（web/dist）+ SPA 路由回退（history 路由刷新不 404）
const webDist = resolveProjectPath('web/dist')
app.use(express.static(webDist))
app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  if (req.path.startsWith('/api') || req.path.startsWith('/images') || req.path.startsWith('/stream')) return next()
  res.sendFile(resolve(webDist, 'index.html'))
})

// 统一错误处理
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ error: '服务器内部错误' })
})

app.listen(config.port, config.host, () => {
  console.log(`XL Center server listening on http://${config.host}:${config.port}`)
})

// 定期清理空闲转码会话（客户端停止播放后释放 CPU）
setInterval(() => {
  cleanupIdleTranscodes(30000)
}, 10000)

// 目录监控：定时增量扫描（新增入库）+ 清理已删除影片
setInterval(() => {
  if (getScanProgress().running) return
  try {
    const removed = cleanupMissingMovies()
    startScan()
    if (removed) console.log(`[watch] 清理了 ${removed} 部已删除的影片`)
  } catch (e) {
    console.error('[watch] 监控任务出错', e)
  }
}, 24 * 3600 * 1000)

// 首次启动：若库表为空，把 config.json 的 libraries 作为种子导入
function seedLibraries(libraries: Library[]): void {
  const db = getDb()
  const count = (db.prepare('SELECT COUNT(*) c FROM library').get() as { c: number }).c
  if (count > 0) return
  const stmt = db.prepare('INSERT INTO library (name, path, type) VALUES (?, ?, ?)')
  const insPath = db.prepare('INSERT INTO library_path (library_id, path, position) VALUES (?, ?, 0)')
  for (const lib of libraries) {
    try {
      const info = stmt.run(lib.name, lib.path, lib.type)
      insPath.run(Number(info.lastInsertRowid), lib.path)
    } catch {
      // 忽略重复/无效路径
    }
  }
}
