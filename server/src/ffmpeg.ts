import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// ffmpeg/ffprobe 二进制：优先用环境变量（Docker 里指向系统 ffmpeg，带 VAAPI 硬解），
// 否则回退 @ffmpeg-installer 平台包；都失败则降级「无转码」，避免进程崩溃
let FFMPEG_PATH = process.env.FFMPEG_PATH || ''
let FFPROBE_PATH = process.env.FFPROBE_PATH || ''
try {
  if (!FFMPEG_PATH) FFMPEG_PATH = require('@ffmpeg-installer/ffmpeg').path
  if (!FFPROBE_PATH) FFPROBE_PATH = require('@ffprobe-installer/ffprobe').path
} catch (e) {
  console.error('[ffmpeg] ffmpeg/ffprobe 二进制加载失败，转码功能将不可用：', (e as Error).message)
}

export function isFfmpegAvailable(): boolean {
  return !!FFMPEG_PATH && !!FFPROBE_PATH
}

export function getFfmpegPath(): string | null {
  return FFMPEG_PATH || null
}

// 硬件加速能力：'vaapi' 或 'none'（启动时检测一次）
let hwAccel: 'vaapi' | 'none' = 'none'
// 检测到的 VAAPI 设备路径（不同机器核显设备号可能不同，如 renderD128/renderD129）
let vaapiDevice = '/dev/dri/renderD128'

/** 检测 VAAPI 硬件加速是否可用（启动时调用一次），自动遍历 /dev/dri/renderD* 找第一个可用的设备 */
export function detectHardwareAccel(): Promise<void> {
  if (!FFMPEG_PATH) {
    hwAccel = 'none'
    return Promise.resolve()
  }
  // 列出 /dev/dri 下的 renderD* 设备，按编号排序逐个尝试
  let devices: string[] = []
  try {
    devices = readdirSync('/dev/dri')
      .filter((f) => /^renderD\d+$/.test(f))
      .sort()
      .map((f) => `/dev/dri/${f}`)
  } catch {
    devices = []
  }
  if (!devices.length) devices = ['/dev/dri/renderD128'] // 目录读不到时仍试默认路径兜底

  return new Promise((resolve) => {
    const tryDevice = (idx: number): void => {
      if (idx >= devices.length) {
        hwAccel = 'none'
        console.log('[ffmpeg] 硬件加速：不可用（未找到可用的 VAAPI 设备，回退软编）')
        resolve()
        return
      }
      const dev = devices[idx]
      execFile(
        FFMPEG_PATH,
        ['-hide_banner', '-vaapi_device', dev, '-f', 'lavfi', '-i', 'nullsrc=s=128x128:d=1', '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-f', 'null', '-'],
        (err, _stdout, stderr) => {
          if (!err) {
            hwAccel = 'vaapi'
            vaapiDevice = dev
            console.log(`[ffmpeg] 硬件加速：VAAPI 可用（设备 ${dev}）`)
            resolve()
          } else {
            console.log(`[ffmpeg] VAAPI 设备 ${dev} 不可用，尝试下一个`)
            tryDevice(idx + 1)
          }
        },
      )
    }
    tryDevice(0)
  })
}

export interface ProbeResult {
  codec: string
  audioCodec: string
  container: string
  width: number
  height: number
  duration: number
  size: number
  bitRate: number
}

export function probeVideo(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const isUrl = /^https?:\/\//i.test(filePath)
    const args = ['-v', 'quiet']
    // http 流（STRM 内网直链）加浏览器 UA，避免被上游（如 alist）拒绝
    if (isUrl) args.push('-user_agent', 'Mozilla/5.0')
    args.push('-print_format', 'json', '-show_format', '-show_streams', filePath)
    execFile(
      FFPROBE_PATH,
      args,
      (err, stdout) => {
        if (err) return reject(err)
        try {
          const info = JSON.parse(stdout)
          const video = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'video')
          const audio = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'audio')
          const duration = parseFloat(info.format?.duration ?? '0')
          const size = Number(info.format?.size ?? 0)
          // 码率：优先 ffprobe 的 format.bit_rate，缺失时用 大小×8÷时长 估算
          const bitRate = Number(info.format?.bit_rate ?? 0) || (size > 0 && duration > 0 ? Math.round((size * 8) / duration) : 0)
          resolve({
            codec: video?.codec_name ?? '',
            audioCodec: audio?.codec_name ?? '',
            container: info.format?.format_name?.split(',')[0] ?? '',
            width: video?.width ?? 0,
            height: video?.height ?? 0,
            duration,
            size,
            bitRate,
          })
        } catch (e) {
          reject(e)
        }
      },
    )
  })
}

export function isHardwareAccel(): boolean {
  return hwAccel === 'vaapi'
}

export function canDirectPlay(probe: ProbeResult): boolean {
  const containerOk = ['mp4', 'webm', 'mov', 'm4v'].includes(probe.container)
  // h264/av1/vp9/vp8 现代浏览器普遍支持；hevc 移出白名单，是否直连由客户端能力决定（见 stream.ts）
  const codecOk = ['h264', 'av1', 'vp9', 'vp8'].includes(probe.codec)
  return containerOk && codecOk
}

// ---------- HLS 转码会话 ----------

interface TranscodeSession {
  dir: string
  proc: ChildProcess
  lastAccess: number
}

const sessions = new Map<number, TranscodeSession>()

export interface TranscodeOptions {
  width?: number
  height?: number
}

/** 启动 HLS 转码（如已存在会话则复用），返回输出目录 */
export function startTranscode(movieId: number, filePath: string, opts: TranscodeOptions = {}): string {
  const existing = sessions.get(movieId)
  if (existing) return existing.dir

  const dir = mkdtempSync(join(tmpdir(), 'xlcenter-hls-'))
  const m3u8 = join(dir, 'index.m3u8')

  // 源分辨率超过 1080p 时降到 1080p
  const needScale = (opts.height ?? 0) > 1080 || (opts.width ?? 0) > 1920

  const buildArgs = (useVaapi: boolean): string[] => {
    const a: string[] = ['-y']
    if (useVaapi) {
      // VAAPI 硬解（快）+ 后续 hwdownload 到 CPU 做缩放/格式转换，绕过 VAAPI 不支持的 10bit→8bit 转换
      a.push('-vaapi_device', vaapiDevice, '-hwaccel', 'vaapi', '-hwaccel_device', vaapiDevice, '-hwaccel_output_format', 'vaapi')
    }
    // http 流（STRM 内网直链）加浏览器 UA，避免被上游（如 alist）拒绝
    if (/^https?:\/\//i.test(filePath)) a.push('-user_agent', 'Mozilla/5.0')
    a.push('-i', filePath)
    if (useVaapi) {
      // 硬解 → hwdownload 到 CPU → scale 缩放 → format=nv12 转 8bit → hwupload 回 GPU → 硬编
      const scaleFilter = needScale
        ? 'scale=1920:1080:force_original_aspect_ratio=decrease'
        : 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
      a.push('-vf', 'hwdownload,' + scaleFilter + ',format=nv12,hwupload')
      // Gemini Lake 的 VAAPI 驱动只支持 CQP 码控，用 -qp 而非 -b:v
      a.push('-c:v', 'h264_vaapi', '-qp', '23')
    } else {
      if (needScale) a.push('-vf', 'scale=w=1920:h=1080:force_original_aspect_ratio=decrease')
      a.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23')
    }
    a.push(
      '-c:a', 'aac',
      '-b:a', '128k',
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_list_size', '0',
      '-hls_segment_filename', join(dir, 'seg_%03d.ts'),
      m3u8,
    )
    return a
  }

  const launch = (useVaapi: boolean): ChildProcess => {
    const proc = spawn(FFMPEG_PATH, buildArgs(useVaapi), { stdio: ['ignore', 'ignore', 'pipe'] })
    let errBuf = ''
    proc.stderr?.on('data', (d: Buffer) => {
      errBuf += d.toString()
      if (errBuf.length > 2000) errBuf = errBuf.slice(-1000)
    })
    proc.on('error', (e) => console.error('[transcode] ffmpeg 启动失败', e.message))
    proc.on('exit', (code) => {
      if (code && code !== 0) {
        if (useVaapi) {
          // VAAPI 失败，回退软编（但 4K 软编会满载 CPU，直接放弃）
          console.error('[transcode] VAAPI 转码失败。stderr:', errBuf.slice(-400))
          if (needScale) {
            console.error('[transcode] 4K 且 VAAPI 失败，不软编（避免 CPU 满载）')
            sessions.delete(movieId)
          } else {
            console.error('[transcode] 回退软编')
            sessions.set(movieId, { dir, proc: launch(false), lastAccess: Date.now() })
          }
        } else {
          sessions.delete(movieId)
          console.error('[transcode] 软编退出码', code, 'stderr:', errBuf.slice(-400))
        }
      } else {
        sessions.delete(movieId)
      }
    })
    return proc
  }

  console.log(`[transcode] 启动转码 movieId=${movieId} mode=${hwAccel === 'vaapi' ? 'VAAPI' : '软编'} src=${filePath}`)
  const proc = launch(hwAccel === 'vaapi')
  sessions.set(movieId, { dir, proc, lastAccess: Date.now() })

  return dir
}

export function getTranscodeDir(movieId: number): string | undefined {
  return sessions.get(movieId)?.dir
}

export function stopTranscode(movieId: number): void {
  const s = sessions.get(movieId)
  if (s) {
    s.proc.kill()
    sessions.delete(movieId)
  }
}

/** 更新转码会话的最近访问时间（HLS 分段被请求时调用） */
export function touchTranscode(movieId: number): void {
  const s = sessions.get(movieId)
  if (s) s.lastAccess = Date.now()
}

/** 清理空闲转码会话（客户端停止请求分段超过 idleMs 毫秒后停止转码，释放 CPU） */
export function cleanupIdleTranscodes(idleMs = 30000): void {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (now - s.lastAccess > idleMs) {
      s.proc.kill()
      sessions.delete(id)
      console.log(`[transcode] 清理空闲会话 movieId=${id}`)
    }
  }
}
