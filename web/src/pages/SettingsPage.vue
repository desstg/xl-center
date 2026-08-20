<script setup lang="ts">
import { ref } from 'vue'
import {
  Settings, Lock, Globe, Bell, Link, ChevronRight, ChevronDown,
  Server, Database, FileText, Save, RefreshCw,
} from 'lucide-vue-next'
import { showToast } from '../toast'

// 左侧分类菜单：前 5 项带图标，后 4 项带右箭头（参考图样式）
const menu = [
  { key: 'basic', label: '基础设置', icon: Settings },
  { key: 'access', label: '访问控制', icon: Lock },
  { key: 'proxy', label: '代理配置', icon: Globe },
  { key: 'subscribe', label: '订阅配置', icon: Bell },
  { key: 'api', label: 'API 配置', icon: Link },
  { key: 'download', label: '下载设置' },
  { key: 'library', label: '媒体库设置' },
  { key: 'notify', label: '通知设置' },
  { key: 'other', label: '其他' },
]
const active = ref('basic')

// —— 以下字段值均来自参考图，为占位示例，数据暂未接入后端 ——
// 界面设置
const coverBackground = ref('已禁用')
// 服务配置
const listenHost = ref('0.0.0.0')
const listenPort = ref('9090')
// 数据库配置
const dbHost = ref('postgres')
const dbPort = ref('5432')
const dbUser = ref('desstg')
const dbPassword = ref('')
const dbName = ref('db_online')
const sslMode = ref('禁用 SSL')
// 日志配置
const logLevel = ref('信息')
const consoleOnly = ref(false)

const logLevels = ['调试', '信息', '警告', '错误']
const sslModes = ['禁用 SSL', '允许', '要求']

function save() {
  showToast('设置页暂未接入后端，此为演示界面')
}
function reload() {
  showToast('设置页暂未接入后端，此为演示界面')
}
</script>

<template>
  <div>
    <div class="page-header"><h1>设置</h1></div>

    <div class="settings-layout">
      <!-- 左侧分类菜单 -->
      <aside class="settings-side">
        <button
          v-for="m in menu"
          :key="m.key"
          class="menu-item"
          :class="{ active: active === m.key }"
          @click="active = m.key"
        >
          <component v-if="m.icon" :is="m.icon" :size="16" />
          <span>{{ m.label }}</span>
          <ChevronRight v-if="!m.icon" :size="14" class="arrow" />
        </button>
      </aside>

      <!-- 右侧内容区 -->
      <section class="settings-content">
        <!-- 基础设置 -->
        <template v-if="active === 'basic'">
          <!-- 界面设置 -->
          <div class="module-card">
            <div class="module-head">
              <span class="module-name"><Settings :size="16" /> 界面设置</span>
            </div>
            <div class="field-grid">
              <label class="field">
                <span class="field-label">登录封面背景</span>
                <button class="select-like" type="button" title="数据暂未接入">
                  <span>{{ coverBackground }}</span>
                  <ChevronDown :size="14" />
                </button>
              </label>
            </div>
          </div>

          <!-- 服务配置 -->
          <div class="module-card">
            <div class="module-head">
              <span class="module-name"><Server :size="16" /> 服务配置</span>
              <span class="tag tag-warn">需要重启</span>
            </div>
            <div class="field-grid">
              <label class="field">
                <span class="field-label">监听地址 <em>*</em></span>
                <input v-model="listenHost" class="glass-input" />
              </label>
              <label class="field">
                <span class="field-label">监听端口 <em>*</em></span>
                <input v-model="listenPort" class="glass-input" />
              </label>
            </div>
          </div>

          <!-- 数据库配置 -->
          <div class="module-card">
            <div class="module-head">
              <span class="module-name"><Database :size="16" /> 数据库配置</span>
              <span class="tag tag-warn">需要重启</span>
            </div>
            <div class="field-grid">
              <label class="field">
                <span class="field-label">主机地址 <em>*</em></span>
                <input v-model="dbHost" class="glass-input" />
              </label>
              <label class="field">
                <span class="field-label">端口 <em>*</em></span>
                <input v-model="dbPort" class="glass-input" />
              </label>
              <label class="field">
                <span class="field-label">用户名 <em>*</em></span>
                <input v-model="dbUser" class="glass-input" />
              </label>
              <label class="field">
                <span class="field-label">密码 <em>*</em></span>
                <input v-model="dbPassword" type="password" class="glass-input" placeholder="••••••" />
              </label>
              <label class="field">
                <span class="field-label">数据库名 <em>*</em></span>
                <input v-model="dbName" class="glass-input" />
              </label>
              <label class="field">
                <span class="field-label">SSL 模式</span>
                <select v-model="sslMode" class="glass-select">
                  <option v-for="s in sslModes" :key="s" :value="s">{{ s }}</option>
                </select>
              </label>
            </div>
          </div>

          <!-- 日志配置 -->
          <div class="module-card">
            <div class="module-head">
              <span class="module-name"><FileText :size="16" /> 日志配置</span>
              <span class="tag tag-ok">热更新</span>
            </div>
            <div class="field-grid">
              <label class="field">
                <span class="field-label">日志级别</span>
                <select v-model="logLevel" class="glass-select">
                  <option v-for="l in logLevels" :key="l" :value="l">{{ l }}</option>
                </select>
              </label>
              <div class="field field-action">
                <button class="toggle-btn" :class="{ on: consoleOnly }" type="button" @click="consoleOnly = !consoleOnly">
                  仅控制台
                </button>
              </div>
            </div>
          </div>

          <!-- 底部操作 -->
          <div class="settings-actions">
            <button class="btn-save" type="button" @click="save"><Save :size="16" /> 保存配置</button>
            <button class="btn-reload" type="button" @click="reload"><RefreshCw :size="16" /> 重新加载</button>
          </div>
        </template>

        <!-- 其余分类占位 -->
        <div v-else class="placeholder">「{{ menu.find((m) => m.key === active)?.label }}」分类暂未实现</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-layout {
  display: flex;
  gap: 1.25rem;
  align-items: flex-start;
}

/* 左侧分类菜单 */
.settings-side {
  width: 200px;
  flex-shrink: 0;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-family: var(--font-body);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, color 0.15s;
}
.menu-item:hover {
  background: var(--bg);
  color: var(--text-main);
}
.menu-item.active {
  background: var(--bg);
  color: var(--text-main);
  font-weight: 600;
}
.menu-item.active svg {
  color: var(--accent);
}
.menu-item .arrow {
  margin-left: auto;
  color: var(--text-muted);
}

/* 右侧内容区 */
.settings-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.module-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.1rem 1.2rem;
}
.module-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1rem;
}
.module-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 1rem;
}
.module-name svg {
  color: var(--accent);
}

/* 标签（需要重启 / 热更新） */
.tag {
  font-size: 0.7rem;
  padding: 0.15rem 0.55rem;
  border-radius: 6px;
  font-weight: 500;
  line-height: 1.4;
}
.tag-warn {
  background: #fef3c7;
  color: #b45309;
}
.tag-ok {
  background: #d1fae5;
  color: #047857;
}

/* 表单字段 */
.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 0.9rem 1.2rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.field-label {
  font-size: 0.82rem;
  color: var(--text-secondary);
}
.field-label em {
  color: #dc2626;
  font-style: normal;
  margin-left: 2px;
}
.field input,
.field select {
  width: 100%;
}
.field-action {
  justify-content: flex-end;
}

/* 模拟下拉（登录封面背景） */
.select-like {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.55rem 0.8rem;
  color: var(--text-main);
  font-family: var(--font-body);
  font-size: 0.9rem;
  cursor: pointer;
  text-align: left;
}

/* 仅控制台开关按钮 */
.toggle-btn {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 0.9rem;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.85rem;
  font-family: var(--font-body);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.toggle-btn.on {
  background: rgba(0, 191, 165, 0.1);
  color: var(--accent);
  border-color: var(--accent);
}

/* 底部操作 */
.settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 0.25rem;
}
.btn-save {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: #d1fae5;
  color: #065f46;
  border: none;
  border-radius: 8px;
  padding: 0.55rem 1.1rem;
  font-size: 0.9rem;
  font-weight: 500;
  font-family: var(--font-body);
  cursor: pointer;
  transition: background 0.15s;
}
.btn-save:hover {
  background: #a7f3d0;
}
.btn-reload {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--bg);
  color: var(--text-secondary);
  border: none;
  border-radius: 8px;
  padding: 0.55rem 1.1rem;
  font-size: 0.9rem;
  font-family: var(--font-body);
  cursor: pointer;
  transition: background 0.15s;
}
.btn-reload:hover {
  background: #e5e7eb;
}

/* 占位 */
.placeholder {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 4rem;
  text-align: center;
  color: var(--text-muted);
}

/* 移动端 */
@media (max-width: 768px) {
  .settings-layout {
    flex-direction: column;
  }
  .settings-side {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
  }
  .menu-item {
    width: auto;
  }
  .menu-item .arrow {
    display: none;
  }
}
</style>
