import { Router } from 'express'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname, basename, extname } from 'node:path'
import { getDb } from '../db.js'

export const subtitlesRouter = Router()

// 迅雷看看字幕搜索接口（私有接口，源自开源插件 MeiamSubtitles）
const THUNDER_API = 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle'

// 搜索字幕：用关键词调迅雷接口，返回按匹配度（Score）降序的字幕列表
subtitlesRouter.get('/subtitles/search', async (req, res) => {
  const query = typeof req.query.query === 'string' ? req.query.query.trim() : ''
  if (!query) {
    res.status(400).json({ error: '缺少搜索关键词' })
    return
  }

  try {
    const url = `${THUNDER_API}?name=${encodeURIComponent(query)}`
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!resp.ok) {
      res.status(502).json({ error: '字幕源请求失败（HTTP ' + resp.status + '）' })
      return
    }
    const data = (await resp.json()) as { code?: number; data?: any[] }
    if (data?.code !== 0 || !Array.isArray(data.data)) {
      res.json({ items: [] })
      return
    }
    const queryLower = query.toLowerCase()
    const items = data.data
      .filter((m: any) => m?.name && m?.url && m?.ext)
      .map((m: any) => {
        // 名称匹配度：去掉扩展名后与关键词完全一致 > 互相包含 > 去特殊字符后包含
        const base = String(m.name).toLowerCase().replace(/\.[^.]+$/, '')
        let match = 0
        if (base === queryLower) match = 3
        else if (base.includes(queryLower) || queryLower.includes(base)) match = 2
        else if (base.includes(queryLower.replace(/[^a-z0-9]/g, ''))) match = 1
        return {
          name: m.name,
          url: m.url,
          ext: String(m.ext).replace(/^\./, '').toLowerCase(),
          langs: Array.isArray(m.languages) ? m.languages.join(', ') : '',
          score: m.score ?? 0,
          duration: m.duration ?? 0,
          extraName: m.extra_name || '',
          match,
        }
      })
      .sort((a: any, b: any) => {
        if (a.match !== b.match) return b.match - a.match
        if (a.duration !== b.duration) return b.duration - a.duration
        return b.score - a.score
      })
    res.json({ items })
  } catch (e) {
    console.error('[subtitle] 搜索失败', (e as Error).message)
    res.status(500).json({ error: '字幕搜索失败：' + (e as Error).message })
  }
})

// 下载字幕：把选中字幕写入影片目录，命名匹配视频文件（播放器可自动加载）
subtitlesRouter.post('/subtitles/download', async (req, res) => {
  const { movieId, url, ext, lang } = (req.body ?? {}) as {
    movieId?: number
    url?: string
    ext?: string
    lang?: string
  }
  if (!movieId || !url || !ext) {
    res.status(400).json({ error: '参数不完整' })
    return
  }
  const db = getDb()
  const movie = db
    .prepare('SELECT m.video_path, lp.path AS lib_path FROM movie m LEFT JOIN library_path lp ON lp.id = m.library_path_id WHERE m.id = ?')
    .get(movieId) as Record<string, any> | undefined
  if (!movie || !movie.lib_path) {
    res.status(404).json({ error: '影片不存在' })
    return
  }

  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!resp.ok) {
      res.status(502).json({ error: '字幕下载失败（HTTP ' + resp.status + '）' })
      return
    }
    const content = await resp.text()
    // 简单校验：非空且不是 HTML/JSON 错误页
    if (!content || content.trim().length < 20) {
      res.status(502).json({ error: '字幕内容为空' })
      return
    }
    const head = content.trimStart().slice(0, 200).toLowerCase()
    if (head.startsWith('<') || head.startsWith('{') || head.startsWith('[')) {
      res.status(502).json({ error: '字幕源返回的不是有效字幕文件' })
      return
    }

    const extNorm = ext.replace(/^\./, '').toLowerCase()
    // 字幕文件写入影片目录，命名匹配视频基础名
    const videoAbs = resolve(movie.lib_path, movie.video_path)
    const dirAbs = dirname(videoAbs)
    const videoBase = basename(videoAbs, extname(videoAbs))
    const langSuffix = lang ? `.${lang}` : ''
    const filename = `${videoBase}${langSuffix}.${extNorm}`
    const outAbs = join(dirAbs, filename)
    mkdirSync(dirAbs, { recursive: true })
    writeFileSync(outAbs, content, 'utf-8')

    // 入库（path 存相对库路径，和扫描器一致）
    const videoRel = movie.video_path.replace(/\\/g, '/')
    const dirRel = dirname(videoRel)
    const subRelPath = dirRel && dirRel !== '.' ? `${dirRel}/${filename}` : filename

    // 同名字幕已存在：只覆盖文件 + 更新记录，避免重复计数
    const existing = db.prepare('SELECT id FROM subtitle WHERE ref_type = ? AND ref_id = ? AND path = ?').get('movie', movieId, subRelPath) as { id: number } | undefined
    if (existing) {
      db.prepare('UPDATE subtitle SET language = ?, codec = ? WHERE id = ?').run(lang ?? null, extNorm, existing.id)
    } else {
      db.prepare('INSERT INTO subtitle (ref_type, ref_id, path, language, codec) VALUES (?, ?, ?, ?, ?)').run('movie', movieId, subRelPath, lang ?? null, extNorm)
    }

    res.json({ ok: true, path: filename })
  } catch (e) {
    console.error('[subtitle] 下载失败', (e as Error).message)
    res.status(500).json({ error: '字幕下载失败：' + (e as Error).message })
  }
})
