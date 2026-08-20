import { ref } from 'vue'

/** 下拉菜单：点击切换 + 鼠标移开后 delay 毫秒自动关闭 */
export function useDropdown(delay = 3000) {
  const open = ref(false)
  let timer: number | null = null

  function toggle() {
    open.value = !open.value
    if (open.value) scheduleClose()
    else clearClose()
  }

  function scheduleClose() {
    clearClose()
    timer = window.setTimeout(() => {
      open.value = false
    }, delay)
  }

  function clearClose() {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  return { open, toggle, scheduleClose, clearClose }
}
