import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { getAuth, isAuthEnabled } from '../config.js'

// 内存 token 池（重启失效，单机部署可接受）
const tokens = new Set<string>()

export const authRouter = Router()

// 认证状态：是否需要登录（前端据此决定是否弹登录框）
authRouter.get('/status', (_req, res) => {
  res.json({ authRequired: isAuthEnabled() })
})

authRouter.post('/login', (req, res) => {
  if (!isAuthEnabled()) {
    res.status(400).json({ error: '未启用登录' })
    return
  }
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string }
  const auth = getAuth()
  if (username === auth.username && password === auth.password) {
    const token = randomUUID()
    tokens.add(token)
    res.json({ token })
  } else {
    res.status(401).json({ error: '用户名或密码错误' })
  }
})

// 认证中间件：校验 Authorization: Bearer <token>；未配置账号密码则直接放行
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    next()
    return
  }
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
  if (token && tokens.has(token)) {
    next()
    return
  }
  res.status(401).json({ error: '未登录或登录已过期' })
}
