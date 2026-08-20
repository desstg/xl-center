<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Plus, ChevronDown, FolderX, RefreshCw, RefreshCcw, Folder, FolderPlus, Trash2, Pencil, MoreHorizontal, X } from 'lucide-vue-next'
import { getLibraries, addLibrary, updateLibrary, deleteLibrary, scanLibrary, refreshLibrary, browseDir, getScanStatus, type Library } from '../api'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const libraries = ref<Library[]>([])
const loading = ref(false)
const scanning = ref<number | null>(null)
const refreshing = ref<number | null>(null)
const error = ref('')
const formOpen = ref(false)
const editingId = ref<number | null>(null)
const form = ref({ name: '', type: 'film', paths: [''] })
const menuOpen = ref<number | null>(null)
let menuCloseTimer: number | null = null
const browseOpen = ref(false)
const browseTargetIndex = ref<number | null>(null)
const appendLibId = ref<number | null>(null)
const browsePath = ref('')
const browseParent = ref<string | null>(null)
const browseDirs = ref<{ name: string; path: string }[]>([])
const mediaDirs = ref<{ name: string; path: string }[]>([])
const confirmOpen = ref(false)
const confirmTitle = ref('')
const confirmMessage = ref('')
const confirmAction = ref<(() => void) | null>(null)

async function load() {
  loading.value = true
  try {
    libraries.value = await getLibraries()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function openAdd() {
  editingId.value = null
  form.value = { name: '', type: 'film', paths: [''] }
  formOpen.value = true
  await loadMediaDirs()
}

async function openEdit(lib: Library) {
  editingId.value = lib.id
  form.value = {
    name: lib.name,
    type: lib.type,
    paths: lib.paths && lib.paths.length ? [...lib.paths] : [lib.path || ''],
  }
  formOpen.value = true
  await loadMediaDirs()
}

function addPath() {
  form.value.paths.push('')
}

function removePath(i: number) {
  if (form.value.paths.length <= 1) return
  const p = form.value.paths[i].trim()
  if (!p) {
    form.value.paths.splice(i, 1)
    return
  }
  askConfirm('移除目录', `确定移除目录「${p}」？该目录下的影片信息也会一并删除。`, () => {
    form.value.paths.splice(i, 1)
  })
}

function askConfirm(title: string, message: string, action: () => void) {
  confirmTitle.value = title
  confirmMessage.value = message
  confirmAction.value = action
  confirmOpen.value = true
}

function handleConfirm() {
  confirmOpen.value = false
  confirmAction.value?.()
  confirmAction.value = null
}

function toggleMenu(libId: number) {
  if (menuOpen.value === libId) {
    menuOpen.value = null
    clearMenuCloseTimer()
  } else {
    menuOpen.value = libId
    scheduleMenuClose()
  }
}

function scheduleMenuClose() {
  clearMenuCloseTimer()
  menuCloseTimer = window.setTimeout(() => {
    menuOpen.value = null
  }, 3000)
}

function clearMenuCloseTimer() {
  if (menuCloseTimer !== null) {
    window.clearTimeout(menuCloseTimer)
    menuCloseTimer = null
  }
}

async function submit() {
  const name = form.value.name.trim()
  const paths = form.value.paths.map((p) => p.trim()).filter(Boolean)
  if (!name) {
    error.value = '名称不能为空'
    return
  }
  if (!paths.length) {
    error.value = '至少需要一个目录'
    return
  }
  error.value = ''
  try {
    if (editingId.value) {
      await updateLibrary(editingId.value, { name, paths, type: form.value.type })
    } else {
      await addLibrary({ name, paths, type: form.value.type })
    }
    formOpen.value = false
    await load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

function remove(lib: Library) {
  menuOpen.value = null
  askConfirm('删除媒体库', `确定删除媒体库「${lib.name}」？其中的条目也会一并删除。`, async () => {
    try {
      await deleteLibrary(lib.id)
      await load()
    } catch (e) {
      error.value = (e as Error).message
    }
  })
}

async function scan(lib: Library) {
  scanning.value = lib.id
  error.value = ''
  try {
    await scanLibrary(lib.id)
    // 轮询等待扫描完成
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000))
      const p = await getScanStatus()
      if (!p.running) break
    }
    await load()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    scanning.value = null
  }
}

async function refresh(lib: Library) {
  refreshing.value = lib.id
  error.value = ''
  try {
    await refreshLibrary(lib.id)
    // 轮询等待刷新完成
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000))
      const p = await getScanStatus()
      if (!p.running) break
    }
    await load()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    refreshing.value = null
  }
}

async function openBrowseFor(i: number) {
  browseTargetIndex.value = i
  appendLibId.value = null
  browseOpen.value = true
  await browseTo('')
}

async function openAppendDir(lib: Library) {
  menuOpen.value = null
  appendLibId.value = lib.id
  browseTargetIndex.value = null
  browseOpen.value = true
  await browseTo('')
}

async function browseTo(path: string) {
  try {
    const r = await browseDir(path)
    browsePath.value = r.path
    browseParent.value = r.parent
    browseDirs.value = r.dirs
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function browseUp() {
  if (browseParent.value !== null) await browseTo(browseParent.value)
}

// 加载容器内媒体挂载点 /media 下的子目录，作为「媒体目录」快捷填入
async function loadMediaDirs() {
  try {
    const r = await browseDir('/media')
    mediaDirs.value = r.dirs
  } catch {
    mediaDirs.value = []
  }
}

function fillPath(p: string) {
  const idx = form.value.paths.findIndex((x) => !x.trim())
  if (idx >= 0) form.value.paths[idx] = p
  else form.value.paths[form.value.paths.length - 1] = p
}

async function selectBrowse() {
  const chosen = browsePath.value
  if (appendLibId.value !== null) {
    // 追加目录模式：给该媒体库追加一个目录
    const lib = libraries.value.find((l) => l.id === appendLibId.value)
    if (lib && chosen) {
      const paths = [...(lib.paths && lib.paths.length ? lib.paths : [lib.path || ''])]
      if (!paths.includes(chosen)) {
        paths.push(chosen)
        try {
          await updateLibrary(appendLibId.value, { paths })
          await load()
        } catch (e) {
          error.value = (e as Error).message
        }
      }
    }
    appendLibId.value = null
  } else if (browseTargetIndex.value !== null) {
    form.value.paths[browseTargetIndex.value] = chosen
  }
  browseOpen.value = false
}

onMounted(load)
</script>

<template>
  <div>
    <!-- 标题 -->
    <div style="display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.6rem">
      <div>
        <h1 style="color: #666; font-size: 1.3rem">媒体库管理 <span style="color: #999">[{{ libraries.length }}]</span></h1>
        <p style="color: #999; font-size: 0.88rem; margin-top: 0.25rem">管理媒体库及其目录</p>
      </div>
      <div style="display: flex; gap: 0.5rem">
        <button class="toolbar-btn"><ChevronDown :size="16" /> 操作</button>
        <button class="glass-button" @click="openAdd"><Plus :size="16" /> 添加媒体库</button>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="loading">加载中…</p>

    <!-- 媒体库卡片网格 -->
    <div v-else-if="libraries.length" class="lib-grid">
      <div v-for="lib in libraries" :key="lib.id" class="lib-card">
        <Folder :size="34" color="#00bfa5" />
        <div style="font-size: 1.1rem; font-weight: 600; margin-top: 0.4rem">{{ lib.name }}</div>
        <div style="color: var(--text-muted); font-size: 0.85rem">{{ lib.item_count ?? 0 }} 个条目 · {{ lib.paths?.length ?? 1 }} 个目录</div>
        <span class="badge">{{ lib.type === 'film' ? '电影' : '剧集' }}</span>
        <div style="display: flex; gap: 0.4rem; margin-top: 0.8rem">
          <button class="toolbar-btn" title="编辑" @click="openEdit(lib)"><Pencil :size="15" /> 编辑</button>
          <button class="toolbar-btn" title="扫描" :disabled="scanning === lib.id" @click="scan(lib)">
            <RefreshCw :size="15" /> {{ scanning === lib.id ? '扫描中' : '扫描' }}
          </button>
          <div style="position: relative">
            <button class="toolbar-btn" title="更多" @click="toggleMenu(lib.id)">
              <MoreHorizontal :size="15" />
            </button>
            <div v-if="menuOpen === lib.id" class="card-menu" style="right: 0; left: auto" @mouseenter="clearMenuCloseTimer" @mouseleave="scheduleMenuClose">
              <button class="card-menu-item" @click="openAppendDir(lib)"><FolderPlus :size="14" /> 添加目录</button>
              <button class="card-menu-item" :disabled="refreshing === lib.id" @click="refresh(lib)">
                <RefreshCcw :size="14" /> {{ refreshing === lib.id ? '刷新中' : '刷新元数据' }}
              </button>
              <button class="card-menu-item danger" @click="remove(lib)"><Trash2 :size="14" /> 删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 空白状态 -->
    <div v-else-if="!loading" class="empty-card" style="padding: 4rem; display: flex; flex-direction: column; align-items: center">
      <FolderX :size="42" style="color: #c7c7cc; margin-bottom: 0.9rem" />
      <div style="font-size: 1.1rem; color: #666; margin-bottom: 0.5rem">暂无媒体库</div>
      <div style="color: #999; font-size: 0.9rem; margin-bottom: 1.4rem">您还没有添加任何媒体库，先建立第一个。</div>
      <button class="outline-btn" @click="openAdd"><Plus :size="16" /> 添加第一个媒体库</button>
    </div>

    <!-- 添加/编辑媒体库弹窗 -->
    <div v-if="formOpen" class="modal-overlay" @click.self="formOpen = false">
      <div class="modal" style="width: 560px">
        <div class="modal-header">
          <span>{{ editingId ? '编辑媒体库' : '添加媒体库' }}</span>
          <button class="toolbar-btn" @click="formOpen = false"><X :size="16" /></button>
        </div>
        <div style="padding: 1rem 1.2rem; display: flex; flex-direction: column; gap: 1rem; overflow-y: auto">
          <div style="display: flex; gap: 0.6rem">
            <input v-model="form.name" class="glass-input" style="flex: 1" placeholder="名称（如：电影）" />
            <select v-model="form.type" class="glass-select">
              <option value="film">电影</option>
              <option value="tv">剧集</option>
            </select>
          </div>

          <div>
            <div style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.5rem">目录（可添加多个）</div>
            <div v-if="mediaDirs.length" style="display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.6rem">
              <span style="font-size: 0.78rem; color: var(--text-muted); line-height: 2rem">媒体目录：</span>
              <button
                v-for="d in mediaDirs"
                :key="d.path"
                type="button"
                class="outline-btn"
                style="font-size: 0.82rem; padding: 0.3rem 0.7rem"
                @click="fillPath(d.path)"
              >📁 {{ d.name }}</button>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.5rem">
              <div v-for="(_p, i) in form.paths" :key="i" style="display: flex; gap: 0.5rem">
                <input v-model="form.paths[i]" class="glass-input" style="flex: 1" placeholder="路径（如 /media/Japan 或 X:/favorite/Japan）" />
                <button class="toolbar-btn" type="button" title="浏览选择" @click="openBrowseFor(i)">浏览</button>
                <button class="toolbar-btn" type="button" title="删除此目录" :disabled="form.paths.length <= 1" @click="removePath(i)"><X :size="15" /></button>
              </div>
            </div>
            <button class="toolbar-btn" type="button" style="margin-top: 0.6rem" @click="addPath"><Plus :size="14" /> 添加目录</button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="toolbar-btn" @click="formOpen = false">取消</button>
          <button class="glass-button" @click="submit">{{ editingId ? '保存' : '保存' }}</button>
        </div>
      </div>
    </div>

    <!-- 目录浏览弹窗 -->
    <div v-if="browseOpen" class="modal-overlay" @click.self="browseOpen = false">
      <div class="modal">
        <div class="modal-header">
          <span>选择目录</span>
          <button class="toolbar-btn" @click="browseOpen = false"><X :size="16" /></button>
        </div>
        <div class="modal-path">
          <button class="toolbar-btn" :disabled="browseParent === null" @click="browseUp">↑ 上一级</button>
          <span style="flex: 1; overflow: auto; white-space: nowrap; color: var(--text-secondary)">{{ browsePath || '我的电脑' }}</span>
        </div>
        <div class="modal-dirs">
          <div v-for="d in browseDirs" :key="d.path" class="modal-dir" @click="browseTo(d.path)">📁 {{ d.name }}</div>
          <p v-if="!browseDirs.length" style="color: var(--text-muted); padding: 1rem; text-align: center">（空目录）</p>
        </div>
        <div class="modal-footer">
          <button class="toolbar-btn" @click="browseOpen = false">取消</button>
          <button class="glass-button" @click="selectBrowse">选择此目录</button>
        </div>
      </div>
    </div>

    <!-- 确认弹窗 -->
    <ConfirmDialog
      :open="confirmOpen"
      :title="confirmTitle"
      :message="confirmMessage"
      confirm-text="删除"
      danger
      @confirm="handleConfirm"
      @cancel="confirmOpen = false"
    />
  </div>
</template>
