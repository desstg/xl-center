import { Router } from 'express'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, sep, join } from 'node:path'
import { Readable } from 'node:stream'
import { getDb } from '../db.js'
import {
  probeVideo,
  canDirectPlay,
  startTranscode,
  getTranscodeDir,
  isFfmpegAvailable,
  isHardwareAccel,
  touchTranscode,
} from '../ffmpeg.js'

export const streamRouter = Router()

// 播放信息：探测后返回直连/HLS/STRM 的播放地址
streamRouter.get('/info/movie/:id', async (req, res) => {
  const id = Number(req.params.id)
  const db = getDb()
  const movie = db
    .prepare('SELECT m.*, lp.path AS lib_path FROM movie m LEFT JOIN library_path lp ON lp.id = m.library_path_id WHERE m.id = ?')
    .get(id) as Record<string, any> | undefined
  if (!movie) {
    res.status(404).json({ error: '影片不存在' })
    return
  }
  if (!movie.lib_path) {
    res.status(404).json({ error: '视频文件不存在' })
    return
  }

  const videoPath = resolve(movie.lib_path, movie.video_path)
  const subtitles = db
    .prepare('SELECT path, language, codec FROM subtitle WHERE ref_type = ? AND ref_id = ?')
    .all('movie', id)

  // 客户端是否支持 HEVC（由前端检测后通过 ?hevc=1 传入）
  const clientHevc = req.query.hevc === '1'

  // STRM：内容是流地址
  if (movie.video_path.toLowerCase().endsWith('.strm')) {
    let rawUrl = ''
    try {
      rawUrl = readFileSync(videoPath, 'utf-8').trim()
    } catch {
      // 读不到则留空
    }
    const playable = /^https?:\/\//i.test(rawUrl)

    console.log(`[stream] STRM ${id} 请求：rawUrl=${rawUrl} playable=${playable} clientHevc=${clientHevc}`)

    // 有 ffmpeg 时探测 STRM 流编码：HEVC 且客户端不支持 → 转码，其余走代理直连
    if (playable && isFfmpegAvailable()) {
      try {
        const probe = await Promise.race([
          probeVideo(rawUrl),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('探测超时')), 8000)),
        ])
        console.log(`[stream] STRM ${id} 探测成功 codec=${probe.codec} ${probe.width}x${probe.height}`)
        // 缓存编码/分辨率/真实大小到库，供详情页展示
        db.prepare('UPDATE movie SET video_codec=?, video_width=?, video_height=?, video_bitrate=?, file_size=COALESCE(?, file_size) WHERE id=?').run(probe.codec, probe.width, probe.height, probe.bitRate, probe.size > 0 ? probe.size : null, id)
        if (probe.codec === 'hevc' && !clientHevc) {
          // 4K 且无硬件加速时软编会满载 CPU，跳过转码、走代理直连（HEVC 可能黑屏但不崩机器）
          const needScale = (probe.height > 1080) || (probe.width > 1920)
          if (isHardwareAccel() || !needScale) {
            console.log(`[stream] STRM ${id} HEVC 客户端不支持 → 走转码`)
            startTranscode(id, rawUrl, { width: probe.width, height: probe.height })
            res.json({
              mode: 'hls',
              url: `/stream/hls/${id}/index.m3u8`,
              codec: probe.codec,
              title: movie.title,
              subtitles,
            })
            return
          }
          console.log(`[stream] STRM ${id} 4K HEVC 无硬件加速 → 跳过转码走代理`)
        }
        console.log(`[stream] STRM ${id} 走代理直连`)
      } catch (e) {
        console.log(`[stream] STRM ${id} 探测失败/超时 → 回退代理直连：${(e as Error).message}`)
      }
    }

    res.json({
      mode: 'strm',
      // 走后端代理转发，外网浏览器无需直连内网地址
      url: playable ? `/stream/strm/${id}` : rawUrl,
      playable,
      rawUrl,
      title: movie.title,
      subtitles,
    })
    return
  }

  if (!existsSync(videoPath)) {
    res.status(404).json({ error: '视频文件不存在' })
    return
  }

  // 无 ffmpeg：只能尝试直连
  if (!isFfmpegAvailable()) {
    res.json({
      mode: 'direct',
      url: `/stream/file/${movie.library_id}/${movie.video_path}`,
      title: movie.title,
      subtitles,
    })
    return
  }

  try {
    const probe = await probeVideo(videoPath)
    // 缓存编码/分辨率/真实大小到库，供详情页展示
    db.prepare('UPDATE movie SET video_codec=?, video_width=?, video_height=?, video_bitrate=?, file_size=COALESCE(?, file_size) WHERE id=?').run(probe.codec, probe.width, probe.height, probe.bitRate, probe.size > 0 ? probe.size : null, id)
    // HEVC 是否直连取决于客户端能力；其余编码按 canDirectPlay 判断
    const directOk = probe.codec === 'hevc' ? clientHevc : canDirectPlay(probe)
    // 4K 且无硬件加速时软编会满载 CPU，跳过转码、降级直连
    const needScale = (probe.height > 1080) || (probe.width > 1920)
    if (directOk || (!isHardwareAccel() && needScale)) {
      res.json({
        mode: 'direct',
        url: `/stream/file/${movie.library_id}/${movie.video_path}`,
        codec: probe.codec,
        title: movie.title,
        subtitles,
      })
    } else {
      startTranscode(id, videoPath, { width: probe.width, height: probe.height })
      res.json({
        mode: 'hls',
        url: `/stream/hls/${id}/index.m3u8`,
        codec: probe.codec,
        title: movie.title,
        subtitles,
      })
    }
  } catch {
    // 探测失败，降级直连
    res.json({
      mode: 'direct',
      url: `/stream/file/${movie.library_id}/${movie.video_path}`,
      title: movie.title,
      subtitles,
    })
  }
})

// STRM 代理：由后端去拉 STRM 里写的流地址（通常是内网直链），再转发给浏览器。
// 用 fetch 自动跟随 302 跳转（alist 直链常 302 到真实文件地址），外网浏览器无需直连内网。
streamRouter.get('/strm/:movieId', async (req, res) => {
  const id = Number(req.params.movieId)
  const db = getDb()
  const movie = db
    .prepare('SELECT m.video_path, lp.path AS lib_path FROM movie m LEFT JOIN library_path lp ON lp.id = m.library_path_id WHERE m.id = ?')
    .get(id) as Record<string, any> | undefined
  if (!movie || !movie.lib_path) {
    res.status(404).json({ error: '影片不存在' })
    return
  }

  let url = ''
  try {
    url = readFileSync(resolve(movie.lib_path, movie.video_path), 'utf-8').trim()
  } catch {
    // 忽略读取失败
  }
  if (!/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'STRM 流地址无效' })
    return
  }

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    Accept: '*/*',
  }
  if (req.headers.range) headers.Range = req.headers.range

  // 连接/响应头 30 秒超时：上游挂起时主动断开，避免浏览器无限转圈。
  // 一旦拿到响应头就清除超时，后续流式播放不受限（一部电影可能播很久）。
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  // 客户端断开（切页/拖动/停止播放）时取消上游拉流，释放连接，避免下一次播放被占用卡住
  res.on('close', () => controller.abort())

  try {
    const upstream = await fetch(url, { headers, redirect: 'follow', signal: controller.signal })
    clearTimeout(timeout)
    res.status(upstream.status)
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition'] as const) {
      const v = upstream.headers.get(h)
      if (v) res.setHeader(h, v)
    }
    if (upstream.body) {
      const body = Readable.fromWeb(upstream.body as any)
      // abort（客户端断开/超时）时 fromWeb 流会 emit AbortError，吞掉避免未捕获异常导致进程崩溃
      body.on('error', () => {})
      body.pipe(res)
    } else {
      res.end()
    }
  } catch (e) {
    clearTimeout(timeout)
    // 客户端已断开（res 被销毁），无需再写响应，直接返回
    if (res.destroyed || res.writableEnded) return
    console.error(`[stream] STRM 代理拉流失败 movieId=${id}: ${(e as Error)?.message || '连接失败'}`)
    if (!res.headersSent) {
      res.status(502).json({ error: '上游流地址无法访问：' + ((e as Error)?.message || '连接失败') })
    } else {
      res.destroy()
    }
  }
})

// 直连文件流（Express 自动处理 Range 拖动）
streamRouter.get('/file/:libraryId/*', (req, res) => {
  const libraryId = Number(req.params.libraryId)
  const relPath = (req.params as Record<string, string>)[0] ?? ''
  const db = getDb()
  const paths = db
    .prepare('SELECT path FROM library_path WHERE library_id = ? ORDER BY position, id')
    .all(libraryId) as { path: string }[]
  for (const { path } of paths) {
    const libRoot = resolve(path)
    const filePath = resolve(libRoot, relPath)
    if (filePath === libRoot || !filePath.startsWith(libRoot + sep)) continue
    if (existsSync(filePath)) return res.sendFile(filePath)
  }
  res.status(404).json({ error: '文件不存在' })
})

// HLS 输出（index.m3u8 + seg_N.ts）
streamRouter.get('/hls/:movieId/:file', (req, res) => {
  const movieId = Number(req.params.movieId)
  const file = req.params.file
  const dir = getTranscodeDir(movieId)
  if (!dir) {
    res.status(404).json({ error: '转码会话不存在' })
    return
  }
  touchTranscode(movieId)
  if (file.includes('..')) {
    res.status(403).json({ error: '非法路径' })
    return
  }
  const filePath = join(dir, file)
  if (!existsSync(filePath)) {
    res.status(404).json({ error: '分段不存在' })
    return
  }
  res.setHeader('Content-Type', file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t')
  res.sendFile(filePath)
})
