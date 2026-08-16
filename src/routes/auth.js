import { randomBytes } from 'node:crypto'
import express from 'express'
import {
  clearSession,
  colorTakenBy,
  hashPin,
  pickColor,
  publicUser,
  requireAuth,
  setSession,
  USER_COLORS,
  verifyPin,
} from '../auth.js'
import { db, newId, nowIso, save } from '../db.js'

const router = express.Router()

const NICKNAME_RE = /^[가-힣a-zA-Z0-9._-]{1,12}$/
const PIN_RE = /^\d{4}$/

// macOS 는 한글을 자모 분리(NFD)로 보내고 Windows 는 완성형(NFC)으로 보낸다.
// 정규화하지 않으면 같은 "재혁"이 서로 다른 닉네임이 된다.
function normalizeNickname(value) {
  return String(value ?? '').normalize('NFC').trim()
}

function validate(nickname, pin) {
  if (typeof nickname !== 'string' || !NICKNAME_RE.test(nickname.trim())) {
    return '닉네임은 한글·영문·숫자 1~12자로 입력해주세요.'
  }
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
    return 'PIN은 숫자 4자리로 입력해주세요.'
  }
  return null
}

router.post('/register', async (req, res) => {
  const nickname = normalizeNickname(req.body?.nickname)
  const pin = String(req.body?.pin ?? '')

  const error = validate(nickname, pin)
  if (error) return res.status(400).json({ error })

  if (db().users.some((u) => u.nickname === nickname)) {
    return res.status(409).json({ error: '이미 사용 중인 닉네임이에요.' })
  }

  const salt = randomBytes(16).toString('hex')
  const user = {
    id: newId('u'),
    nickname,
    color: pickColor(),
    pinSalt: salt,
    pinHash: hashPin(pin, salt),
    role: nickname === process.env.ADMIN_NICKNAME?.normalize('NFC').trim() ? 'admin' : 'member',
    active: true,
    createdAt: nowIso(),
  }
  db().users.push(user)
  await save(['users'])

  setSession(res, user.id)
  res.json({ user: publicUser(user) })
})

router.post('/login', async (req, res) => {
  const nickname = normalizeNickname(req.body?.nickname)
  const pin = String(req.body?.pin ?? '')

  const user = db().users.find((u) => u.nickname === nickname)
  // 닉네임 존재 여부를 노출하지 않도록 같은 메시지를 쓴다
  if (!user || !verifyPin(pin, user)) {
    return res.status(401).json({ error: '닉네임 또는 PIN이 올바르지 않아요.' })
  }
  if (!user.active) {
    return res.status(403).json({ error: '사용이 중지된 계정이에요.' })
  }

  setSession(res, user.id)
  res.json({ user: publicUser(user) })
})

router.post('/logout', (req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) })
})

// 본인 색상 변경. 지도에서 사람을 구분하는 용도라 서로 겹치지 않게 막는다.
router.patch('/me', requireAuth, async (req, res) => {
  const color = String(req.body?.color ?? '')
  if (!USER_COLORS.includes(color)) {
    return res.status(400).json({ error: '고를 수 없는 색이에요.' })
  }
  const taken = colorTakenBy(color, req.user.id)
  if (taken) {
    return res.status(409).json({ error: `${taken.nickname}님이 이미 쓰고 있는 색이에요.` })
  }

  req.user.color = color
  req.user.updatedAt = nowIso()
  await save(['users'])
  res.json({ user: publicUser(req.user) })
})

// 본인 PIN 변경 — 현재 PIN 을 확인한 뒤에만 바꿔준다
router.patch('/me/pin', requireAuth, async (req, res) => {
  const current = String(req.body?.currentPin ?? '')
  const next = String(req.body?.newPin ?? '')

  if (!verifyPin(current, req.user)) {
    return res.status(403).json({ error: '현재 PIN이 올바르지 않아요.' })
  }
  if (!PIN_RE.test(next)) {
    return res.status(400).json({ error: '새 PIN은 숫자 4자리로 입력해주세요.' })
  }

  const salt = randomBytes(16).toString('hex')
  req.user.pinSalt = salt
  req.user.pinHash = hashPin(next, salt)
  req.user.updatedAt = nowIso()
  await save(['users'])
  res.json({ ok: true })
})

export default router
