<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RefreshCw, Plus, Pencil, Trash2 } from 'lucide-vue-next'
import { getTags, addTag, updateTag, deleteTag, type TaxonomyItem } from '../api'
import { showToast } from '../toast'

const route = useRoute()
const router = useRouter()
const tags = ref<TaxonomyItem[]>([])
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

async function load() {
  loading.value = true
  error.value = ''
  try {
    const q = typeof route.query.q === 'string' ? route.query.q : ''
    const r = await getTags(q, page.value, limit)
    tags.value = r.items
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

function openEdit(t: TaxonomyItem) {
  editingId.value = t.id
  editName.value = t.name
  showEditModal.value = true
}

async function submit() {
  if (!form.value.trim()) return
  try {
    await addTag(form.value.trim())
    showToast('标签已添加')
    showForm.value = false
    await load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function saveEdit() {
  if (!editName.value.trim() || editingId.value === null) return
  try {
    await updateTag(editingId.value, editName.value.trim())
    showToast('标签已更新')
    showEditModal.value = false
    await load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function remove(t: TaxonomyItem) {
  if (!window.confirm(`确定删除标签「${t.name}」？`)) return
  try {
    await deleteTag(t.id)
    showToast('标签已删除')
    await load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

function go(name: string) {
  router.push({ path: '/movies', query: { tags: name } })
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
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.6rem">
      <h1 style="color: #666; font-size: 1.3rem">标签管理 <span style="color: #999; font-size: 0.8em; font-weight: 400">[{{ total }}]</span></h1>
      <div style="display: flex; gap: 0.5rem">
        <button class="toolbar-btn" @click="load"><RefreshCw :size="16" /> 刷新</button>
        <button class="glass-button" @click="openAdd"><Plus :size="16" /> 添加标签</button>
      </div>
    </div>

    <div style="display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap">
      <div class="glass-panel" style="flex: 1; min-width: 200px; padding: 1rem 1.2rem">
        <div style="font-size: 1.4rem; font-weight: 700; color: var(--accent)">{{ stats.associated }}</div>
        <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.3rem">已关联影片的标签</div>
      </div>
      <div class="glass-panel" style="flex: 1; min-width: 200px; padding: 1rem 1.2rem">
        <div style="font-size: 1.4rem; font-weight: 700; color: var(--text-muted)">{{ stats.unused }}</div>
        <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.3rem">未使用标签</div>
      </div>
    </div>

    <div v-if="showForm" class="glass-panel" style="padding: 1rem; margin-bottom: 1rem; display: flex; gap: 0.7rem; align-items: center; flex-wrap: wrap">
      <input v-model="form" class="glass-input" style="flex: 1; min-width: 220px" placeholder="标签名称" @keyup.enter="submit" />
      <button class="glass-button" @click="submit">添加</button>
      <button class="toolbar-btn" @click="showForm = false">取消</button>
    </div>

    <!-- 编辑标签弹窗 -->
    <div v-if="showEditModal" class="modal-overlay" @click.self="showEditModal = false">
      <div class="modal">
        <div class="modal-header">
          <span>编辑标签</span>
          <button class="toolbar-btn" @click="showEditModal = false">×</button>
        </div>
        <div style="padding: 1rem 1.2rem">
          <div style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.4rem">标签名称</div>
          <input v-model="editName" class="glass-input" style="width: 100%" placeholder="标签名称" @keyup.enter="saveEdit" />
        </div>
        <div class="modal-footer">
          <button class="toolbar-btn" @click="showEditModal = false">取消</button>
          <button class="glass-button" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="loading">加载中…</p>

    <div v-else-if="tags.length" class="glass-panel" style="overflow: hidden">
      <table style="width: 100%; border-collapse: collapse; font-size: 0.88rem">
        <thead>
          <tr style="background: var(--bg); color: var(--text-secondary); text-align: left">
            <th style="padding: 0.7rem 0.9rem; width: 40px"></th>
            <th style="padding: 0.7rem 0.9rem">标签名称</th>
            <th style="padding: 0.7rem 0.9rem">关联影片数</th>
            <th style="padding: 0.7rem 0.9rem">创建时间</th>
            <th style="padding: 0.7rem 0.9rem">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tags" :key="t.id" style="border-top: 1px solid var(--border)">
            <td style="padding: 0.6rem 0.9rem"><input type="checkbox" /></td>
            <td style="padding: 0.6rem 0.9rem"><span class="link" @click="go(t.name)">{{ t.name }}</span></td>
            <td style="padding: 0.6rem 0.9rem">{{ t.movie_count }}</td>
            <td style="padding: 0.6rem 0.9rem; color: var(--text-muted)">{{ (t.created_at || '').slice(0, 16) }}</td>
            <td style="padding: 0.6rem 0.9rem; display: flex; gap: 0.4rem">
              <button class="toolbar-btn" title="编辑" @click="openEdit(t)"><Pencil :size="14" /></button>
              <button class="toolbar-btn" title="删除" style="color: #dc2626" @click="remove(t)"><Trash2 :size="14" /></button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!loading" class="empty">暂无标签数据</p>

    <div v-if="totalPages() > 1" style="display: flex; gap: 0.5rem; justify-content: center; margin-top: 1rem">
      <button class="toolbar-btn" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
      <span style="align-self: center; color: var(--text-secondary)">{{ page }} / {{ totalPages() }}</span>
      <button class="toolbar-btn" :disabled="page >= totalPages()" @click="goPage(page + 1)">下一页</button>
    </div>
  </div>
</template>

<style scoped>
.link {
  cursor: pointer;
  font-weight: 500;
}
.link:hover {
  color: var(--accent);
}
</style>
