import { Router } from 'express'
import { createReadStream, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { resolve, sep, extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb } from '../db.js'
import { getFfmpegPath } from '../ffmpeg.js'

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}

// 缩略图缓存目录（项目 data/thumbs，可用 XL_DATA_DIR 覆盖）
const __dirname = dirname(fileURLToPath(import.meta.url))
const thumbDir = process.env.XL_DATA_DIR
  ? join(process.env.XL_DATA_DIR, 'thumbs')
  : resolve(__dirname, '../../data/thumbs')

export const imagesRouter = Router()

// 解析库根路径 + 校验文件，返回 { filePath } 或 null
export function resolveImage(libraryId: number, relPath: string): { filePath: string } | null {
  if (!Number.isInteger(libraryId)) return null
  const db = getDb()
  const paths = db
    .prepare('SELECT path FROM library_path WHERE library_id = ? ORDER BY position, id')
    .all(libraryId) as { path: string }[]
  for (const { path } of paths) {
    const libRoot = resolve(path)
    const filePath = resolve(libRoot, relPath)
    if (filePath === libRoot || !filePath.startsWith(libRoot + sep)) continue
    if (existsSync(filePath)) return { filePath }
  }
  return null
}

// 缩略图：GET /images/thumb/:libraryId/<相对路径>?w=300 —— 用 ffmpeg 缩放并缓存
imagesRouter.get('/thumb/:libraryId/*', (req, res) => {
  const libraryId = Number(req.params.libraryId)
  const relPath = (req.params as Record<string, string>)[0] ?? ''
  const width = Math.min(800, Math.max(50, Number(req.query.w) || 300))

  const resolved = resolveImage(libraryId, relPath)
  if (!resolved) {
    res.status(404).json({ error: '图片不存在' })
    return
  }
  const filePath = resolved.filePath

  const cacheKey = `${libraryId}_${width}_${relPath.replace(/[\\/:]/g, '_')}.jpg`
  const thumbPath = join(thumbDir, cacheKey)

  if (existsSync(thumbPath)) {
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'no-cache')
    createReadStream(thumbPath).pipe(res)
    return
  }

  const ffmpeg = getFfmpegPath()
  if (!ffmpeg) {
    res.setHeader('Content-Type', CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream')
    createReadStream(filePath).pipe(res)
    return
  }

  mkdirSync(thumbDir, { recursive: true })
  execFile(ffmpeg, ['-y', '-i', filePath, '-vf', `scale=${width}:-1`, '-q:v', '3', thumbPath], (err) => {
    if (err || !existsSync(thumbPath)) {
      res.setHeader('Content-Type', CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream')
      createReadStream(filePath).pipe(res)
      return
    }
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'no-cache')
    createReadStream(thumbPath).pipe(res)
  })
})

// 原图：GET /images/:libraryId/<相对路径>
imagesRouter.get('/:libraryId/*', (req, res) => {
  const libraryId = Number(req.params.libraryId)
  const relPath = (req.params as Record<string, string>)[0] ?? ''

  const resolved = resolveImage(libraryId, relPath)
  if (!resolved) {
    res.status(404).json({ error: '图片不存在' })
    return
  }
  const filePath = resolved.filePath

  const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'no-cache')
  createReadStream(filePath).pipe(res)
})

// 清除某张图片的缩略图缓存（海报裁剪后调用，让海报墙立即显示新图）
export function clearImageThumbCache(libraryId: number, relPath: string): void {
  const prefix = `${libraryId}_`
  const suffix = `_${relPath.replace(/[\\/:]/g, '_')}.jpg`
  try {
    for (const f of readdirSync(thumbDir)) {
      if (f.startsWith(prefix) && f.endsWith(suffix)) {
        unlinkSync(join(thumbDir, f))
      }
    }
  } catch {
    // 缓存目录不存在或读取失败则忽略
  }
}
