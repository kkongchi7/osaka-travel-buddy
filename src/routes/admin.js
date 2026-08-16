// 관리자 전용 — 멤버 프로필 변경·정지·삭제

import { randomBytes } from 'node:crypto'
import express from 'express'
import { colorTakenBy, hashPin, publicUser, requireAdmin, USER_COLORS } from '../auth.js'
import { db, nowIso, save, toggleLike } from '../db.js'
import { FALLBACK_AREA, FALLBACK_CATEGORY, getAreaRecords, getCategories } from '../meta.js'

const router = express.Router()
router.use(requireAdmin)

// ── 카테고리 ───────────────────────────────────────────
// 지우면 그 카테고리를 쓰던 장소는 '기타'로 옮겨간다. 이름을 바꾸면 장소도 따라 바뀐다.

const CATEGORY_RE = /^[가-힣a-zA-Z0-9·\-+&() ]{1,14}$/

function normalizeCategory(value) {
  return String(value ?? '').normalize('NFC').trim()
}

function countPlaces(name) {
  return (
    db().places.filter((p) => p.category === name).length +
    db().trash.filter((p) => p.category === name).length
  )
}

router.get('/categories', (req, res) => {
  res.json({
    categories: getCategories().map((name) => ({
      name,
      placeCount: countPlaces(name),
      fixed: name === FALLBACK_CATEGORY,
    })),
  })
})

router.post('/categories', async (req, res) => {
  const name = normalizeCategory(req.body?.name)
  if (!CATEGORY_RE.test(name)) {
    return res.status(400).json({ error: '카테고리 이름은 1~14자로 입력해주세요.' })
  }
  if (getCategories().includes(name)) {
    return res.status(409).json({ error: '이미 있는 카테고리예요.' })
  }
  // '기타'는 항상 마지막에 두어 목록이 정돈되게 한다
  const list = db().categories
  list.splice(Math.max(list.indexOf(FALLBACK_CATEGORY), 0), 0, name)
  await save(['categories'])
  res.status(201).json({ categories: getCategories() })
})

router.patch('/categories/:name', async (req, res) => {
  const from = normalizeCategory(req.params.name)
  const to = normalizeCategory(req.body?.name)

  const index = db().categories.indexOf(from)
  if (index < 0) return res.status(404).json({ error: '카테고리를 찾을 수 없어요.' })
  if (from === FALLBACK_CATEGORY) {
    return res.status(400).json({ error: `'${FALLBACK_CATEGORY}'는 이름을 바꿀 수 없어요.` })
  }
  if (!CATEGORY_RE.test(to)) {
    return res.status(400).json({ error: '카테고리 이름은 1~14자로 입력해주세요.' })
  }
  if (to !== from && getCategories().includes(to)) {
    return res.status(409).json({ error: '이미 있는 카테고리예요.' })
  }

  db().categories[index] = to
  let moved = 0
  for (const place of [...db().places, ...db().trash]) {
    if (place.category === from) {
      place.category = to
      moved++
    }
  }
  await save(['categories', 'places', 'trash'])
  res.json({ categories: getCategories(), moved })
})

// ── 지역 ───────────────────────────────────────────────
// 카테고리와 같은 규칙 + 자동 판정용 좌표(선택). 좌표가 없으면 수동 선택 전용이 된다.

function countPlacesByArea(name) {
  return (
    db().places.filter((p) => p.area === name).length +
    db().trash.filter((p) => p.area === name).length
  )
}

// lat/lng/radius 는 셋 다 있거나 셋 다 없어야 한다
function readGeo(body) {
  const has = (v) => v !== undefined && v !== null && v !== ''
  if (!has(body?.lat) && !has(body?.lng) && !has(body?.radius)) {
    return { lat: null, lng: null, radius: null }
  }
  const lat = Number(body.lat)
  const lng = Number(body.lng)
  const radius = Number(body.radius)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { error: '위도는 -90~90 사이여야 해요.' }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { error: '경도는 -180~180 사이여야 해요.' }
  if (!Number.isFinite(radius) || radius < 50 || radius > 100000) {
    return { error: '반경은 50~100000m 사이여야 해요.' }
  }
  return { lat, lng, radius }
}

router.get('/areas', (req, res) => {
  res.json({
    areas: getAreaRecords().map((area) => ({
      ...area,
      placeCount: countPlacesByArea(area.name),
      fixed: area.name === FALLBACK_AREA,
    })),
  })
})

router.post('/areas', async (req, res) => {
  const name = normalizeCategory(req.body?.name)
  if (!CATEGORY_RE.test(name)) {
    return res.status(400).json({ error: '지역 이름은 1~14자로 입력해주세요.' })
  }
  if (getAreaRecords().some((a) => a.name === name)) {
    return res.status(409).json({ error: '이미 있는 지역이에요.' })
  }
  const geo = readGeo(req.body)
  if (geo.error) return res.status(400).json({ error: geo.error })

  const list = db().areas
  const fallbackIndex = list.findIndex((a) => a.name === FALLBACK_AREA)
  list.splice(fallbackIndex < 0 ? list.length : fallbackIndex, 0, { name, ...geo })
  await save(['areas'])
  res.status(201).json({ areas: getAreaRecords() })
})

router.patch('/areas/:name', async (req, res) => {
  const from = normalizeCategory(req.params.name)
  const area = db().areas.find((a) => a.name === from)
  if (!area) return res.status(404).json({ error: '지역을 찾을 수 없어요.' })

  const geo = readGeo(req.body)
  if (geo.error) return res.status(400).json({ error: geo.error })

  let moved = 0
  if (req.body?.name !== undefined) {
    const to = normalizeCategory(req.body.name)
    if (from === FALLBACK_AREA && to !== FALLBACK_AREA) {
      return res.status(400).json({ error: `'${FALLBACK_AREA}'는 이름을 바꿀 수 없어요.` })
    }
    if (!CATEGORY_RE.test(to)) {
      return res.status(400).json({ error: '지역 이름은 1~14자로 입력해주세요.' })
    }
    if (to !== from && getAreaRecords().some((a) => a.name === to)) {
      return res.status(409).json({ error: '이미 있는 지역이에요.' })
    }
    if (to !== from) {
      area.name = to
      for (const place of [...db().places, ...db().trash]) {
        if (place.area === from) {
          place.area = to
          moved++
        }
      }
    }
  }

  // '기타'는 자동 판정 대상이 아니므로 좌표를 받지 않는다
  if (area.name !== FALLBACK_AREA) Object.assign(area, geo)

  await save(['areas', 'places', 'trash'])
  res.json({ areas: getAreaRecords(), moved })
})

router.delete('/areas/:name', async (req, res) => {
  const name = normalizeCategory(req.params.name)
  const index = db().areas.findIndex((a) => a.name === name)
  if (index < 0) return res.status(404).json({ error: '지역을 찾을 수 없어요.' })
  if (name === FALLBACK_AREA) {
    return res.status(400).json({ error: `'${FALLBACK_AREA}'는 삭제할 수 없어요.` })
  }

  db().areas.splice(index, 1)
  let moved = 0
  for (const place of [...db().places, ...db().trash]) {
    if (place.area === name) {
      place.area = FALLBACK_AREA
      moved++
    }
  }
  await save(['areas', 'places', 'trash'])
  res.json({ areas: getAreaRecords(), moved })
})

router.delete('/categories/:name', async (req, res) => {
  const name = normalizeCategory(req.params.name)
  const index = db().categories.indexOf(name)
  if (index < 0) return res.status(404).json({ error: '카테고리를 찾을 수 없어요.' })
  if (name === FALLBACK_CATEGORY) {
    return res.status(400).json({ error: `'${FALLBACK_CATEGORY}'는 삭제할 수 없어요.` })
  }

  db().categories.splice(index, 1)
  let moved = 0
  for (const place of [...db().places, ...db().trash]) {
    if (place.category === name) {
      place.category = FALLBACK_CATEGORY
      moved++
    }
  }
  await save(['categories', 'places', 'trash'])
  res.json({ categories: getCategories(), moved })
})

const NICKNAME_RE = /^[가-힣a-zA-Z0-9._-]{1,12}$/

router.get('/users', (req, res) => {
  const places = db().places
  const likes = db().likes
  res.json({
    users: db().users.map((user) => ({
      ...publicUser(user),
      createdAt: user.createdAt,
      placeCount: places.filter((p) => p.addedBy === user.id).length,
      likeCount: likes.filter((l) => l.userId === user.id).length,
    })),
  })
})

router.patch('/users/:id', async (req, res) => {
  const user = db().users.find((u) => u.id === req.params.id)
  if (!user) return res.status(404).json({ error: '멤버를 찾을 수 없어요.' })

  const { nickname, color, role, active } = req.body ?? {}

  if (typeof nickname === 'string') {
    const next = nickname.normalize('NFC').trim()
    if (!NICKNAME_RE.test(next)) {
      return res.status(400).json({ error: '닉네임은 한글·영문·숫자 1~12자로 입력해주세요.' })
    }
    if (db().users.some((u) => u.id !== user.id && u.nickname === next)) {
      return res.status(409).json({ error: '이미 사용 중인 닉네임이에요.' })
    }
    user.nickname = next
  }

  if (typeof color === 'string') {
    if (!USER_COLORS.includes(color)) {
      return res.status(400).json({ error: '고를 수 없는 색이에요.' })
    }
    const taken = colorTakenBy(color, user.id)
    if (taken) {
      return res.status(409).json({ error: `${taken.nickname}님이 이미 쓰고 있는 색이에요.` })
    }
    user.color = color
  }

  // PIN 은 해시로만 저장돼 원본을 볼 수 없다. 새로 지정하는 것만 가능하다.
  if (req.body?.pin !== undefined) {
    const pin = String(req.body.pin)
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN은 숫자 4자리로 입력해주세요.' })
    }
    const salt = randomBytes(16).toString('hex')
    user.pinSalt = salt
    user.pinHash = hashPin(pin, salt)
  }

  // 관리자가 자기 자신의 권한을 내리거나 스스로를 정지시키면 아무도 관리할 수 없게 된다
  if (role === 'admin' || role === 'member') {
    if (user.id === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: '자기 자신의 관리자 권한은 해제할 수 없어요.' })
    }
    user.role = role
  }

  if (typeof active === 'boolean') {
    if (user.id === req.user.id && !active) {
      return res.status(400).json({ error: '자기 자신은 정지할 수 없어요.' })
    }
    user.active = active
  }

  user.updatedAt = nowIso()
  await save(['users'])
  res.json({ user: publicUser(user) })
})

// 멤버를 지우면 그 사람이 올린 장소와 좋아요도 함께 사라진다
router.delete('/users/:id', async (req, res) => {
  const index = db().users.findIndex((u) => u.id === req.params.id)
  if (index < 0) return res.status(404).json({ error: '멤버를 찾을 수 없어요.' })
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: '자기 자신은 삭제할 수 없어요.' })
  }

  const removedPlaces = db().places.filter((p) => p.addedBy === req.params.id)
  const removedIds = new Set([
    ...removedPlaces.map((p) => p.id),
    // 쓰레기통에 있던 것도 함께 정리한다 (복원할 주인이 사라지므로)
    ...db().trash.filter((p) => p.addedBy === req.params.id).map((p) => p.id),
  ])

  db().users.splice(index, 1)
  db().places = db().places.filter((p) => !removedIds.has(p.id))
  db().trash = db().trash.filter((p) => !removedIds.has(p.id))

  const goneLikes = db().likes.filter(
    (l) => l.userId === req.params.id || removedIds.has(l.placeId)
  )
  for (const like of goneLikes) await toggleLike(like.placeId, like.userId)

  await save(['users', 'places', 'trash'])
  res.json({ ok: true, removedPlaces: removedPlaces.length })
})

export default router
