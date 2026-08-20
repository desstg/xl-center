<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getScanStatus, type ScanProgress } from '../api'

const progress = ref<ScanProgress | null>(null)
let timer: number | null = null

const percent = computed(() => {
  if (!progress.value || !progress.value.total) return 0
  return Math.min(100, Math.round((progress.value.scanned / progress.value.total) * 100))
})

const isRefresh = computed(() => progress.value?.mode === 'refresh')
const titleText = computed(() => (isRefresh.value ? '正在刷新' : '正在扫描'))
const infoText = computed(() => {
  if (!progress.value) return ''
  const { scanned, total, added } = progress.value
  return isRefresh.value
    ? `已刷新 ${scanned} / ${total}，更新 ${added} 部`
    : `已扫描 ${scanned} / ${total}，新增 ${added} 部`
})

async function poll() {
  try {
    progress.value = await getScanStatus()
  } catch {
    // 忽略轮询错误
  }
}

onMounted(() => {
  poll()
  timer = window.setInterval(poll, 1200)
})
onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <div v-if="progress?.running && progress.manual" class="scan-toast">
    <div class="scan-toast-title">{{ titleText }}「{{ progress.libraryName }}」…</div>
    <div class="scan-toast-bar-wrap">
      <div class="scan-toast-bar" :style="{ width: percent + '%' }"></div>
    </div>
    <div class="scan-toast-info">{{ infoText }}</div>
    <div v-if="progress.current" class="scan-toast-current">{{ progress.current }}</div>
  </div>
</template>
