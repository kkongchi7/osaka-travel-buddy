// 닉네임 + PIN 인증. 세션은 HMAC 서명 쿠키 하나로 유지한다.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db, nowIso, save } from './db.js'

const COOKIE = 'otb_session'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

// 멤버마다 하나씩 배정되는 마커·뱃지 색 (Apple 시스템 컬러 계열).
// 지도에서 누가 올렸는지 구분하는 용도라 서로 겹치지 않게 관리한다.
export const USER_COLORS = [
  '#0071e3', // 파랑
  '#ff375f', // 핑크
  '#ff9f0a', // 주황
  '#30d158', // 초록
  '#bf5af2', // 보라
  '#64d2ff', // 하늘
  '#ff6482', // 살구
  '#ffd60a', // 노랑
  '#5e5ce6', // 인디고
  '#00c7be', // 민트
]

/** 다른 멤버가 이미 쓰고 있는 색인지 */
export function colorTakenBy(color, exceptUserId) {
  return db().users.find((u) => u.id !== exceptUserId && u.color === color) ?? null
}

let secret = process.env.SESSION_SECRET
if (!secret) {
  secret = randomBytes(32).toString('hex')
  const where = process.env.NODE_ENV === 'production' ? '배포 환경' : '개발'
  console.warn(`[auth] SESSION_SECRET 미설정 (${where}) — 임시 키 사용. 재배포·재시작하면 전원 로그아웃됩니다.`)
}

export function hashPin(pin, salt) {
  return scryptSync(String(pin), salt, 32).toString('hex')
}

export function verifyPin(pin, user) {
  const candidate = Buffer.from(hashPin(pin, user.pinSalt), 'hex')
  const stored = Buffer.from(user.pinHash, 'hex')
  return candidate.length === stored.length && timingSafeEqual(candidate, stored)
}

export function pickColor() {
  const used = new Set(db().users.map((u) => u.color))
  return USER_COLORS.find((c) => !used.has(c)) || USER_COLORS[db().users.length % USER_COLORS.length]
}

function sign(value) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

// 배포(HTTPS)에서는 secure 를 켠다. 로컬 http 개발에서는 꺼야 쿠키가 저장된다.
const SECURE_COOKIE = process.env.NODE_ENV === 'production'

export function setSession(res, userId) {
  const payload = `${userId}.${Date.now()}`
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE_COOKIE,
    maxAge: MAX_AGE_MS,
    path: '/',
  })
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/', secure: SECURE_COOKIE, sameSite: 'lax' })
}

function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

// 모든 요청에 req.user 를 붙인다 (비로그인이면 null)
export function attachUser(req, res, next) {
  req.user = null
  const raw = parseCookies(req.headers.cookie)[COOKIE]
  if (raw) {
    const idx = raw.lastIndexOf('.')
    const payload = raw.slice(0, idx)
    const mac = raw.slice(idx + 1)
    const expected = sign(payload)
    if (
      mac.length === expected.length &&
      timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
    ) {
      const [userId, issuedAt] = payload.split('.')
      if (Date.now() - Number(issuedAt) < MAX_AGE_MS) {
        const user = db().users.find((u) => u.id === userId)
        if (user && user.active) req.user = user
      }
    }
  }
  next()
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' })
  next()
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' })
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
  next()
}

export function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    nickname: user.nickname,
    color: user.color,
    role: user.role,
    active: user.active,
  }
}

// ADMIN_NICKNAME 과 일치하는 유저를 부팅 시 관리자로 승격
export async function syncAdmin() {
  const target = process.env.ADMIN_NICKNAME?.normalize('NFC').trim()
  if (!target) return
  const user = db().users.find((u) => u.nickname === target)
  if (user && user.role !== 'admin') {
    user.role = 'admin'
    user.updatedAt = nowIso()
    await save(['users'])
    console.log(`[auth] '${target}' 를 관리자로 설정`)
  }
}
