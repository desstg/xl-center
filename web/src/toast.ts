import { ref } from 'vue'

export const toastMessage = ref('')
let timer: number | null = null

export function showToast(msg: string) {
  toastMessage.value = msg
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    toastMessage.value = ''
  }, 2000)
}
