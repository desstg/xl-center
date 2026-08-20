import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('./pages/Dashboard.vue') },
    { path: '/movies', name: 'movies', component: () => import('./pages/MoviesPage.vue') },
    { path: '/movies/:id', name: 'movie-detail', component: () => import('./pages/MovieDetail.vue') },
    { path: '/favorites', name: 'favorites', component: () => import('./pages/FavoritesPage.vue') },
    { path: '/series', name: 'series', component: () => import('./pages/SeriesPage.vue') },
    { path: '/actors', name: 'actors', component: () => import('./pages/ActorsPage.vue') },
    { path: '/genres', name: 'genres', component: () => import('./pages/GenresPage.vue') },
    { path: '/tags', name: 'tags', component: () => import('./pages/TagsPage.vue') },
    { path: '/libraries', name: 'libraries', component: () => import('./pages/LibrariesPage.vue') },
    { path: '/settings', name: 'settings', component: () => import('./pages/SettingsPage.vue') },
  ],
})

export default router
