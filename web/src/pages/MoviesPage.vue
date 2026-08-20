<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  RefreshCw, SlidersHorizontal, LayoutGrid, Search, Film, ChevronDown, Folder, X,
} from 'lucide-vue-next'
import { getMovies, getGenres, getLibraries, type Movie, type Library, type TaxonomyItem } from '../api'
import { useDropdown } from '../composables/useDropdown'
import { useGridColumns, fillLimit } from '../composables/useGridColumns'
import VideoCard from '../components/VideoCard.vue'
import FanartCard from '../components/FanartCard.vue'

const route = useRoute()
const router = useRouter()

const movies = ref<Movie[]>([])
const total = ref(0)
const page = ref(1)
const viewMode = ref<'poster' | 'thumb'>(
  localStorage.getItem('xl-movies-view-mode') === 'thumb' ? 'thumb' : 'poster',
)
const { open: viewMenuOpen, toggle: toggleViewMenu, scheduleClose: scheduleViewClose, clearClose: clearViewClose } = useDropdown()
const { columns } = useGridColumns(viewMode)
const limit = computed(() => fillLimit(viewMode.value === 'poster' ? 72 : 50, columns.value))
const loading = ref(false)
const error = ref('')

const q = ref('')
const genre = ref('')
const actors = ref('')
const tags = ref('')
const num = ref('')
const filename = ref('')
const sort = ref('title')
const showAdvanced = ref(false)

const genres = ref<TaxonomyItem[]>([])
const libraries = ref<Library[]>([])
const selectedLibrary = ref<number>(0)
const { open: libMenuOpen, toggle: toggleLibMenu, scheduleClose: scheduleLibClose, clearClose: clearLibClose } = useDropdown()
const selectedLibraryName = computed(() => {
  if (selectedLibrary.value === 0) return '媒体库'
  return libraries.value.find((l) => l.id === selectedLibrary.value)?.name || '媒体库'
})

function selectLibrary(id: number) {
  selectedLibrary.value = id
  libMenuOpen.value = false
  page.value = 1
  load()
}

const sortOptions = [
  { label: '标题·升序', value: 'title' },
  { label: '最近添加', value: 'date_added' },
  { label: '评分', value: 'rating' },
  { label: '年份', value: 'year' },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await getMovies({
      q: q.value,
      genres: genre.value,
      actors: actors.value,
      tags: tags.value,
      num: num.value,
      filename: filename.value,
      library: selectedLibrary.value || undefined,
      sort: sort.value,
      page: page.value,
      limit: limit.value,
    })
    movies.value = r.items
    total.value = r.total
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  page.value = 1
  router.replace({
    query: {
      ...route.query,
      q: q.value || undefined,
      genres: genre.value || undefined,
      actors: actors.value || undefined,
      tags: tags.value || undefined,
    },
  })
  load()
}

const activeFilters = computed(() => {
  const filters: { key: string; label: string; value: string }[] = []
  if (q.value) filters.push({ key: 'q', label: '影片', value: q.value })
  if (num.value) filters.push({ key: 'num', label: '番号', value: num.value })
  if (actors.value) filters.push({ key: 'actors', label: '演员', value: actors.value })
  if (filename.value) filters.push({ key: 'filename', label: '文件名', value: filename.value })
  if (genre.value) filters.push({ key: 'genres', label: '类型', value: genre.value })
  if (tags.value) filters.push({ key: 'tags', label: '标签', value: tags.value })
  return filters
})

function removeFilter(key: string) {
  if (key === 'q') q.value = ''
  else if (key === 'num') num.value = ''
  else if (key === 'actors') actors.value = ''
  else if (key === 'filename') filename.value = ''
  else if (key === 'genres') genre.value = ''
  else if (key === 'tags') tags.value = ''
  page.value = 1
  load()
}

function clearFilters() {
  q.value = ''
  genre.value = ''
  actors.value = ''
  tags.value = ''
  num.value = ''
  filename.value = ''
  selectedLibrary.value = 0
  page.value = 1
  router.replace({ path: '/movies' })
  load()
}

function go(p: number) {
  page.value = p
  load()
  window.scrollTo({ top: 0 })
}

function setView(mode: 'poster' | 'thumb') {
  viewMode.value = mode
  localStorage.setItem('xl-movies-view-mode', mode)
  viewMenuOpen.value = false
}

const totalPages = () => Math.max(1, Math.ceil(total.value / limit.value))
const jumpPage = ref('')

const pageList = computed<(number | string)[]>(() => {
  const total = totalPages()
  const current = page.value
  if (total <= 9) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const pages: (number | string)[] = [1]
  const start = Math.max(2, current - 2)
  const end = Math.min(total - 1, current + 2)
  if (start > 2) pages.push('...')
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < total - 1) pages.push('...')
  pages.push(total)
  return pages
})

function jump() {
  const p = Number(jumpPage.value)
  if (Number.isInteger(p) && p >= 1 && p <= totalPages()) {
    go(p)
  }
  jumpPage.value = ''
}

function syncFromQuery() {
  q.value = route.query.q ? String(route.query.q) : ''
  genre.value = route.query.genres ? String(route.query.genres) : ''
  actors.value = route.query.actors ? String(route.query.actors) : ''
  tags.value = route.query.tags ? String(route.query.tags) : ''
  num.value = route.query.num ? String(route.query.num) : ''
  filename.value = route.query.filename ? String(route.query.filename) : ''
  selectedLibrary.value = route.query.library ? Number(route.query.library) : 0
}

onMounted(async () => {
  genres.value = (await getGenres(undefined, 1, 200)).items
  libraries.value = await getLibraries()
  syncFromQuery()
  load()
})

// 顶部搜索栏在 /movies 页面内搜索时 path 不变、仅 query 变，组件复用需手动响应
watch(
  () => route.query,
  () => {
    syncFromQuery()
    page.value = 1
    load()
  },
)
// 列数/视图模式变化导致每页数量变化时，保持当前页重新加载（越界则回退到最后有效页）
watch(limit, () => {
  if (page.value > totalPages()) page.value = totalPages()
  load()
})
</script>

<template>
  <div>
    <!-- 标题 -->
    <div style="margin-bottom: 1rem">
      <h1 style="color: #666; font-size: 1.3rem">
        影片库 <span style="color: #999; font-size: 0.8em; font-weight: 400">[{{ total }}]</span>
      </h1>
      <div v-if="activeFilters.length" style="display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.5rem">
        <span v-for="f in activeFilters" :key="f.key" class="filter-tag">
          {{ f.label }}：{{ f.value }}
          <button class="filter-tag-x" @click="removeFilter(f.key)">×</button>
        </span>
      </div>
      <p style="color: #999; font-size: 0.88rem; margin-top: 0.25rem">影片列表</p>
    </div>

    <!-- 工具栏 -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.6rem">
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center">
        <div style="position: relative">
          <button class="toolbar-btn active" @click="toggleViewMenu">
            <LayoutGrid :size="16" /> {{ viewMode === 'poster' ? '海报' : '缩略图' }} <ChevronDown :size="14" />
          </button>
          <div v-if="viewMenuOpen" class="card-menu" style="min-width: 120px" @mouseenter="clearViewClose" @mouseleave="scheduleViewClose">
            <button class="card-menu-item" :class="{ active: viewMode === 'poster' }" @click="setView('poster')">海报</button>
            <button class="card-menu-item" :class="{ active: viewMode === 'thumb' }" @click="setView('thumb')">缩略图</button>
          </div>
        </div>
        <select v-model="sort" class="toolbar-btn" style="cursor: pointer" @change="load">
          <option v-for="s in sortOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
        <div style="position: relative">
          <button class="toolbar-btn" @click="toggleLibMenu">
            <Folder :size="16" /> {{ selectedLibraryName }} <ChevronDown :size="14" />
          </button>
          <div v-if="libMenuOpen" class="card-menu" style="min-width: 140px" @mouseenter="clearLibClose" @mouseleave="scheduleLibClose">
            <button class="card-menu-item" :class="{ active: selectedLibrary === 0 }" @click="selectLibrary(0)">全部</button>
            <button v-for="lib in libraries" :key="lib.id" class="card-menu-item" :class="{ active: selectedLibrary === lib.id }" @click="selectLibrary(lib.id)">{{ lib.name }}</button>
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem">
        <button v-if="activeFilters.length" class="toolbar-btn clear-btn" @click="clearFilters"><X :size="15" /> 清空</button>
        <button class="toolbar-btn" @click="load"><RefreshCw :size="16" /> 刷新</button>
        <button class="toolbar-btn" :class="{ active: showAdvanced }" @click="showAdvanced = !showAdvanced">
          <SlidersHorizontal :size="16" /> 高级筛选
        </button>
      </div>
    </div>

    <!-- 高级筛选面板 -->
    <div v-if="showAdvanced" class="glass-panel" style="padding: 1rem; margin-bottom: 1.25rem; display: flex; gap: 0.7rem; flex-wrap: wrap; align-items: center">
      <div class="search-box" style="flex: 1; min-width: 200px">
        <Search :size="16" />
        <input v-model="q" placeholder="搜索影片标题..." @keyup.enter="applyFilters" />
      </div>
      <select v-model="genre" class="glass-select">
        <option value="">全部类型</option>
        <option v-for="g in genres" :key="g.id" :value="g.name">{{ g.name }}（{{ g.movie_count }}）</option>
      </select>
      <input v-model="actors" class="glass-input" style="min-width: 130px" placeholder="演员…" @keyup.enter="applyFilters" />
      <input v-model="tags" class="glass-input" style="min-width: 130px" placeholder="标签…" @keyup.enter="applyFilters" />
      <button class="glass-button" @click="applyFilters">筛选</button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="loading">加载中…</p>

    <!-- 影片网格 -->
    <div v-else-if="movies.length && viewMode === 'poster'" class="video-grid">
      <VideoCard v-for="m in movies" :key="m.id" :movie="m" />
    </div>
    <div v-else-if="movies.length && viewMode === 'thumb'" class="thumb-grid">
      <FanartCard v-for="m in movies" :key="m.id" :movie="m" />
    </div>

    <!-- 空白状态 -->
    <div v-else-if="!loading" class="empty-card" style="padding: 4rem; display: flex; flex-direction: column; align-items: center">
      <Film :size="42" style="color: #b8e0da; margin-bottom: 0.9rem" />
      <div style="font-size: 1.1rem; color: #666; margin-bottom: 0.5rem">没有找到影片</div>
      <div style="color: #999; font-size: 0.9rem; margin-bottom: 1.4rem">当前筛选没有命中结果，尝试放宽条件或清空筛选。</div>
      <button class="outline-btn" @click="clearFilters">清除筛选</button>
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
    <p v-if="total" style="margin-top: 1rem; color: var(--text-muted)">共 {{ total }} 部</p>
  </div>
</template>
