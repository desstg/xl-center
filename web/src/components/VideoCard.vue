<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Heart } from 'lucide-vue-next'
import { thumbUrl, toggleFavorite, type Movie } from '../api'
import { showToast } from '../toast'

const props = defineProps<{ movie: Movie }>()
const emit = defineEmits<{ favoriteChanged: [id: number, favorite: boolean] }>()
const router = useRouter()

const PLACEHOLDER = '/placeholder-poster.svg'
const poster = computed(() => thumbUrl(props.movie.library_id, props.movie.poster || props.movie.fanart, 300) || PLACEHOLDER)
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
</script>

<template>
  <div class="video-card" @click="router.push(`/movies/${movie.id}`)">
    <div class="card-cover">
      <img v-if="poster" :src="poster" :alt="movie.title" loading="lazy" />
      <div v-else class="placeholder">{{ movie.title }}</div>
      <span v-if="isStrm" class="strm-badge">STRM</span>
      <button class="card-fav" @click.stop="onToggleFavorite">
        <Heart :size="15" :color="movie.favorite ? '#ff4757' : '#fff'" :fill="movie.favorite ? '#ff4757' : 'none'" />
      </button>
    </div>
    <div class="card-content">
      <div class="card-title">{{ movie.title }}</div>
      <div class="card-meta">
        <span v-if="movie.year">{{ movie.year }}</span>
        <span v-if="movie.rating">★ {{ movie.rating }}</span>
        <span v-if="movie.runtime">{{ movie.runtime }}min</span>
      </div>
    </div>
  </div>
</template>
