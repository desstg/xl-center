<script setup lang="ts">
import { ref, watch } from 'vue'
import { X, Trash2 } from 'lucide-vue-next'
import { deleteMovie, type Movie } from '../api'
import { showToast } from '../toast'

const props = defineProps<{
  open: boolean
  movie: Movie
}>()

const emit = defineEmits<{
  close: []
  deleted: []
}>()

const mode = ref<'info' | 'all'>('info')
const deleting = ref(false)

watch(
  () => props.open,
  (v) => {
    if (v) {
      mode.value = 'info'
      deleting.value = false
    }
  },
)

async function confirm() {
  deleting.value = true
  try {
    await deleteMovie(props.movie.id, mode.value)
    showToast('影片已删除')
    emit('deleted')
  } catch (e) {
    showToast('删除失败：' + (e as Error).message)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div v-if="open" class="modal-overlay" @click.self="emit('close')">
    <div class="modal" style="width: 480px">
      <div class="modal-header">
        <span>删除影片</span>
        <button class="toolbar-btn" @click="emit('close')"><X :size="16" /></button>
      </div>

      <div style="padding: 1.2rem; display: flex; flex-direction: column; gap: 0.8rem">
        <p style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6">
          删除后该影片不会被扫描重新入库，除非影片文件夹中的文件发生变化。
        </p>

        <label class="del-option" :class="{ active: mode === 'info' }">
          <input type="radio" name="delmode" value="info" v-model="mode" />
          <div>
            <div class="del-option-title">只删除入库信息</div>
            <div class="del-option-desc">从媒体库移除，本地文件保留</div>
          </div>
        </label>

        <label class="del-option" :class="{ active: mode === 'all' }">
          <input type="radio" name="delmode" value="all" v-model="mode" />
          <div>
            <div class="del-option-title">删除入库信息和本地文件</div>
            <div class="del-option-desc">从媒体库移除，并删除整个影片文件夹（不可恢复）</div>
          </div>
        </label>
      </div>

      <div class="modal-footer">
        <button class="toolbar-btn" @click="emit('close')">取消</button>
        <button class="btn-danger" :disabled="deleting" @click="confirm">
          <Trash2 :size="16" /> {{ deleting ? '删除中…' : '删除' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.del-option {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}
.del-option.active {
  border-color: var(--accent);
  background: rgba(0, 191, 165, 0.06);
}
.del-option input {
  margin-top: 0.15rem;
  flex-shrink: 0;
  accent-color: var(--accent);
}
.del-option-title {
  font-size: 0.9rem;
  color: var(--text-main);
  font-weight: 500;
}
.del-option-desc {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-top: 0.15rem;
}
</style>
