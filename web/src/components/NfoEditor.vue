<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { X, Plus, Trash2, MoveHorizontal } from 'lucide-vue-next'
import { imageUrl, cropPoster, updateMovieNfo, type Movie } from '../api'
import { showToast } from '../toast'

const props = defineProps<{ movie: Movie; open: boolean }>()
const emit = defineEmits<{ close: []; saved: [] }>()

// ---------- 表单 ----------

const form = reactive({
  title: '',
  num: '',
  originalTitle: '',
  year: '',
  rating: '',
  votes: '',
  runtime: '',
  mpaa: '',
  premiered: '',
  trailer: '',
  plot: '',
  outline: '',
})

const listTexts = reactive({
  genres: '',
  tags: '',
  countries: '',
  studios: '',
  directors: '',
  writers: '',
})
type ListKey = keyof typeof listTexts
const listFields: { key: ListKey; label: string; placeholder: string }[] = [
  { key: 'genres', label: '类型', placeholder: '剧情，爱情，动作' },
  { key: 'tags', label: '标签', placeholder: '中文字幕，高清' },
  { key: 'countries', label: '国家', placeholder: '日本' },
  { key: 'studios', label: '制片公司', placeholder: '某制作公司' },
  { key: 'directors', label: '导演', placeholder: '导演甲，导演乙' },
  { key: 'writers', label: '编剧', placeholder: '编剧甲' },
]

const actors = ref<{ name: string; role: string }[]>([])

// 裁剪 + 保存状态（需在 init/watch 之前声明，避免 TDZ）
const imgNatural = ref({ w: 0, h: 0 })
const cropCenter = ref(0.5)
const updatePoster = ref(true)
const cropBoxEl = ref<HTMLDivElement | null>(null)
const saving = ref(false)
const error = ref('')

function init() {
  const m = props.movie
  form.title = m.title || ''
  form.num = m.num || ''
  form.originalTitle = m.original_title || ''
  form.year = m.year != null ? String(m.year) : ''
  form.rating = m.rating != null ? String(m.rating) : ''
  form.votes = m.votes != null ? String(m.votes) : ''
  form.runtime = m.runtime != null ? String(m.runtime) : ''
  form.mpaa = m.mpaa || ''
  form.premiered = m.premiered || ''
  form.trailer = m.trailer || ''
  form.plot = m.plot || ''
  form.outline = m.outline || ''
  listTexts.genres = (m.genres || []).join(', ')
  listTexts.tags = (m.tags || []).join(', ')
  listTexts.countries = (m.countries || []).join(', ')
  listTexts.studios = (m.studios || []).join(', ')
  listTexts.directors = (m.directors || []).join(', ')
  listTexts.writers = (m.writers || []).join(', ')
  actors.value = (m.actors || []).map((a) => ({ name: a.name, role: a.role || '' }))
  // 裁剪状态重置
  imgNatural.value = { w: 0, h: 0 }
  cropCenter.value = 0.5
  updatePoster.value = true
  error.value = ''
}

watch(() => props.movie, init, { immediate: true })

// ---------- 海报裁剪 ----------

const posterSrc = computed(() => imageUrl(props.movie.library_id, props.movie.fanart || props.movie.poster || ''))
let dragging = false

// 裁剪框宽度（相对源图宽）：高占满、宽 = 高 × 2/3 → 比例 = (2/3) × (源图高 / 源图宽)
const boxW = computed(() => {
  const { w, h } = imgNatural.value
  if (!w || !h) return 1
  return Math.min(1, (2 / 3) * (h / w))
})

// 源图是否为横版（宽 > 高）；只有横版才裁剪，避免竖版 fanart 被误裁
const isLandscape = computed(() => {
  const { w, h } = imgNatural.value
  return w > 0 && h > 0 && w > h
})

// 横版且比 2:3 宽时才需要裁剪
const needCrop = computed(() => isLandscape.value && boxW.value < 0.999)
const imgLoaded = computed(() => imgNatural.value.w > 0)

const cropLeft = computed(() => {
  const half = boxW.value / 2
  return Math.min(Math.max(cropCenter.value - half, 0), 1 - boxW.value)
})

function onImgLoad(e: Event) {
  const img = e.target as HTMLImageElement
  imgNatural.value = { w: img.naturalWidth, h: img.naturalHeight }
}

function updateDrag(clientX: number) {
  const el = cropBoxEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const ratio = (clientX - rect.left) / rect.width
  const half = boxW.value / 2
  cropCenter.value = Math.min(Math.max(ratio, half), 1 - half)
}

function startDrag(e: PointerEvent) {
  dragging = true
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  updateDrag(e.clientX)
}
function moveDrag(e: PointerEvent) {
  if (!dragging) return
  updateDrag(e.clientX)
}
function endDrag(e: PointerEvent) {
  dragging = false
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
}

// ---------- 演员 ----------

function addActor() {
  actors.value.push({ name: '', role: '' })
}
function removeActor(i: number) {
  actors.value.splice(i, 1)
}

// ---------- 保存 ----------

function splitList(text: string): string[] {
  return text.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean)
}
function toNum(v: string): number | undefined {
  const t = v.trim()
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

async function save() {
  if (!form.title.trim()) {
    error.value = '标题不能为空'
    return
  }
  error.value = ''
  saving.value = true
  try {
    // 1. 裁剪海报（源图比 2:3 宽且用户勾选时）
    if (updatePoster.value && needCrop.value) {
      await cropPoster(props.movie.id, { x: cropLeft.value, y: 0, w: boxW.value, h: 1 })
    }
    // 2. 保存 NFO
    await updateMovieNfo(props.movie.id, {
      title: form.title.trim(),
      num: form.num.trim() || undefined,
      originalTitle: form.originalTitle.trim() || undefined,
      year: toNum(form.year),
      rating: toNum(form.rating),
      votes: toNum(form.votes),
      runtime: toNum(form.runtime),
      mpaa: form.mpaa.trim() || undefined,
      premiered: form.premiered.trim() || undefined,
      trailer: form.trailer.trim() || undefined,
      plot: form.plot.trim() || undefined,
      outline: form.outline.trim() || undefined,
      genres: splitList(listTexts.genres),
      tags: splitList(listTexts.tags),
      countries: splitList(listTexts.countries),
      studios: splitList(listTexts.studios),
      directors: splitList(listTexts.directors),
      writers: splitList(listTexts.writers),
      actors: actors.value
        .filter((a) => a.name.trim())
        .map((a) => ({ name: a.name.trim(), role: a.role.trim() || undefined })),
    })
    showToast('已保存')
    emit('saved')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="open" class="modal-overlay" @click.self="emit('close')">
    <div class="modal nfo-modal">
      <div class="modal-header">
        <span>编辑影片信息</span>
        <button class="toolbar-btn" @click="emit('close')"><X :size="16" /></button>
      </div>

      <div class="nfo-body">
        <!-- 左栏：海报裁剪 -->
        <div class="nfo-left">
          <div class="field-label" style="margin-bottom: 0.4rem">海报预览</div>
          <div ref="cropBoxEl" class="crop-box" :class="{ 'crop-ready': needCrop && imgLoaded }">
            <img v-if="posterSrc" :src="posterSrc" class="crop-img" alt="海报" @load="onImgLoad" />
            <div v-else class="crop-empty">暂无海报图</div>
            <div
              v-if="needCrop && imgLoaded"
              class="crop-mask crop-mask-left"
              :style="{ width: cropLeft * 100 + '%' }"
            ></div>
            <div
              v-if="needCrop && imgLoaded"
              class="crop-frame"
              :style="{ left: cropLeft * 100 + '%', width: boxW * 100 + '%' }"
              @pointerdown="startDrag"
              @pointermove="moveDrag"
              @pointerup="endDrag"
              @pointercancel="endDrag"
            >
              <span class="crop-handle"><MoveHorizontal :size="13" /></span>
            </div>
            <div
              v-if="needCrop && imgLoaded"
              class="crop-mask crop-mask-right"
              :style="{ width: (1 - cropLeft - boxW) * 100 + '%' }"
            ></div>
          </div>

          <template v-if="needCrop && imgLoaded">
            <label class="crop-toggle">
              <input v-model="updatePoster" type="checkbox" />
              更新海报为裁剪结果
            </label>
            <div class="crop-hint">拖动选框左右移动，选择要保留的区域（2:3）</div>
          </template>
          <div v-else-if="imgLoaded" class="crop-hint">海报已是标准 2:3 比例，无需裁剪</div>
        </div>

        <!-- 右栏：可编辑表单 -->
        <div class="nfo-right">
          <div class="form-grid">
            <div class="field full">
              <label class="field-label">标题 <span class="req">*</span></label>
              <input v-model="form.title" class="glass-input field-input" placeholder="影片标题" />
            </div>

            <div class="field">
              <label class="field-label">番号</label>
              <input v-model="form.num" class="glass-input field-input" placeholder="如 ABC-123" />
            </div>
            <div class="field">
              <label class="field-label">原片名</label>
              <input v-model="form.originalTitle" class="glass-input field-input" placeholder="Original Title" />
            </div>

            <div class="field">
              <label class="field-label">年份</label>
              <input v-model="form.year" class="glass-input field-input" inputmode="numeric" placeholder="2024" />
            </div>
            <div class="field">
              <label class="field-label">评分</label>
              <input v-model="form.rating" class="glass-input field-input" inputmode="decimal" placeholder="8.5" />
            </div>

            <div class="field">
              <label class="field-label">票数</label>
              <input v-model="form.votes" class="glass-input field-input" inputmode="numeric" placeholder="100" />
            </div>
            <div class="field">
              <label class="field-label">时长（分钟）</label>
              <input v-model="form.runtime" class="glass-input field-input" inputmode="numeric" placeholder="120" />
            </div>

            <div class="field">
              <label class="field-label">分级</label>
              <input v-model="form.mpaa" class="glass-input field-input" placeholder="R / PG-13" />
            </div>
            <div class="field">
              <label class="field-label">上映日期</label>
              <input v-model="form.premiered" class="glass-input field-input" placeholder="2024-01-01" />
            </div>

            <div class="field full">
              <label class="field-label">预告片</label>
              <input v-model="form.trailer" class="glass-input field-input" placeholder="https://…" />
            </div>

            <div class="field full">
              <label class="field-label">剧情简介</label>
              <textarea v-model="form.plot" class="glass-input field-textarea" placeholder="影片剧情简介…" />
            </div>

            <div class="field full">
              <label class="field-label">简述</label>
              <input v-model="form.outline" class="glass-input field-input" placeholder="一句话简述（可选）" />
            </div>
          </div>

          <div class="form-section-title">分类信息</div>
          <div class="form-grid">
            <div v-for="f in listFields" :key="f.key" class="field">
              <label class="field-label">{{ f.label }}</label>
              <input v-model="listTexts[f.key]" class="glass-input field-input" :placeholder="f.placeholder" />
            </div>
          </div>

          <div class="form-section-title">演员</div>
          <div class="actor-list">
            <div v-for="(a, i) in actors" :key="i" class="actor-row">
              <input v-model="a.name" class="glass-input" placeholder="姓名" />
              <input v-model="a.role" class="glass-input" placeholder="角色（可选）" />
              <button class="toolbar-btn actor-del" title="删除" @click="removeActor(i)"><Trash2 :size="14" /></button>
            </div>
            <button class="outline-btn actor-add" @click="addActor"><Plus :size="14" /> 添加演员</button>
          </div>
        </div>
      </div>

      <p v-if="error" class="nfo-error">{{ error }}</p>

      <div class="modal-footer">
        <button class="toolbar-btn" @click="emit('close')">取消</button>
        <button class="glass-button" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nfo-modal {
  width: 920px;
  max-width: 94vw;
}
.nfo-body {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 1.4rem;
  padding: 1.2rem 1.3rem;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.nfo-left {
  min-width: 0;
  overflow-y: auto;
}
.nfo-right {
  min-width: 0;
  overflow-y: auto;
  padding-right: 0.4rem;
}

/* 裁剪区 */
.crop-box {
  position: relative;
  width: 100%;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
  line-height: 0;
}
.crop-img {
  width: 100%;
  height: auto;
  display: block;
}
.crop-empty {
  aspect-ratio: 2 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.85rem;
}
.crop-mask {
  position: absolute;
  top: 0;
  bottom: 0;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  background: rgba(0, 0, 0, 0.25);
  pointer-events: none;
}
.crop-mask-left {
  left: 0;
}
.crop-mask-right {
  right: 0;
}
.crop-frame {
  position: absolute;
  top: 0;
  height: 100%;
  border: 2px solid var(--accent);
  cursor: grab;
  box-sizing: border-box;
  touch-action: none;
}
.crop-frame:active {
  cursor: grabbing;
}
.crop-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.crop-toggle {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.7rem;
  font-size: 0.85rem;
  color: var(--text-main);
  cursor: pointer;
}
.crop-toggle input {
  accent-color: var(--accent);
  width: 15px;
  height: 15px;
  cursor: pointer;
}
.crop-hint {
  margin-top: 0.4rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.5;
}

/* 表单 */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.7rem 0.8rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.field.full {
  grid-column: 1 / -1;
}
.field-label {
  font-size: 0.8rem;
  color: var(--text-muted);
}
.field-label .req {
  color: #dc2626;
}
.field-input {
  width: 100%;
}
.field-textarea {
  width: 100%;
  min-height: 90px;
  resize: vertical;
  line-height: 1.6;
}
.form-section-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-main);
  margin: 1rem 0 0.5rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--border);
}

/* 演员 */
.actor-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.actor-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.actor-row .glass-input {
  flex: 1;
  min-width: 0;
}
.actor-del {
  flex-shrink: 0;
  color: #dc2626;
}
.actor-add {
  align-self: flex-start;
}

.nfo-error {
  color: #dc2626;
  font-size: 0.85rem;
  padding: 0 1.3rem 0.6rem;
}

.glass-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .nfo-body {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .nfo-left,
  .nfo-right {
    overflow-y: visible;
  }
}
</style>
