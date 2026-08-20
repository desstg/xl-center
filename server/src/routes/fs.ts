import { Router } from 'express'
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const fsRouter = Router()

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/')
}

function listDirs(p: string): { name: string; path: string }[] {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, path: toForwardSlash(join(p, d.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  } catch {
    return []
  }
}

// GET /api/fs/browse?path=...  列出指定路径下的子目录；path 为空时返回盘符（Windows）或根目录（Linux）
fsRouter.get('/fs/browse', (req, res) => {
  const rawPath = typeof req.query.path === 'string' ? req.query.path : ''

  if (!rawPath) {
    if (process.platform === 'win32') {
      const drives: string[] = []
      for (let i = 65; i <= 90; i++) {
        const d = `${String.fromCharCode(i)}:/`
        try {
          if (existsSync(d)) drives.push(d)
        } catch {
          // 忽略不存在的盘符
        }
      }
      res.json({ path: '', parent: null, dirs: drives.map((d) => ({ name: d, path: d })), shortcuts: [] })
    } else {
      // Linux 容器：把常见挂载点作为快捷入口（Docker 里媒体库通常挂在 /media）
      const shortcuts = ['/media', '/mnt'].filter((p) => existsSync(p))
      res.json({ path: '/', parent: null, dirs: listDirs('/'), shortcuts })
    }
    return
  }

  try {
    if (!existsSync(rawPath)) {
      res.status(404).json({ error: '路径不存在' })
      return
    }
    if (!statSync(rawPath).isDirectory()) {
      res.status(400).json({ error: '不是目录' })
      return
    }
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
    return
  }

  const absPath = toForwardSlash(rawPath)
  const parent = toForwardSlash(dirname(rawPath))
  res.json({
    path: absPath,
    parent: parent === absPath ? null : parent,
    dirs: listDirs(rawPath),
    shortcuts: [],
  })
})
