<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RefreshCw, Plus, Pencil, Trash2 } from 'lucide-vue-next'
import { getActors, addActor, updateActor, deleteActor, type Actor } from '../api'
import { showToast } from '../toast'

const route = useRoute()
const router = useRouter()
const actors = ref<Actor[]>([])
const total = ref(0)
const stats = ref({ associated: 0, unused: 0 })
const page = ref(1)
const limit = 50
const loading = ref(false)
const error = ref('')
const showForm = ref(false)
const form = ref('')
const showEditModal = ref(false)
const editingId = ref<number | null>(null)
const editName = ref('')
const editAliases = ref<string[]>([])
const newAlias = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const q = typeof route.query.q === 'string' ? route.query.q : ''
    const r = await getActors(q, page.value, limit)
    actors.value = r.items
    total.value = r.total
    stats.value = r.stats
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function openAdd() {
  editingId.value = null
  form.value = ''
  showForm.value = true
}

function openEdit(a: Actor) {
  editingId.value = a.id
  editName.value = a.name
  editAliases.value = [...a.aliases]
  newAlias.value = ''
  showEditModal.value = true
}

async function submit() {
  if (!form.value.trim()) return
  try {
    await addActor(form.value.trim())
    showToast('演员已添加')
    showForm.value = false
    await load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

function addAlias() {
  const alias = newAlias.value.trim()
  if (alias && !editAliases.value.includes(alias)) {
    editAliases.value.push(alias)
  }
  newAlias.value = ''
}

function removeAlias(index: number) {
  editAliases.value.splice(index, 1)
}

async function saveEdit() {
  if (!editName.value.trim() || editingId.value === null) return
  try {
    await updateActor(editingId.value, { name: editName.value.trim(), aliases: editAliases.value })
    showToast('演员已更新')
    showEditModal.value = false
    await load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function remove(a: Actor) {
  if (!window.confirm(`确定删除演员「${a.name}」？`)) return
  try {
    await deleteActor(a.id)
    showToast('演员已删除')
    await load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

function go(name: string) {
  router.push({ path: '/movies', query: { actors: name } })
}

function goPage(p: number) {
  page.value = p
  load()
}

const totalPages = () => Math.max(1, Math.ceil(total.value / limit))

onMounted(load)

watch(() => route.query.q, () => {
  page.value = 1
  load()
})
</script>

<template>
  <div>
    <!-- 标题 + 操作 -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.6rem">
      <h1 style="color: #666; font-size: 1.3rem">演员管理 <span style="color: #999; font-size: 0.8em; font-weight: 400">[{{ total }}]</span></h1>
      <div style="display: flex; gap: 0.5rem">
        <button class="toolbar-btn" @click="load"><RefreshCw :size="16" /> 刷新</button>
        <button class="glass-button" @click="openAdd"><Plus :size="16" /> 添加演员</button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div style="display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap">
      <div class="glass-panel" style="flex: 1; min-width: 200px; padding: 1rem 1.2rem">
        <div style="font-size: 1.4rem; font-weight: 700; color: var(--accent)">{{ stats.associated }}</div>
        <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.3rem">已关联影片的演员</div>
      </div>
      <div class="glass-panel" style="flex: 1; min-width: 200px; padding: 1rem 1.2rem">
        <div style="font-size: 1.4rem; font-weight: 700; color: var(--text-muted)">{{ stats.unused }}</div>
        <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.3rem">未使用演员</div>
      </div>
    </div>

    <!-- 添加演员表单 -->
    <div v-if="showForm" class="glass-panel" style="padding: 1rem; margin-bottom: 1rem; display: flex; gap: 0.7rem; align-items: center; flex-wrap: wrap">
      <input v-model="form" class="glass-input" style="flex: 1; min-width: 220px" placeholder="演员名称" @keyup.enter="submit" />
      <button class="glass-button" @click="submit">添加</button>
      <button class="toolbar-btn" @click="showForm = false">取消</button>
    </div>

    <!-- 编辑演员弹窗 -->
    <div v-if="showEditModal" class="modal-overlay" @click.self="showEditModal = false">
      <div class="modal">
        <div class="modal-header">
          <span>编辑演员</span>
          <button class="toolbar-btn" @click="showEditModal = false">×</button>
        </div>
        <div style="padding: 1rem 1.2rem">
          <div style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.4rem">演员名称</div>
          <input v-model="editName" class="glass-input" style="width: 100%" placeholder="演员名称" />
          <div style="color: var(--text-secondary); font-size: 0.85rem; margin: 1rem 0 0.4rem">别名</div>
          <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.5rem">
            <span v-for="(al, i) in editAliases" :key="i" class="filter-tag">
              {{ al }}
              <button class="filter-tag-x" @click="removeAlias(i)">×</button>
            </span>
            <span v-if="!editAliases.length" style="color: var(--text-muted); font-size: 0.85rem">暂无别名</span>
          </div>
          <div style="display: flex; gap: 0.5rem">
            <input v-model="newAlias" class="glass-input" style="flex: 1" placeholder="添加别名" @keyup.enter="addAlias" />
            <button class="toolbar-btn" @click="addAlias">添加</button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="toolbar-btn" @click="showEditModal = false">取消</button>
          <button class="glass-button" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="loading">加载中…</p>

    <!-- 表格 -->
    <div v-else-if="actors.length" class="glass-panel" style="overflow: hidden">
      <table style="width: 100%; border-collapse: collapse; font-size: 0.88rem">
        <thead>
          <tr style="background: var(--bg); color: var(--text-secondary); text-align: left">
            <th style="padding: 0.7rem 0.9rem; width: 40px"></th>
            <th style="padding: 0.7rem 0.9rem">演员名称</th>
            <th style="padding: 0.7rem 0.9rem; width: 25%">简介</th>
            <th style="padding: 0.7rem 0.9rem; width: 25%">关联名称</th>
            <th style="padding: 0.7rem 0.9rem">关联影片数</th>
            <th style="padding: 0.7rem 0.9rem">创建时间</th>
            <th style="padding: 0.7rem 0.9rem">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in actors" :key="a.id" style="border-top: 1px solid var(--border)">
            <td style="padding: 0.6rem 0.9rem"><input type="checkbox" /></td>
            <td style="padding: 0.6rem 0.9rem">
              <span class="actor-link" :title="a.aliases.join(' / ')" @click="go(a.name)">{{ a.name }}</span>
            </td>
            <td style="padding: 0.6rem 0.9rem; color: var(--text-muted)">无简介</td>
            <td style="padding: 0.6rem 0.9rem; color: var(--text-secondary)">{{ a.aliases.length ? a.aliases.join('、') : '—' }}</td>
            <td style="padding: 0.6rem 0.9rem">{{ a.movie_count ?? 0 }}</td>
            <td style="padding: 0.6rem 0.9rem; color: var(--text-muted)">{{ (a.created_at || '').slice(0, 16) }}</td>
            <td style="padding: 0.6rem 0.9rem; display: flex; gap: 0.4rem">
              <button class="toolbar-btn" title="编辑" @click="openEdit(a)"><Pencil :size="14" /></button>
              <button class="toolbar-btn" title="删除" style="color: #dc2626" @click="remove(a)"><Trash2 :size="14" /></button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!loading" class="empty">暂无演员数据</p>

    <!-- 分页 -->
    <div v-if="totalPages() > 1" style="display: flex; gap: 0.5rem; justify-content: center; margin-top: 1rem">
      <button class="toolbar-btn" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
      <span style="align-self: center; color: var(--text-secondary)">{{ page }} / {{ totalPages() }}</span>
      <button class="toolbar-btn" :disabled="page >= totalPages()" @click="goPage(page + 1)">下一页</button>
    </div>
  </div>
</template>

<style scoped>
.actor-link {
  cursor: pointer;
  font-weight: 500;
  color: var(--text-main);
}
.actor-link:hover {
  color: var(--accent);
}
</style>
