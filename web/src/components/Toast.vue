<script setup lang="ts">
import { toastMessage } from '../toast'
</script>

<template>
  <div v-if="toastMessage" class="toast-tip">{{ toastMessage }}</div>
</template>
