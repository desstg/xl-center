import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Library {
  name: string
  path: string
  type: 'film' | 'tv'
}

export interface Config {
  host: string
  port: number
  libraries: Library[]
  actorIndexFile: string
}

const defaultConfig: Config = {
  host: '0.0.0.0',
  port: 8899,
  libraries: [],
  actorIndexFile: '',
}

// config.json 固定位于项目根目录（server/ 的上一级）
const __dirname = dirname(fileURLToPath(import.meta.url))
const configPath = resolve(__dirname, '../../config.json')

export function loadConfig(): Config {
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Config>
    return { ...defaultConfig, ...parsed }
  } catch {
    return defaultConfig
  }
}

const projectRoot = resolve(__dirname, '../..')

/** 把相对项目根目录的路径解析为绝对路径 */
export function resolveProjectPath(p: string): string {
  return resolve(projectRoot, p)
}

export interface AuthConfig {
  username: string
  password: string
}

// 账号密码从环境变量读取（docker-compose 里设置），两个都为空则关闭登录
export function getAuth(): AuthConfig {
  return {
    username: process.env.AUTH_USERNAME ?? '',
    password: process.env.AUTH_PASSWORD ?? '',
  }
}

export function isAuthEnabled(): boolean {
  const a = getAuth()
  return !!(a.username && a.password)
}
