<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  RefreshCw, SlidersHorizontal, LayoutGrid, Heart, Film, ChevronDown,
} from 'lucide-vue-next'
import { getFavorites, type Movie } from '../api'
import { useDropdown } from '../composables/useDropdown'
import { useGridColumns, fillLimit } from '../composables/useGridColumns'
import VideoCard from '../components/VideoCard.vue'
import FanartCard from '../components/FanartCard.vue'

const router = useRouter()
const favorites = ref<Movie[]>([])
const loading = ref(true)
const error = ref('')
const viewMode = ref<'poster' | 'thumb'>(
  localStorage.getItem('xl-favorites-view-mode') === 'thumb' ? 'thumb' : 'poster',
)
const { open: viewMenuOpen, toggle: toggleViewMenu, scheduleClose: scheduleViewClose, clearClose: clearViewClose } = useDropdown()
const page = ref(1)
const jumpPage = ref('')
const { columns } = useGridColumns(viewMode)
const limit = computed(() => fillLimit(viewMode.value === 'poster' ? 72 : 50, columns.value))
const totalPages = () => Math.max(1, Math.ceil(favorites.value.length / limit.value))
const pagedFavorites = computed(() => {
  const start = (page.value - 1) * limit.value
  return favorites.value.slice(start, start + limit.value)
})
const pageList = computed<(number | string)[]>(() => {
  const total = totalPages()
  const current = page.value
  if (total <= 9) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | string)[] = [1]
  const start = Math.max(2, current - 2)
  const end = Math.min(total - 1, current + 2)
  if (start > 2) pages.push('...')
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < total - 1) pages.push('...')
  pages.push(total)
  return pages
})
function go(p: number) {
  page.value = p
  window.scrollTo({ top: 0 })
}
function jump() {
  const p = Number(jumpPage.value)
  if (Number.isInteger(p) && p >= 1 && p <= totalPages()) go(p)
  jumpPage.value = ''
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    favorites.value = (await getFavorites()).map((m) => ({ ...m, favorite: true }))
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function handleFavoriteChanged(id: number, favorite: boolean) {
  if (!favorite) {
    favorites.value = favorites.value.filter((m) => m.id !== id)
    if (page.value > totalPages()) page.value = totalPages()
  }
}

function setView(mode: 'poster' | 'thumb') {
  viewMode.value = mode
  localStorage.setItem('xl-favorites-view-mode', mode)
  viewMenuOpen.value = false
}
// 列数/视图模式变化导致每页数量变化时，修正越界的页码
watch(limit, () => {
  if (page.value > totalPages()) page.value = totalPages()
})

onMounted(load)
</script>

<template>
  <div>
    <!-- 标题 -->
    <div style="margin-bottom: 1rem">
      <h1 style="color: #666; font-size: 1.3rem">收藏夹</h1>
      <p style="color: #999; font-size: 0.88rem; margin-top: 0.25rem">已收藏的影片。</p>
    </div>

    <!-- 工具栏 -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.6rem">
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center">
        <div style="position: relative">
          <button class="toolbar-btn active" @click="toggleViewMenu">
            <LayoutGrid :size="16" /> {{ viewMode === 'poster' ? '海报' : '缩略图' }} <ChevronDown :size="14" />
          </button>
          <div v-if="viewMenuOpen" class="card-menu" style="min-width: 120px" @mouseenter="clearViewClose" @mouseleave="scheduleViewClose">
            <button class="card-menu-item" @click="setView('poster')">海报</button>
            <button class="card-menu-item" @click="setView('thumb')">缩略图</button>
          </div>
        </div>
        <select class="toolbar-btn" style="cursor: pointer">
          <option>收藏·降序</option>
          <option>标题·升序</option>
        </select>
      </div>
      <div style="display: flex; gap: 0.5rem">
        <button class="toolbar-btn" @click="load"><RefreshCw :size="16" /> 刷新</button>
        <button class="toolbar-btn" title="正在建设中..."><SlidersHorizontal :size="16" /> 高级筛选</button>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="loading">加载中…</p>

    <!-- 收藏列表 -->
    <div v-else-if="favorites.length && viewMode === 'poster'" class="video-grid">
      <VideoCard v-for="m in pagedFavorites" :key="m.id" :movie="m" @favorite-changed="handleFavoriteChanged" />
    </div>
    <div v-else-if="favorites.length && viewMode === 'thumb'" class="thumb-grid">
      <FanartCard v-for="m in pagedFavorites" :key="m.id" :movie="m" @favorite-changed="handleFavoriteChanged" />
    </div>

    <!-- 空状态 -->
    <div v-else-if="!loading" class="empty-card" style="padding: 4rem; display: flex; flex-direction: column; align-items: center">
      <Heart :size="42" style="color: #c7c7cc; margin-bottom: 0.9rem" />
      <div style="font-size: 1.1rem; color: #666; margin-bottom: 0.5rem">暂无收藏</div>
      <div style="color: #999; font-size: 0.9rem; margin-bottom: 1.4rem">你还没有标记任何影片，先去影片库挑选想长期追踪的内容。</div>
      <button class="outline-btn" @click="router.push('/movies')"><Film :size="16" /> 浏览影片库</button>
    </div>

    <!-- 分页 -->
    <div v-if="totalPages() > 1" style="display: flex; gap: 0.4rem; justify-content: center; align-items: center; margin-top: 1.5rem; flex-wrap: wrap">
      <button class="toolbar-btn" :disabled="page <= 1" @click="go(page - 1)">上一页</button>
      <template v-for="(p, i) in pageList" :key="i">
        <span v-if="p === '...'" style="align-self: center; color: var(--text-muted)">…</span>
        <button v-else class="toolbar-btn" :class="{ active: p === page }" @click="go(Number(p))">{{ p }}</button>
      </template>
      <button class="toolbar-btn" :disabled="page >= totalPages()" @click="go(page + 1)">下一页</button>
      <span style="display: flex; gap: 0.3rem; align-items: center; margin-left: 0.6rem">
        <span style="color: var(--text-secondary); font-size: 0.85rem">到第</span>
        <input v-model="jumpPage" class="glass-input" style="width: 56px; text-align: center; padding: 0.3rem 0.4rem; border-color: var(--accent)" placeholder="页码" @keyup.enter="jump" />
        <span style="color: var(--text-secondary); font-size: 0.85rem">页</span>
        <button class="toolbar-btn" @click="jump">跳转</button>
      </span>
    </div>
  </div>
</template>
