// ---------- 类型 ----------

export interface Library {
  id: number
  name: string
  path: string
  paths?: string[]
  type: 'film' | 'tv'
  enabled: number
  item_count?: number
  posters?: string[]
}

export interface Movie {
  id: number
  library_id: number
  title: string
  num?: string
  favorite?: boolean
  file_size?: number
  file_count?: number
  video_codec?: string
  video_width?: number
  video_height?: number
  video_bitrate?: number
  original_title?: string
  year?: number
  plot?: string
  outline?: string
  rating?: number
  votes?: number
  runtime?: number
  mpaa?: string
  premiered?: string
  poster?: string
  fanart?: string
  thumb?: string
  logo?: string
  banner?: string
  trailer?: string
  nfo_path?: string
  video_path?: string
  library_name?: string
  genres?: string[]
  tags?: string[]
  countries?: string[]
  studios?: string[]
  directors?: string[]
  writers?: string[]
  actors?: Actor[]
  stills?: string[]
  subtitles?: Subtitle[]
}

export interface Actor {
  id: number
  name: string
  role?: string
  thumb?: string
  aliases: string[]
  count?: number
  alias_count?: number
  movie_count?: number
  created_at?: string
}

export interface ActorListResult {
  items: Actor[]
  total: number
  page: number
  limit: number
  stats: { associated: number; unused: number }
}

export interface Subtitle {
  path: string
  language?: string
  codec?: string
}

export interface ListResult<T> {
  items: T[]
  total: number
  page: number
  limit: number
}

export interface MovieQuery {
  q?: string
  actors?: string
  tags?: string
  genres?: string
  num?: string
  filename?: string
  year?: string
  library?: number
  match?: 'all' | 'any'
  sort?: string
  page?: number
  limit?: number
}

export interface StreamInfo {
  mode: 'direct' | 'hls' | 'strm'
  url: string
  playable?: boolean
  title?: string
  codec?: string
  subtitles: Subtitle[]
}

// ---------- 认证 ----------

const TOKEN_KEY = 'xl-auth-token'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function isAuthed(): boolean {
  return !!getToken()
}

/** 登录，成功保存 token */
export async function login(username: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    let message = '登录失败'
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      // 忽略非 JSON
    }
    throw new Error(message)
  }
  const data = (await res.json()) as { token: string }
  setToken(data.token)
}

export interface AuthStatus {
  authRequired: boolean
}

/** 查询是否需要登录（后端未配置账号密码则返回 authRequired: false） */
export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status')
  if (!res.ok) throw new Error('获取认证状态失败')
  return res.json()
}

// ---------- 工具 ----------

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  })
  if (res.status === 401) {
    clearToken()
    window.dispatchEvent(new Event('auth-expired'))
    throw new Error('未登录或登录已过期')
  }
  if (!res.ok) {
    let message = `请求失败 (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      // 忽略非 JSON
    }
    throw new Error(message)
  }
  return res.json()
}

/** 拼接媒体库内图片 URL */
export function imageUrl(libraryId: number, path?: string): string {
  if (!path) return ''
  return `/images/${libraryId}/${path}`
}

/** 缩略图 URL（海报墙用小图，加速加载） */
export function thumbUrl(libraryId: number, path?: string, width = 300): string {
  if (!path) return ''
  return `/images/thumb/${libraryId}/${path}?w=${width}`
}

/** 直连/HLS 播放 URL 转绝对地址（开发用相对，生产同源） */
export function streamUrl(path: string): string {
  return path
}

// ---------- 媒体库 ----------

export function getLibraries(): Promise<Library[]> {
  return request('/api/libraries')
}

export function addLibrary(data: { name: string; paths: string[]; type: string }): Promise<Library> {
  return request('/api/libraries', { method: 'POST', body: JSON.stringify(data) })
}

export function updateLibrary(id: number, data: { name?: string; paths?: string[]; type?: string }): Promise<Library> {
  return request(`/api/libraries/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteLibrary(id: number): Promise<{ ok: boolean }> {
  return request(`/api/libraries/${id}`, { method: 'DELETE' })
}

export function scanLibrary(libraryId?: number, limit?: number): Promise<{ started: boolean }> {
  const qs = limit ? `?limit=${limit}` : ''
  return request(`/api/scan${qs}`, {
    method: 'POST',
    body: JSON.stringify(libraryId ? { libraryId } : {}),
  })
}

export interface ScanProgress {
  running: boolean
  manual: boolean
  libraryName: string
  mode?: 'scan' | 'refresh'
  total: number
  scanned: number
  added: number
  current: string
}

export function getScanStatus(): Promise<ScanProgress> {
  return request('/api/scan/status')
}

export function refreshLibrary(id: number): Promise<{ started: boolean }> {
  return request(`/api/libraries/${id}/refresh`, { method: 'POST' })
}

// ---------- 电影 ----------

export function getMovies(query: MovieQuery = {}): Promise<ListResult<Movie>> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return request(`/api/movies${qs ? '?' + qs : ''}`)
}

/** 仪表板「最近添加」：每库均衡抽样后的影片列表 */
export function getRecentMovies(): Promise<Movie[]> {
  return request<{ items: Movie[] }>('/api/movies/recent').then((r) => r.items)
}

export function getMovie(id: number): Promise<Movie> {
  return request(`/api/movies/${id}`)
}

export function getRelatedMovies(id: number): Promise<Movie[]> {
  return request(`/api/movies/${id}/related`)
}

export function toggleFavorite(id: number): Promise<{ favorite: boolean }> {
  return request(`/api/movies/${id}/favorite`, { method: 'POST' })
}

/** 删除影片：mode=info 只删入库信息；mode=all 连本地文件一起删 */
export function deleteMovie(id: number, mode: 'info' | 'all'): Promise<{ ok: boolean }> {
  return request(`/api/movies/${id}?mode=${mode}`, { method: 'DELETE' })
}

/** 刷新单部影片的元数据（重新读取该影片文件夹的 NFO/图片） */
export function refreshMovieMetadata(id: number): Promise<{ ok: boolean }> {
  return request(`/api/movies/${id}/refresh`, { method: 'POST' })
}

// ---------- 编辑 NFO ----------

export interface NfoActorInput {
  name: string
  role?: string
  thumb?: string
}

export interface NfoUpdate {
  title: string
  num?: string
  originalTitle?: string
  year?: number
  plot?: string
  outline?: string
  rating?: number
  votes?: number
  runtime?: number
  mpaa?: string
  premiered?: string
  trailer?: string
  genres: string[]
  tags: string[]
  countries: string[]
  studios: string[]
  directors: string[]
  writers: string[]
  actors: NfoActorInput[]
}

export function updateMovieNfo(id: number, data: NfoUpdate): Promise<{ ok: boolean }> {
  return request(`/api/movies/${id}/nfo`, { method: 'PUT', body: JSON.stringify(data) })
}

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export function cropPoster(id: number, rect: CropRect): Promise<{ ok: boolean; poster: string }> {
  return request(`/api/movies/${id}/poster`, { method: 'POST', body: JSON.stringify(rect) })
}

export function getFavorites(): Promise<Movie[]> {
  return request('/api/favorites')
}

export interface Stats {
  today: number
  week: number
  month: number
}

export function getStats(): Promise<Stats> {
  return request('/api/stats')
}

export function getStreamInfo(id: number, opts?: { hevc?: boolean }): Promise<StreamInfo> {
  const q = opts?.hevc ? '?hevc=1' : ''
  return request(`/stream/info/movie/${id}${q}`)
}

// ---------- 字幕下载 ----------

export interface SubtitleItem {
  name: string
  url: string
  ext: string
  langs: string
  score: number
  duration: number
  extraName: string
}

export function searchSubtitles(query: string): Promise<SubtitleItem[]> {
  return request<{ items: SubtitleItem[] }>(`/api/subtitles/search?query=${encodeURIComponent(query)}`).then((r) => r.items)
}

export function downloadSubtitle(data: { movieId: number; url: string; ext: string; lang?: string }): Promise<{ ok: boolean; path: string }> {
  return request('/api/subtitles/download', { method: 'POST', body: JSON.stringify(data) })
}

// ---------- 下拉数据 ----------

export function getActors(q?: string, page?: number, limit?: number): Promise<ActorListResult> {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (page) params.set('page', String(page))
  if (limit) params.set('limit', String(limit))
  const qs = params.toString()
  return request(`/api/actors${qs ? '?' + qs : ''}`)
}

export function addActor(name: string): Promise<Actor> {
  return request('/api/actors', { method: 'POST', body: JSON.stringify({ name }) })
}

export function updateActor(id: number, data: { name: string; aliases?: string[] }): Promise<Actor> {
  return request(`/api/actors/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteActor(id: number): Promise<{ ok: boolean }> {
  return request(`/api/actors/${id}`, { method: 'DELETE' })
}

export interface TaxonomyItem {
  id: number
  name: string
  movie_count: number
  created_at: string
}

export interface TaxonomyListResult {
  items: TaxonomyItem[]
  total: number
  page: number
  limit: number
  stats: { associated: number; unused: number }
}

function taxonomyRequest(path: string, q?: string, page?: number, limit?: number): Promise<TaxonomyListResult> {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (page) params.set('page', String(page))
  if (limit) params.set('limit', String(limit))
  const qs = params.toString()
  return request<TaxonomyListResult>(`${path}${qs ? '?' + qs : ''}`)
}

export function getTags(q?: string, page?: number, limit?: number): Promise<TaxonomyListResult> {
  return taxonomyRequest('/api/tags', q, page, limit)
}

export function getGenres(q?: string, page?: number, limit?: number): Promise<TaxonomyListResult> {
  return taxonomyRequest('/api/genres', q, page, limit)
}

export function addTag(name: string): Promise<TaxonomyItem> {
  return request('/api/tags', { method: 'POST', body: JSON.stringify({ name }) })
}
export function updateTag(id: number, name: string): Promise<TaxonomyItem> {
  return request(`/api/tags/${id}`, { method: 'PUT', body: JSON.stringify({ name }) })
}
export function deleteTag(id: number): Promise<{ ok: boolean }> {
  return request(`/api/tags/${id}`, { method: 'DELETE' })
}
export function addGenre(name: string): Promise<TaxonomyItem> {
  return request('/api/genres', { method: 'POST', body: JSON.stringify({ name }) })
}
export function updateGenre(id: number, name: string): Promise<TaxonomyItem> {
  return request(`/api/genres/${id}`, { method: 'PUT', body: JSON.stringify({ name }) })
}
export function deleteGenre(id: number): Promise<{ ok: boolean }> {
  return request(`/api/genres/${id}`, { method: 'DELETE' })
}

// ---------- 目录浏览 ----------

export interface FsBrowse {
  path: string
  parent: string | null
  dirs: { name: string; path: string }[]
  shortcuts: string[]
}

export function browseDir(path: string): Promise<FsBrowse> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : ''
  return request(`/api/fs/browse${qs}`)
}
