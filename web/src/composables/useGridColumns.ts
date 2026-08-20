import { ref, computed, onMounted, onBeforeUnmount, type Ref } from 'vue'

// 估算网格每行列数（与 style.css 的 .video-grid / .thumb-grid 规则保持一致）
export function gridColumns(mode: 'poster' | 'thumb', winWidth: number): number {
  if (mode === 'thumb') {
    if (winWidth <= 500) return 1
    if (winWidth <= 900) return 2
    return 4
  }
  // poster：桌面 minmax(160px,1fr) gap 1rem；移动端（≤768px）minmax(120px,1fr) gap 0.7rem
  if (winWidth <= 768) {
    const contentWidth = Math.min(1200, winWidth) - 32
    return Math.max(1, Math.floor((contentWidth + 11.2) / (120 + 11.2)))
  }
  const contentWidth = Math.min(1200, winWidth) - 48
  return Math.max(1, Math.floor((contentWidth + 16) / (160 + 16)))
}

// 取最接近 base 的「列数整数倍」，保证末排填满（卡片不放大，靠调整每页数量凑整）
export function fillLimit(base: number, columns: number): number {
  const c = Math.max(1, columns)
  return Math.max(c, Math.round(base / c) * c)
}

/** 响应式网格列数：监听窗口 resize + 视图模式，返回当前列数 */
export function useGridColumns(viewMode: Ref<'poster' | 'thumb'>) {
  const winWidth = ref(window.innerWidth)
  const onResize = () => {
    winWidth.value = window.innerWidth
  }
  onMounted(() => window.addEventListener('resize', onResize))
  onBeforeUnmount(() => window.removeEventListener('resize', onResize))
  const columns = computed(() => gridColumns(viewMode.value, winWidth.value))
  return { columns }
}
