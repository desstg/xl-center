<script setup lang="ts">
import { X } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    open: boolean
    title?: string
    message?: string
    confirmText?: string
    danger?: boolean
  }>(),
  {
    title: '确认操作',
    message: '',
    confirmText: '确定',
    danger: false,
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <div v-if="open" class="modal-overlay" @click.self="emit('cancel')">
    <div class="modal" style="width: 420px">
      <div class="modal-header">
        <span>{{ title }}</span>
        <button class="toolbar-btn" @click="emit('cancel')"><X :size="16" /></button>
      </div>
      <div style="padding: 1.3rem 1.2rem; color: var(--text-secondary); font-size: 0.92rem; line-height: 1.6">
        {{ message }}
      </div>
      <div class="modal-footer">
        <button class="toolbar-btn" @click="emit('cancel')">取消</button>
        <button :class="danger ? 'btn-danger' : 'glass-button'" @click="emit('confirm')">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>
