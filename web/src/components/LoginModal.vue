<script setup lang="ts">
import { ref } from 'vue'
import { login } from '../api'
import { User, Lock } from 'lucide-vue-next'

const emit = defineEmits<{ (e: 'success'): void }>()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  if (!username.value || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  error.value = ''
  try {
    await login(username.value, password.value)
    emit('success')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-overlay">
    <div class="login-modal">
      <h2 class="login-title">XL Center</h2>
      <p class="login-sub">请登录后继续</p>
      <form @submit.prevent="submit">
        <div class="login-field">
          <User :size="16" />
          <input v-model="username" placeholder="用户名" autocomplete="username" />
        </div>
        <div class="login-field">
          <Lock :size="16" />
          <input v-model="password" type="password" placeholder="密码" autocomplete="current-password" />
        </div>
        <p v-if="error" class="login-error">{{ error }}</p>
        <button class="login-btn" type="submit" :disabled="loading">{{ loading ? '登录中…' : '登录' }}</button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 20, 30, 0.35);
  backdrop-filter: blur(15px);
  -webkit-backdrop-filter: blur(15px);
  z-index: 9999;
}
.login-modal {
  width: 320px;
  background: var(--bg-card);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 16px;
  padding: 2rem 1.8rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  text-align: center;
}
.login-title {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text-main);
  margin: 0 0 0.25rem;
}
.login-sub {
  color: var(--text-secondary);
  font-size: 0.85rem;
  margin: 0 0 1.4rem;
}
.login-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--bg);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 0.6rem 0.8rem;
  margin-bottom: 0.8rem;
  color: var(--text-secondary);
}
.login-field input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-main);
  font-size: 0.95rem;
}
.login-error {
  color: #e5484d;
  font-size: 0.8rem;
  margin: 0 0 0.6rem;
  text-align: left;
}
.login-btn {
  width: 100%;
  padding: 0.65rem;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.login-btn:hover {
  background: var(--accent-dark);
}
.login-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
