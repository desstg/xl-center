<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Clock, Folder, Film, LayoutGrid, ChevronDown } from 'lucide-vue-next'
import { getMovies, getRecentMovies, getLibraries, getActors, getStats, imageUrl, type Movie, type Library } from '../api'
import { useDropdown } from '../composables/useDropdown'
import { useGridColumns } from '../composables/useGridColumns'
import VideoCard from '../components/VideoCard.vue'
import FanartCard from '../components/FanartCard.vue'

const router = useRouter()
const recent = ref<Movie[]>([])
const viewMode = ref<'poster' | 'thumb'>(
  localStorage.getItem('xl-dashboard-view-mode') === 'thumb' ? 'thumb' : 'poster',
)
const { columns } = useGridColumns(viewMode)
const displayedRecent = computed(() => {
  const total = recent.value.length
  if (!total) return []
  const c = Math.max(1, columns.value)
  const full = Math.floor(total / c) * c
  return recent.value.slice(0, full || total)
})
const { open: viewMenuOpen, toggle: toggleViewMenu, scheduleClose: scheduleViewClose, clearClose: clearViewClose } = useDropdown()
const libraries = ref<Library[]>([])

function setView(mode: 'poster' | 'thumb') {
  viewMode.value = mode
  localStorage.setItem('xl-dashboard-view-mode', mode)
  viewMenuOpen.value = false
}

const gradients = [
  'linear-gradient(135deg, #00bfa5, #00796b)',
  'linear-gradient(135deg, #c9379e, #8e2a72)',
  'linear-gradient(135deg, #4a9eff, #2563eb)',
  'linear-gradient(135deg, #a855f7, #7c3aed)',
]
const rotations = [-8, 4, -3, 8]
const overview = ref([
  { label: '影片', value: 0 },
  { label: '媒体库', value: 0 },
  { label: '收藏', value: 0 },
  { label: '演员', value: 0 },
  { label: '系列', value: 0 },
  { label: '外挂字幕', value: 0 },
])
const daily = ref([
  { label: '今日新增', value: 0 },
  { label: '本周新增', value: 0 },
  { label: '本月新增', value: 0 },
  { label: '今日更新', value: 0 },
  { label: '今日同步', value: 0 },
])

onMounted(async () => {
  try {
    const [m, recentMovies, libs, actors, stats] = await Promise.all([
      getMovies({ limit: 1 }),
      getRecentMovies(),
      getLibraries(),
      getActors(),
      getStats(),
    ])
    recent.value = recentMovies
    libraries.value = libs
    daily.value = [
      { label: '今日新增', value: stats.today },
      { label: '本周新增', value: stats.week },
      { label: '本月新增', value: stats.month },
      { label: '今日更新', value: 0 },
      { label: '今日同步', value: 0 },
    ]
    overview.value = [
      { label: '影片', value: m.total },
      { label: '媒体库', value: libs.length },
      { label: '收藏', value: 0 },
      { label: '演员', value: actors.total },
      { label: '系列', value: 0 },
      { label: '外挂字幕', value: 0 },
    ]
  } catch {
    // 忽略加载错误，保持默认 0
  }
})
</script>

<template>
  <div>
    <!-- 最近添加 -->
    <section class="module">
      <div class="module-header">
        <div class="module-title"><Clock :size="18" /> 最近添加</div>
        <div style="display: flex; align-items: center; gap: 0.6rem">
          <div style="position: relative">
            <button class="toolbar-btn" @click="toggleViewMenu">
              <LayoutGrid :size="15" /> 视图 <ChevronDown :size="14" />
            </button>
            <div v-if="viewMenuOpen" class="card-menu" style="min-width: 110px" @mouseenter="clearViewClose" @mouseleave="scheduleViewClose">
              <button class="card-menu-item" @click="setView('poster')">海报</button>
              <button class="card-menu-item" @click="setView('thumb')">缩略图</button>
            </div>
          </div>
          <span class="module-link" @click="router.push('/movies')">查看更多</span>
        </div>
      </div>
      <div v-if="displayedRecent.length && viewMode === 'poster'" class="video-grid">
        <VideoCard v-for="m in displayedRecent" :key="m.id" :movie="m" />
      </div>
      <div v-else-if="displayedRecent.length && viewMode === 'thumb'" class="thumb-grid">
        <FanartCard v-for="m in displayedRecent" :key="m.id" :movie="m" />
      </div>
      <div v-else-if="!recent.length" class="empty-card">
        <Film :size="28" />
        <div>暂无最近添加的影片</div>
      </div>
    </section>

    <!-- 媒体库 -->
    <section class="module">
      <div class="module-header">
        <div class="module-title"><Folder :size="18" /> 媒体库</div>
        <span class="module-link" @click="router.push('/libraries')">进入管理</span>
      </div>
      <div v-if="libraries.length" class="lib-banner-grid">
        <div v-for="(l, i) in libraries" :key="l.id" class="lib-banner" @click="router.push({ path: '/movies', query: { library: l.id } })">
          <div class="lib-banner-title" :style="{ background: gradients[i % gradients.length] }">
            <div class="lib-banner-name">{{ l.name }}</div>
            <div class="lib-banner-count">{{ l.item_count ?? 0 }} 部影片</div>
          </div>
          <div class="lib-banner-posters">
            <img
              v-for="(p, pi) in (l.posters || []).slice(0, 4)"
              :key="p"
              :src="imageUrl(l.id, p)"
              :style="{ transform: `rotate(${rotations[pi] ?? 0}deg)` }"
            />
          </div>
        </div>
      </div>
      <div v-else class="empty-card">
        <Folder :size="28" />
        <div>暂无媒体库</div>
      </div>
    </section>

    <!-- 统计区 -->
    <section class="stats-columns">
      <div class="overview-panel">
        <div class="overview-header">
          <div class="overview-title">媒体总览</div>
          <span class="live-tag">Live</span>
        </div>
        <div class="stat-grid">
          <div v-for="s in overview" :key="s.label" class="stat-card">
            <div class="stat-num">{{ s.value }}</div>
            <div class="stat-label">{{ s.label }}</div>
          </div>
        </div>
      </div>

      <div class="overview-panel">
        <div class="overview-header">
          <div class="overview-title">今日动态</div>
        </div>
        <div class="stat-grid">
          <div v-for="s in daily" :key="s.label" class="stat-card">
            <div class="stat-num">{{ s.value }}</div>
            <div class="stat-label">{{ s.label }}</div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
