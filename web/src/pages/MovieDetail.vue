<script setup lang="ts">
import { computed, onMounted, ref, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Play, Heart, Captions, Pencil, Film, Star, X, ChevronLeft, ChevronRight, ChevronDown, Wrench, Trash2, RefreshCw } from 'lucide-vue-next'
import {
  getMovie,
  getStreamInfo,
  getRelatedMovies,
  toggleFavorite as toggleFavoriteApi,
  refreshMovieMetadata,
  imageUrl,
  streamUrl,
  type Movie,
  type StreamInfo,
} from '../api'
import FanartCard from '../components/FanartCard.vue'
import NfoEditor from '../components/NfoEditor.vue'
import SubtitleModal from '../components/SubtitleModal.vue'
import DeleteMovieModal from '../components/DeleteMovieModal.vue'
import { showToast } from '../toast'

const route = useRoute()
const router = useRouter()
const id = computed(() => Number(route.params.id))

const movie = ref<Movie | null>(null)
const related = ref<Movie[]>([])
const error = ref('')
const editing = ref(false)
const posterVersion = ref(0)
const loading = ref(false)
const subtitleOpen = ref(false)
const manageOpen = ref(false)
const deleteOpen = ref(false)

const playerUrl = ref('')
const playerMode = ref('')
const videoEl = ref<HTMLVideoElement | null>(null)
const titleScrollEl = ref<HTMLDivElement | null>(null)
const titleTextEl = ref<HTMLSpanElement | null>(null)
const titleOverflow = ref(false)
const titleScrollX = ref('0px')

const poster = computed(() => {
  const url = movie.value ? imageUrl(movie.value.library_id, movie.value.poster) : ''
  return url && posterVersion.value ? `${url}?v=${posterVersion.value}` : url
})
const fanart = computed(() => (movie.value ? imageUrl(movie.value.library_id, movie.value.fanart) : ''))
const isStrm = computed(() => (movie.value?.video_path || '').toLowerCase().endsWith('.strm'))
const mainTitle = computed(() => {
  const t = movie.value?.title || ''
  const n = movie.value?.num
  if (n && t.startsWith(n)) return t.slice(n.length).trim()
  return t
})

function formatDuration(min?: number): string {
  if (!min) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h > 0) return m > 0 ? `${h}小时${m}分钟` : `${h}小时`
  return `${m}分钟`
}

function formatSize(bytes?: number): string {
  if (!bytes) return '—'
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1024 ** 2
  return `${mb.toFixed(0)} MB`
}

function formatBitrate(bps?: number): string {
  if (!bps) return ''
  const mbps = bps / 1e6
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`
  return `${Math.round(bps / 1e3)} Kbps`
}

// 下载速度格式化（bit/s → MB/s / KB/s，符合下载工具的显示习惯）
function formatSpeed(bps?: number): string {
  if (!bps) return ''
  const mb = bps / 8 / 1e6
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`
  const kb = bps / 8 / 1e3
  return `${Math.round(kb)} KB/s`
}

const viewerIndex = ref<number | null>(null)
const currentStill = computed(() => {
  if (viewerIndex.value === null || !movie.value) return ''
  const s = movie.value.stills?.[viewerIndex.value]
  return s ? imageUrl(movie.value.library_id, s) : ''
})

function openViewer(i: number) {
  viewerIndex.value = i
}
function closeViewer() {
  viewerIndex.value = null
}
function prevImage() {
  if (viewerIndex.value === null || !movie.value) return
  const len = movie.value.stills?.length || 0
  viewerIndex.value = (viewerIndex.value - 1 + len) % len
}
function nextImage() {
  if (viewerIndex.value === null || !movie.value) return
  const len = movie.value.stills?.length || 0
  viewerIndex.value = (viewerIndex.value + 1) % len
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    movie.value = await getMovie(id.value)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
  loadRelated()
}

async function loadRelated() {
  try {
    related.value = await getRelatedMovies(id.value)
  } catch {
    related.value = []
  }
}

// 检测浏览器是否支持 HEVC（H.265）硬解播放
function supportsHevc(): boolean {
  const v = document.createElement('video')
  return !!(v.canPlayType('video/mp4; codecs="hev1.1.6.L120.90"') || v.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"'))
}

async function play() {
  if (!movie.value) return
  try {
    const info: StreamInfo = await getStreamInfo(id.value, { hevc: supportsHevc() })
    if (info.mode === 'strm' && !info.playable) {
      error.value = '该流地址（' + info.url + '）无法在浏览器中直接播放'
      return
    }
    // 探测后刷新影片信息，拿到刚写入的码率（供网速估算）
    try {
      movie.value = await getMovie(id.value)
    } catch {
      // 刷新失败不影响播放
    }
    downloadSpeed.value = null
    lastBufferedEnd = 0
    lastSampleTime = 0
    playerMode.value = info.mode
    playerUrl.value = streamUrl(info.url)
    await new Promise((r) => setTimeout(r, 50))
    if (info.mode === 'hls') {
      const Hls = (await import('hls.js')).default
      if (videoEl.value && Hls.isSupported()) {
        const hls = new Hls()
        hls.loadSource(playerUrl.value)
        hls.attachMedia(videoEl.value)
      }
    }
  } catch (e) {
    error.value = (e as Error).message
  }
}

watch(playerUrl, async () => {
  await nextTick()
  requestAnimationFrame(() => {
    const scrollEl = titleScrollEl.value
    const text = titleTextEl.value
    if (scrollEl && text) {
      const overflow = text.scrollWidth > scrollEl.clientWidth
      titleOverflow.value = overflow
      titleScrollX.value = overflow ? `-${text.scrollWidth - scrollEl.clientWidth}px` : '0px'
    } else {
      titleOverflow.value = false
    }
  })
})

function filterBy(key: 'actors' | 'genres' | 'tags', name: string) {
  router.push({ path: '/movies', query: { [key]: name } })
}

async function toggleFavorite() {
  if (!movie.value) return
  try {
    const r = await toggleFavoriteApi(movie.value.id)
    movie.value.favorite = r.favorite
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function refreshMetadata() {
  if (!movie.value) return
  manageOpen.value = false
  try {
    await refreshMovieMetadata(movie.value.id)
    await load()
    showToast('元数据已刷新')
  } catch (e) {
    error.value = (e as Error).message
  }
}

function openEditor() {
  editing.value = true
}

function onNfoSaved() {
  posterVersion.value++
  editing.value = false
  load()
}

function onSubtitleDownloaded() {
  load()
}

function onMovieDeleted() {
  deleteOpen.value = false
  router.push('/movies')
}

const containerType = computed(() => movie.value?.video_path?.split('.').pop()?.toUpperCase() || '')

// 编码/分辨率标签（播放时探测后缓存到库，未播过则为空）
const videoInfoLabel = computed(() => {
  const m = movie.value as any
  const codec = m?.video_codec
  const w = m?.video_width
  const h = m?.video_height
  if (!codec && !w && !h) return '—'
  const codecText = codec ? codec.toUpperCase() : ''
  const resText = w && h ? `${w}×${h}` : ''
  return [codecText, resText].filter(Boolean).join(' ')
})

// 码率标签（播放器上显示，未播过则为空）
const bitrateLabel = computed(() => formatBitrate(movie.value?.video_bitrate))

// 实时下载速度（bit/s）：用「缓冲时间增量 × 码率」估算，每秒采样一次
const downloadSpeed = ref<number | null>(null)
let lastBufferedEnd = 0
let lastSampleTime = 0

function onProgress() {
  const v = videoEl.value
  const bitrate = movie.value?.video_bitrate
  if (!v || !bitrate || !v.buffered.length) return
  const end = v.buffered.end(v.buffered.length - 1)
  const now = performance.now()
  if (!lastSampleTime) {
    lastSampleTime = now
    lastBufferedEnd = end
    return
  }
  const dt = (now - lastSampleTime) / 1000
  if (dt >= 1) {
    downloadSpeed.value = end > lastBufferedEnd ? Math.round(((end - lastBufferedEnd) * bitrate) / dt) : 0
    lastBufferedEnd = end
    lastSampleTime = now
  }
}

const speedLabel = computed(() => {
  const s = downloadSpeed.value
  return s ? '↓ ' + formatSpeed(s) : ''
})

onMounted(load)

// 路由参数变化（如点击相关影片跳到另一部详情页）时重新加载
watch(
  () => route.params.id,
  () => {
    playerUrl.value = ''
    playerMode.value = ''
    viewerIndex.value = null
    load()
  },
)
</script>

<template>
  <div>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="loading">加载中…</p>

    <template v-if="movie">
      <!-- 标题 + 操作按钮 -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.6rem">
        <div style="display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap">
          <span v-if="movie.num" class="num-tag">{{ movie.num }}</span>
          <h1 style="color: var(--text-main); font-size: 1.5rem; font-weight: 700">{{ mainTitle }}</h1>
        </div>
        <div style="display: flex; gap: 0.5rem">
          <button class="toolbar-btn" @click="toggleFavorite">
            <Heart :size="16" :color="movie.favorite ? '#ef4444' : 'currentColor'" :fill="movie.favorite ? '#ef4444' : 'none'" />
            收藏
          </button>
          <button class="toolbar-btn" @click="subtitleOpen = true"><Captions :size="16" /> 字幕</button>
          <div style="position: relative">
            <button class="toolbar-btn" @click="manageOpen = !manageOpen"><Wrench :size="16" /> 管理 <ChevronDown :size="14" /></button>
            <div v-if="manageOpen" class="card-menu" style="min-width: 120px; right: 0">
              <button class="card-menu-item" @click="refreshMetadata"><RefreshCw :size="14" /> 刷新元数据</button>
              <button class="card-menu-item" @click="openEditor(); manageOpen = false"><Pencil :size="14" /> 编辑</button>
              <button class="card-menu-item danger" @click="deleteOpen = true; manageOpen = false"><Trash2 :size="14" /> 删除</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 第一行：预览图 + 影片信息 -->
      <div class="detail-top">
        <div class="detail-preview">
          <template v-if="!playerUrl">
            <img :src="fanart || poster" alt="" />
            <span v-if="isStrm" class="strm-badge">STRM</span>
            <div class="preview-play" @click="play">
              <div class="preview-play-btn"><Play :size="26" color="#fff" style="margin-left: 3px" /></div>
            </div>
          </template>
          <video
            v-else
            ref="videoEl"
            :src="playerMode !== 'hls' ? playerUrl : undefined"
            controls
            autoplay
            class="preview-video"
            @progress="onProgress"
          />
          <div v-if="playerUrl" class="video-title-bar">
            <b v-if="movie.num" class="video-title-num">{{ movie.num }}</b>
            <div ref="titleScrollEl" class="video-title-scroll">
              <span
                ref="titleTextEl"
                class="video-title-text"
                :class="{ scroll: titleOverflow }"
                :style="{ '--scroll-x': titleScrollX }"
              >{{ mainTitle }}</span>
            </div>
            <span v-if="bitrateLabel" class="video-bitrate">{{ bitrateLabel }}</span>
            <span v-if="speedLabel" class="video-speed">{{ speedLabel }}</span>
          </div>
        </div>

        <div class="detail-section">
          <h3 class="section-title">影片信息</h3>
          <div class="taxonomy-grid">
            <div class="taxonomy-row"><span class="taxonomy-label">番号</span><span>{{ movie.num || '—' }}</span></div>
            <div class="taxonomy-row"><span class="taxonomy-label">年份</span><span>{{ movie.year ?? '—' }}</span></div>
            <div class="taxonomy-row"><span class="taxonomy-label">评分</span><span><Star :size="14" color="#ffb400" style="vertical-align: -2px" /> {{ movie.rating ?? '—' }}</span></div>
            <div class="taxonomy-row"><span class="taxonomy-label">时长</span><span>{{ formatDuration(movie.runtime) }}</span></div>
            <div class="taxonomy-row"><span class="taxonomy-label">大小</span><span>{{ formatSize(movie.file_size) }}</span></div>
    <div class="taxonomy-row"><span class="taxonomy-label">编码</span><span>{{ videoInfoLabel }}</span></div>
    <div class="taxonomy-row"><span class="taxonomy-label">字幕</span><span>{{ movie.subtitles?.length ? movie.subtitles.length + ' 个' : '无' }}</span></div>
          </div>
        </div>
      </div>

      <!-- 第二行：剧情简介 + 影片要素 -->
      <div class="detail-top">
        <div class="detail-section">
          <h3 class="section-title">剧情简介</h3>
          <p v-if="movie.plot" style="color: var(--text-secondary); line-height: 1.8">{{ movie.plot }}</p>
          <p v-else style="color: var(--text-muted)">暂无简介</p>
          <div style="display: flex; gap: 1rem; margin-top: 0.8rem; color: var(--text-muted); font-size: 0.85rem">
            <span style="flex: 1">文件条目： {{ movie.file_count ?? 0 }}</span>
            <span style="flex: 1">收藏状态：{{ movie.favorite ? '已收藏' : '未收藏' }}</span>
          </div>
        </div>

        <div class="detail-section">
          <h3 class="section-title">影片要素</h3>
          <div class="taxonomy-grid">
            <div class="taxonomy-row" style="align-items: flex-start"><span class="taxonomy-label">分类</span><span style="display: flex; gap: 0.4rem; flex-wrap: wrap"><button v-for="g in movie.genres" :key="g" class="tag-chip" @click="filterBy('genres', g)">{{ g }}</button></span></div>
            <div class="taxonomy-row" style="align-items: flex-start"><span class="taxonomy-label">标签</span><span style="display: flex; gap: 0.4rem; flex-wrap: wrap"><template v-if="movie.tags?.length"><button v-for="t in movie.tags" :key="t" class="tag-chip" @click="filterBy('tags', t)">{{ t }}</button></template><span v-else>—</span></span></div>
            <div class="taxonomy-row" style="align-items: flex-start"><span class="taxonomy-label">演员</span><span style="display: flex; gap: 0.4rem; flex-wrap: wrap">
              <button v-for="a in movie.actors" :key="a.id" class="tag-chip" @click="filterBy('actors', a.name)">{{ a.name }}</button>
            </span></div>
          </div>
        </div>
      </div>

      <!-- 媒体技术信息 -->
      <div class="detail-section" style="margin-bottom: 1rem">
        <h3 class="section-title">媒体技术信息</h3>
        <div class="taxonomy-grid">
          <div class="taxonomy-row"><span class="taxonomy-label">容器类型</span><span>{{ containerType || '—' }}</span></div>
          <div class="taxonomy-row"><span class="taxonomy-label">时长</span><span>{{ movie.runtime ? movie.runtime + ' 分钟' : '—' }}</span></div>
          <div class="taxonomy-row"><span class="taxonomy-label">视频文件</span><span>{{ movie.video_path || '—' }}</span></div>
        </div>
      </div>

      <!-- 文件路径 -->
      <div class="detail-section" style="margin-bottom: 1rem">
        <h3 class="section-title">文件路径</h3>
        <div class="taxonomy-grid">
          <div class="taxonomy-row"><span class="taxonomy-label">视频文件</span><span style="word-break: break-all">{{ movie.video_path || '—' }}</span></div>
          <div class="taxonomy-row"><span class="taxonomy-label">封面图</span><span style="word-break: break-all">{{ movie.poster || '—' }}</span></div>
          <div class="taxonomy-row"><span class="taxonomy-label">画报</span><span style="word-break: break-all">{{ movie.fanart || '—' }}</span></div>
          <div class="taxonomy-row"><span class="taxonomy-label">NFO 文件</span><span style="word-break: break-all">{{ (movie as any).nfo_path || '—' }}</span></div>
          <div class="taxonomy-row" style="align-items: flex-start">
            <span class="taxonomy-label">字幕</span>
            <span v-if="movie.subtitles?.length" style="word-break: break-all; display: flex; flex-direction: column; gap: 0.3rem">
              <span v-for="s in movie.subtitles" :key="s.path">{{ s.path }}</span>
            </span>
            <span v-else>无</span>
          </div>
        </div>
      </div>

      <!-- 剧照 -->
      <div v-if="movie.stills?.length" class="detail-section">
        <h3 class="section-title">剧照</h3>
        <div class="stills-row">
          <img
            v-for="(s, i) in movie.stills"
            :key="s"
            :src="imageUrl(movie.library_id, s)"
            loading="lazy"
            @click="openViewer(i)"
          />
        </div>
      </div>

      <!-- 演员其他参演的影视作品 -->
      <div v-if="related.length" class="detail-section" style="margin-bottom: 1rem">
        <h3 class="section-title">演员其他参演的影视作品</h3>
        <div class="fanart-grid">
          <FanartCard v-for="m in related" :key="m.id" :movie="m" />
        </div>
      </div>

      <!-- 全屏剧照查看器 -->
      <div v-if="viewerIndex !== null" class="viewer-overlay" @click.self="closeViewer">
        <button class="viewer-close" @click="closeViewer"><X :size="20" /></button>
        <button class="viewer-nav viewer-prev" @click="prevImage"><ChevronLeft :size="26" /></button>
        <img :src="currentStill" class="viewer-img" alt="" />
        <button class="viewer-nav viewer-next" @click="nextImage"><ChevronRight :size="26" /></button>
      </div>

      <!-- NFO 编辑弹窗 -->
      <NfoEditor v-if="movie" :movie="movie" :open="editing" @close="editing = false" @saved="onNfoSaved" />
      <SubtitleModal v-if="movie" :movie="movie" :open="subtitleOpen" @close="subtitleOpen = false" @downloaded="onSubtitleDownloaded" />
      <DeleteMovieModal v-if="movie" :movie="movie" :open="deleteOpen" @close="deleteOpen = false" @deleted="onMovieDeleted" />
    </template>

    <div v-else-if="!loading" class="empty-card" style="padding: 4rem">
      <Film :size="42" style="color: #c7c7cc" />
      <div style="margin-top: 0.8rem">影片不存在</div>
    </div>
  </div>
</template>

<style scoped>
.num-tag {
  background: var(--pink);
  color: #fff;
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  flex-shrink: 0;
}
.detail-top {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
  align-items: stretch;
}
.detail-preview {
  position: relative;
  align-self: start;
}
.detail-preview img {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 12px;
}
.preview-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.preview-play-btn {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: rgba(0, 191, 165, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
}
.preview-video {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  display: block;
  border-radius: 12px;
  background: #000;
}
.video-title-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem 0.8rem;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0));
  overflow: hidden;
  pointer-events: none;
  border-radius: 12px 12px 0 0;
  z-index: 2;
}
.video-title-num {
  color: var(--accent);
  font-weight: 600;
  font-size: 0.9rem;
  flex-shrink: 0;
}
.video-bitrate {
  color: #fff;
  font-size: 0.8rem;
  font-weight: 500;
  flex-shrink: 0;
  padding: 0.15rem 0.5rem;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 999px;
  pointer-events: none;
}
.video-speed {
  color: var(--accent);
  font-size: 0.8rem;
  font-weight: 500;
  flex-shrink: 0;
  padding: 0.15rem 0.5rem;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 999px;
  pointer-events: none;
}
.video-title-scroll {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.video-title-text {
  display: inline-block;
  white-space: nowrap;
  color: #fff;
  font-size: 0.9rem;
}
.video-title-text.scroll {
  animation: video-title-scroll 10s ease-in-out infinite;
}
@keyframes video-title-scroll {
  0%,
  25% {
    transform: translateX(0);
  }
  50%,
  75% {
    transform: translateX(var(--scroll-x));
  }
  100% {
    transform: translateX(0);
  }
}
.detail-section {
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.2rem;
}
.section-title {
  font-family: var(--font-heading);
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.8rem;
  color: var(--text-main);
}
.taxonomy-grid {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  color: var(--text-secondary);
  font-size: 0.9rem;
}
.taxonomy-row {
  display: flex;
  gap: 1rem;
  align-items: center;
}
.taxonomy-label {
  color: var(--text-muted);
  min-width: 5rem;
  flex-shrink: 0;
}
.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.8rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-main);
  cursor: pointer;
  font-size: 0.85rem;
  font-family: var(--font-body);
}
.tag-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}
@media (max-width: 768px) {
  .detail-top {
    grid-template-columns: 1fr;
  }
  .fanart-grid {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.7rem;
  }
}
.fanart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
  max-height: 420px;
  overflow-y: auto;
  padding-right: 4px;
}
.stills-row {
  display: flex;
  gap: 0.6rem;
  overflow-x: auto;
  padding-bottom: 0.5rem;
}
.stills-row img {
  width: 200px;
  height: 140px;
  object-fit: cover;
  flex-shrink: 0;
  border-radius: 8px;
  cursor: pointer;
  transition: opacity 0.2s;
}
.stills-row img:hover {
  opacity: 0.85;
}
.viewer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 400;
}
.viewer-img {
  max-width: 88vw;
  max-height: 88vh;
  object-fit: contain;
  border-radius: 6px;
}
.viewer-close {
  position: absolute;
  top: 20px;
  right: 24px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  cursor: pointer;
  z-index: 410;
  display: flex;
  align-items: center;
  justify-content: center;
}
.viewer-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  cursor: pointer;
  z-index: 410;
  display: flex;
  align-items: center;
  justify-content: center;
}
.viewer-prev {
  left: 20px;
}
.viewer-next {
  right: 20px;
}
.viewer-close:hover,
.viewer-nav:hover {
  background: rgba(255, 255, 255, 0.35);
}
</style>
