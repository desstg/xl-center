<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink, RouterView, useRouter, useRoute } from 'vue-router'
import ScanProgressToast from './components/ScanProgressToast.vue'
import Toast from './components/Toast.vue'
import LoginModal from './components/LoginModal.vue'
import { isAuthed, getAuthStatus } from './api'
import pkg from '../../package.json'
import { Gauge, Film, Heart, ChevronDown, Search, Eye, EyeOff, MoreHorizontal, Folder } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()

// 应用版本号（读根 package.json 的 version，页脚显示用，升版本只改这一处）
const appVersion = pkg.version

// 初始 true（乐观），启动时查认证状态再决定是否弹登录框
const authed = ref(true)
const authReady = ref(false)

async function initAuth() {
  try {
    const status = await getAuthStatus()
    // 需要登录 → 看本地是否有 token；不需要 → 直接视为已登录
    authed.value = status.authRequired ? isAuthed() : true
  } catch {
    // 查询失败，回退到本地 token 判断
    authed.value = isAuthed()
  } finally {
    authReady.value = true
  }
}

function onAuthExpired() {
  authed.value = false
}
onMounted(() => {
  window.addEventListener('auth-expired', onAuthExpired)
  initAuth()
})
onBeforeUnmount(() => window.removeEventListener('auth-expired', onAuthExpired))

const searchText = ref('')
const searchType = ref('title')
const searchTypeMenuOpen = ref(false)
const eyeOpen = ref(localStorage.getItem('eye-open') !== '0')
watch(
  eyeOpen,
  (v) => {
    document.body.classList.toggle('eye-hidden', !v)
    localStorage.setItem('eye-open', v ? '1' : '0')
  },
  { immediate: true },
)

const searchTypes = [
  { key: 'title', label: '影片' },
  { key: 'num', label: '番号' },
  { key: 'actor', label: '演员' },
  { key: 'filename', label: '文件名' },
]

const searchTypeLabel = computed(() => searchTypes.find((t) => t.key === searchType.value)?.label || '影片')

const taxonomySearch = computed(() => {
  if (route.path === '/actors') return { placeholder: '搜索演员名称，多个关键词用逗号分隔', path: '/actors' }
  if (route.path === '/genres') return { placeholder: '搜索类型名称，多个关键词用逗号分隔', path: '/genres' }
  if (route.path === '/tags') return { placeholder: '搜索标签名称，多个关键词用逗号分隔', path: '/tags' }
  return null
})
const searchPlaceholder = computed(() => taxonomySearch.value?.placeholder || `搜索${searchTypeLabel.value}...`)

function selectSearchType(key: string) {
  searchType.value = key
  searchTypeMenuOpen.value = false
}

const navs = [
  { to: '/', label: '仪表板', icon: Gauge },
  { to: '/movies', label: '影片库', icon: Film },
  { to: '/favorites', label: '收藏夹', icon: Heart },
]

const manageItems = [
  { to: '/libraries', label: '媒体库' },
  { to: '/actors', label: '演员' },
  { to: '/genres', label: '类型' },
  { to: '/tags', label: '标签' },
]

function doSearch() {
  const kw = searchText.value.trim()
  if (!kw) return
  const tax = taxonomySearch.value
  if (tax) {
    router.push({ path: tax.path, query: { q: kw } })
  } else {
    let query: Record<string, string> = {}
    if (searchType.value === 'title') query.q = kw
    else if (searchType.value === 'num') query.num = kw
    else if (searchType.value === 'actor') query.actors = kw
    else if (searchType.value === 'filename') query.filename = kw
    router.push({ path: '/movies', query })
  }
  searchTypeMenuOpen.value = false
}
</script>

<template>
  <div class="app-shell">
    <header class="navbar">
      <div class="navbar-content">
        <RouterLink class="brand" to="/">
          <Folder :size="20" color="#00a896" />
          <span><span class="brand-md">XL</span><span class="brand-center"> Center</span></span>
        </RouterLink>

        <nav class="nav-links">
          <RouterLink v-for="n in navs" :key="n.to" class="nav-item" :to="n.to">
            <component :is="n.icon" :size="16" />
            <span class="nav-label">{{ n.label }}</span>
          </RouterLink>
          <div class="nav-dropdown">
            <span class="nav-item"><span class="nav-label">管理</span> <ChevronDown :size="14" /></span>
            <div class="nav-dropdown-menu">
              <RouterLink v-for="m in manageItems" :key="m.to" class="nav-item" :to="m.to">{{ m.label }}</RouterLink>
            </div>
          </div>
        </nav>

        <div class="nav-actions">
          <div class="search-box">
            <div v-if="!taxonomySearch" class="search-type" @click="searchTypeMenuOpen = !searchTypeMenuOpen">
              <Search :size="15" />
              <span>{{ searchTypeLabel }}</span>
              <ChevronDown :size="12" />
            </div>
            <div v-if="searchTypeMenuOpen && !taxonomySearch" class="search-type-menu">
              <button
                v-for="t in searchTypes"
                :key="t.key"
                class="search-type-option"
                :class="{ active: t.key === searchType }"
                @click="selectSearchType(t.key)"
              >
                {{ t.label }}
              </button>
            </div>
            <input v-model="searchText" :placeholder="searchPlaceholder" @keyup.enter="doSearch" />
            <button class="search-submit" @click="doSearch"><Search :size="15" /></button>
          </div>
          <button class="icon-btn pink" :title="eyeOpen ? '睁眼' : '闭眼'" @click="eyeOpen = !eyeOpen">
            <component :is="eyeOpen ? Eye : EyeOff" :size="16" />
          </button>
          <div class="nav-dropdown">
            <button class="icon-btn"><MoreHorizontal :size="16" /></button>
            <div class="nav-dropdown-menu" style="right: 0; left: auto; min-width: 120px">
              <RouterLink class="nav-item" to="/settings">设置</RouterLink>
            </div>
          </div>
        </div>
      </div>
    </header>

    <main class="main-content">
      <RouterView />
    </main>

    <footer class="footer">
      <div class="footer-brand">
        <span class="brand"><span class="brand-md">XL</span><span class="brand-center"> Center</span></span>
        <span class="brand-desc">管理你的影片数据</span>
      </div>
      <div class="footer-meta">
        <span>© 2026 XL Center. All rights reserved</span>
        <span>Version v{{ appVersion }}</span>
        <button class="lang-btn">中</button>
      </div>
    </footer>

    <ScanProgressToast />
    <Toast />

    <LoginModal v-if="authReady && !authed" @success="authed = true" />
  </div>
</template>
