<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Heart } from 'lucide-vue-next'
import { thumbUrl, toggleFavorite, type Movie } from '../api'
import { showToast } from '../toast'

const props = defineProps<{ movie: Movie }>()
const emit = defineEmits<{ favoriteChanged: [id: number, favorite: boolean] }>()
const router = useRouter()

const PLACEHOLDER = '/placeholder-fanart.svg'
const fanart = computed(() => thumbUrl(props.movie.library_id, props.movie.fanart || props.movie.poster, 400) || PLACEHOLDER)
const isStrm = computed(() => (props.movie.video_path || '').toLowerCase().endsWith('.strm'))

async function onToggleFavorite() {
  try {
    const r = await toggleFavorite(props.movie.id)
    props.movie.favorite = r.favorite
    emit('favoriteChanged', props.movie.id, r.favorite)
    showToast(r.favorite ? '已加入收藏' : '已取消收藏')
  } catch {
    // 忽略错误
  }
}
const title = computed(() => {
  let t = props.movie.title || ''
  const n = props.movie.num
  if (n && t.startsWith(n)) t = t.slice(n.length)
  return t.replace(/^\s+/, '')
})
</script>

<template>
  <div class="fanart-card" @click="router.push(`/movies/${movie.id}`)">
    <div class="fanart-cover">
      <img :src="fanart" :alt="movie.title" loading="lazy" />
      <span v-if="isStrm" class="strm-badge">STRM</span>
    </div>
    <button class="card-fav" @click.stop="onToggleFavorite">
      <Heart :size="15" :color="movie.favorite ? '#ff4757' : '#fff'" :fill="movie.favorite ? '#ff4757' : 'none'" />
    </button>
    <div class="fanart-meta">
      <div class="fanart-row">
        <span class="fanart-num">{{ movie.num || '' }}</span>
        <span class="fanart-date">{{ movie.year || '' }}</span>
      </div>
      <div class="fanart-title" :title="title">{{ title }}</div>
    </div>
  </div>
</template>

<style scoped>
.fanart-card {
  position: relative;
  cursor: pointer;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-card);
  transition: box-shadow 0.2s, transform 0.2s;
}
.fanart-card:hover {
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
  transform: translateY(-2px);
}
.fanart-cover {
  position: relative;
}
.fanart-cover img {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  display: block;
}
.fanart-meta {
  padding: 0.5rem 0.7rem 0.6rem;
}
.fanart-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.fanart-num {
  color: var(--accent);
  font-weight: 600;
  font-size: 0.8rem;
}
.fanart-date {
  color: var(--text-muted);
  font-size: 0.78rem;
}
.fanart-title {
  margin-top: 0.25rem;
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
