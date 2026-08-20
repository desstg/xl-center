<script setup lang="ts">
import { ref, watch } from 'vue'
import { Search, X, Download } from 'lucide-vue-next'
import { searchSubtitles, downloadSubtitle, type Movie, type SubtitleItem } from '../api'
import { showToast } from '../toast'

const props = defineProps<{
  open: boolean
  movie: Movie
}>()

const emit = defineEmits<{
  close: []
  downloaded: []
}>()

const keyword = ref('')
const items = ref<SubtitleItem[]>([])
const loading = ref(false)
const error = ref('')
const selected = ref<number | null>(null)
const downloading = ref(false)

// 默认关键词：番号优先，其次文件名（不含扩展名），最后标题
function defaultKeyword(): string {
  const m = props.movie
  if (m.num) return m.num
  if (m.video_path) {
    const name = m.video_path.replace(/\\/g, '/').split('/').pop() || ''
    return name.replace(/\.[^.]+$/, '')
  }
  return m.title || ''
}

async function search() {
  const q = keyword.value.trim()
  if (!q) return
  loading.value = true
  error.value = ''
  items.value = []
  selected.value = null
  try {
    items.value = await searchSubtitles(q)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function download() {
  if (selected.value === null) return
  const item = items.value[selected.value]
  if (!item) return
  downloading.value = true
  error.value = ''
  try {
    await downloadSubtitle({
      movieId: props.movie.id,
      url: item.url,
      ext: item.ext,
      lang: langCode(item.langs),
    })
    showToast('字幕下载成功')
    emit('downloaded')
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
    showToast('字幕下载失败')
  } finally {
    downloading.value = false
  }
}

// 语言转简短代码（做字幕文件名后缀）
function langCode(langs: string): string {
  if (langs.includes('简') || langs.includes('中')) return 'zh'
  if (langs.includes('繁')) return 'zh-TW'
  if (langs.includes('英')) return 'en'
  return ''
}

function formatDuration(ms?: number): string {
  if (!ms) return ''
  const min = Math.round(ms / 60000)
  if (min < 1) return ''
  if (min >= 60) {
    const h = Math.floor(min / 60)
    const m = min % 60
    return m > 0 ? `${h}小时${m}分` : `${h}小时`
  }
  return `${min}分钟`
}

function subtitleMeta(item: SubtitleItem): string {
  return [item.langs || '未知语言', item.ext.toUpperCase(), formatDuration(item.duration), item.extraName]
    .filter(Boolean)
    .join(' · ')
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      keyword.value = defaultKeyword()
      items.value = []
      error.value = ''
      selected.value = null
      search()
    }
  },
)
</script>

<template>
  <div v-if="open" class="modal-overlay" @click.self="emit('close')">
    <div class="modal" style="width: 540px">
      <div class="modal-header">
        <span>下载字幕</span>
        <button class="toolbar-btn" @click="emit('close')"><X :size="16" /></button>
      </div>

      <!-- 搜索框 -->
      <div style="padding: 0.8rem 1.2rem; display: flex; gap: 0.5rem; border-bottom: 1px solid var(--border)">
        <div class="sub-search-box">
          <Search :size="16" />
          <input v-model="keyword" placeholder="输入番号或文件名搜索" @keyup.enter="search" />
        </div>
        <button class="glass-button" :disabled="loading" @click="search">{{ loading ? '搜索中…' : '搜索' }}</button>
      </div>

      <!-- 结果列表 -->
      <div class="modal-dirs" style="padding: 0.5rem">
        <p v-if="error" class="err" style="margin: 0.5rem">{{ error }}</p>
        <p v-else-if="loading" style="color: var(--text-muted); padding: 1rem">搜索中…</p>
        <p v-else-if="!items.length" style="color: var(--text-muted); padding: 2rem 1rem; text-align: center">没有匹配的字幕</p>
        <label
          v-for="(item, i) in items"
          :key="item.url"
          class="subtitle-item"
          :class="{ selected: selected === i }"
        >
          <input type="radio" name="subtitle" :checked="selected === i" @change="selected = i" />
          <div class="subtitle-info">
            <div class="subtitle-name">{{ item.name }}</div>
            <div class="subtitle-meta">{{ subtitleMeta(item) }}</div>
          </div>
        </label>
      </div>

      <!-- 底部按钮 -->
      <div class="modal-footer">
        <button class="toolbar-btn" @click="emit('close')">取消</button>
        <button class="glass-button" :disabled="selected === null || downloading" @click="download">
          <Download :size="16" /> {{ downloading ? '下载中…' : '下载' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sub-search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: #fff;
  border: 1px solid #a8e6cf;
  border-radius: 8px;
  padding: 0.3rem 0.5rem;
  color: var(--text-muted);
}
.sub-search-box input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-family: var(--font-body);
  font-size: 0.88rem;
  color: var(--text-main);
}
.subtitle-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
}
.subtitle-item:hover {
  background: var(--bg);
}
.subtitle-item.selected {
  border-color: var(--accent);
  background: rgba(0, 191, 165, 0.06);
}
.subtitle-item input {
  flex-shrink: 0;
  accent-color: var(--accent);
}
.subtitle-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.subtitle-name {
  font-size: 0.9rem;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subtitle-meta {
  font-size: 0.78rem;
  color: var(--text-muted);
}
</style>
