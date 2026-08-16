import express from 'express'
import { publicUser, requireAdmin, requireAuth } from '../auth.js'
import { db, nowIso, save, toggleLike } from '../db.js'
import { getAreas, getCategories } from '../meta.js'
import { placesAvailable } from '../places.js'
import {
  applyEdits,
  buildCandidate,
  createPlace,
  findByGooglePlaceId,
  NotInJapanError,
  serializePlace,
  toggleFlag,
} from '../placeModel.js'
import { resolvePlace, resolveRedirect, searchByName } from '../resolve.js'
import { isSavedListUrl, previewSavedList } from '../savedList.js'

const router = express.Router()

function requireGoogle(req, res, next) {
  if (!placesAvailable()) {
    return res.status(503).json({ error: '서버에 구글 API 키가 설정되지 않았어요.' })
  }
  next()
}

// 한글 받침 유무에 따라 조사를 고른다 ("경복궁은" / "도톤보리는")
function withJosa(word, withBatchim, withoutBatchim) {
  const last = String(word ?? '').trim().at(-1) ?? ''
  const code = last.charCodeAt(0)
  const isHangul = code >= 0xac00 && code <= 0xd7a3
  const hasBatchim = isHangul ? (code - 0xac00) % 28 !== 0 : /[a-zA-Z0-9]/.test(last)
  return `${word}${hasBatchim ? withBatchim : withoutBatchim}`
}

function notInJapanMessage(error) {
  const name = error.placeName ?? '이 장소'
  return `${withJosa(name, '은', '는')} 일본에 있지 않아요. 일본 장소만 등록할 수 있습니다.`
}

// 고정된 장소는 관리자만 손댈 수 있다
function assertEditable(place, user) {
  if (place.locked?.value && user.role !== 'admin') {
    return '관리자가 고정한 장소예요. 수정할 수 없습니다.'
  }
  return null
}

// ── 미리보기 ────────────────────────────────────────────
// 저장하지 않고 해석 결과만 돌려준다. 사용자가 확인 후 등록한다.

router.post('/preview', requireAuth, requireGoogle, async (req, res) => {
  const input = String(req.body?.url ?? '').trim()
  if (!input) return res.status(400).json({ error: '링크를 입력해주세요.' })

  try {
    // 저장 목록 링크면 여러 개짜리 흐름으로 넘긴다
    const finalUrl = await resolveRedirect(input)
    if (isSavedListUrl(finalUrl)) {
      return res.json({ kind: 'list', url: input })
    }

    const resolved = await resolvePlace(input)
    if (resolved.error) {
      return res.status(422).json({
        error: resolved.error,
        needsManualSearch: Boolean(resolved.needsManualSearch),
      })
    }

    const existing = findByGooglePlaceId(resolved.placeId)
    if (existing) {
      const owner = db().users.find((u) => u.id === existing.addedBy)
      return res.status(409).json({
        error: 'duplicate',
        message: `이미 ${owner?.nickname ?? '누군가'}님이 올린 장소예요.`,
        placeId: existing.id,
        name: existing.name,
        addedBy: publicUser(owner),
      })
    }

    const candidate = await buildCandidate(resolved.placeId)
    res.json({
      kind: 'place',
      candidate,
      confidence: resolved.confidence,
      method: resolved.method,
      alternatives: resolved.candidates ?? [],
    })
  } catch (e) {
    if (e instanceof NotInJapanError) {
      return res.status(422).json({ error: notInJapanMessage(e), address: e.address })
    }
    console.error('[places] preview 실패:', e.message)
    res.status(500).json({ error: '장소 정보를 가져오지 못했어요. 잠시 후 다시 시도해주세요.' })
  }
})

// 저장 목록 링크 → 매칭된 후보 여러 개
router.post('/preview-list', requireAuth, requireGoogle, async (req, res) => {
  const input = String(req.body?.url ?? '').trim()
  if (!input) return res.status(400).json({ error: '링크를 입력해주세요.' })

  try {
    const result = await previewSavedList(input)
    const items = result.items.map((item) => {
      const existing = item.matched ? findByGooglePlaceId(item.matched.placeId) : null
      return {
        ...item,
        duplicate: existing
          ? { placeId: existing.id, addedBy: publicUser(db().users.find((u) => u.id === existing.addedBy)) }
          : null,
      }
    })
    res.json({ title: result.title, total: result.total, items })
  } catch (e) {
    console.error('[places] preview-list 실패:', e.message)
    res.status(500).json({ error: e.message || '목록을 가져오지 못했어요.' })
  }
})

// 링크 해석 실패 시 이름으로 직접 검색
router.post('/search', requireAuth, requireGoogle, async (req, res) => {
  const query = String(req.body?.query ?? '').trim()
  if (query.length < 2) return res.status(400).json({ error: '두 글자 이상 입력해주세요.' })
  try {
    res.json({ results: await searchByName(query) })
  } catch (e) {
    console.error('[places] search 실패:', e.message)
    res.status(500).json({ error: '검색에 실패했어요.' })
  }
})

// ── 등록 ───────────────────────────────────────────────

router.post('/', requireAuth, requireGoogle, async (req, res) => {
  const googlePlaceId = String(req.body?.googlePlaceId ?? '').trim()
  if (!googlePlaceId) return res.status(400).json({ error: '장소를 선택해주세요.' })

  const existing = findByGooglePlaceId(googlePlaceId)
  if (existing) {
    const owner = db().users.find((u) => u.id === existing.addedBy)
    return res.status(409).json({
      error: 'duplicate',
      message: `이미 ${owner?.nickname ?? '누군가'}님이 올린 장소예요.`,
      placeId: existing.id,
      name: existing.name,
      addedBy: publicUser(owner),
    })
  }

  try {
    const candidate = await buildCandidate(googlePlaceId)
    const place = createPlace(candidate, {
      userId: req.user.id,
      category: req.body?.category,
      area: req.body?.area,
      name: req.body?.name,
      memo: req.body?.memo,
    })
    db().places.push(place)
    await save(['places'])
    res.status(201).json({ place: serializePlace(place, req.user.id) })
  } catch (e) {
    if (e instanceof NotInJapanError) {
      return res.status(422).json({ error: notInJapanMessage(e) })
    }
    console.error('[places] 등록 실패:', e.message)
    res.status(500).json({ error: '장소를 저장하지 못했어요.' })
  }
})

// 저장 목록에서 고른 여러 장소를 한 번에 등록
router.post('/bulk', requireAuth, requireGoogle, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  if (!items.length) return res.status(400).json({ error: '등록할 장소가 없어요.' })
  if (items.length > 100) return res.status(400).json({ error: '한 번에 100개까지만 등록할 수 있어요.' })

  const added = []
  const skipped = []
  const failed = []

  for (const item of items) {
    const googlePlaceId = String(item?.googlePlaceId ?? '').trim()
    if (!googlePlaceId) continue
    if (findByGooglePlaceId(googlePlaceId)) {
      skipped.push({ googlePlaceId, reason: 'duplicate' })
      continue
    }
    try {
      const candidate = await buildCandidate(googlePlaceId)
      const place = createPlace(candidate, {
        userId: req.user.id,
        category: item.category,
        area: item.area,
        name: item.name,
        memo: item.memo,
      })
      db().places.push(place)
      added.push(serializePlace(place, req.user.id))
    } catch (e) {
      if (e instanceof NotInJapanError) {
        skipped.push({ googlePlaceId, name: e.placeName, reason: 'not_in_japan' })
        continue
      }
      console.error('[places] bulk 항목 실패:', googlePlaceId, e.message)
      failed.push({ googlePlaceId, name: item.name ?? null, reason: e.message })
    }
  }

  await save(['places'])
  res.json({ added, addedCount: added.length, skipped, failed })
})

// ── 조회 ───────────────────────────────────────────────

router.get('/', (req, res) => {
  const viewerId = req.user?.id ?? null
  res.json({
    places: db().places.map((p) => serializePlace(p, viewerId)),
    users: db().users.map(publicUser),
    categories: getCategories(),
    areas: getAreas(),
  })
})

// ── 쓰레기통 ───────────────────────────────────────────
// 삭제해도 바로 지우지 않고 옮겨둔다. 좋아요는 그대로 남겨 복원 시 되살아나게 한다.
// (경로가 두 칸이라 아래의 /:id 라우트와 겹치지 않는다)

function canManageTrash(entry, user) {
  return user.role === 'admin' || entry.addedBy === user.id || entry.deletedBy === user.id
}

router.get('/trash', requireAuth, (req, res) => {
  const items = db()
    .trash.filter((entry) => canManageTrash(entry, req.user))
    .sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      area: entry.area,
      rating: entry.rating ?? null,
      hasPhoto: Boolean(entry.photo?.ref),
      addedBy: entry.addedBy,
      deletedBy: entry.deletedBy,
      deletedAt: entry.deletedAt,
    }))
  res.json({ items, users: db().users.map(publicUser) })
})

router.post('/trash/:id/restore', requireAuth, async (req, res) => {
  const index = db().trash.findIndex((entry) => entry.id === req.params.id)
  if (index < 0) return res.status(404).json({ error: '쓰레기통에서 찾을 수 없어요.' })

  const entry = db().trash[index]
  if (!canManageTrash(entry, req.user)) {
    return res.status(403).json({ error: '복원할 권한이 없어요.' })
  }
  // 버린 사이에 같은 장소를 다시 등록했다면 되돌릴 수 없다
  if (findByGooglePlaceId(entry.googlePlaceId)) {
    return res.status(409).json({ error: '같은 장소가 이미 다시 등록돼 있어요.' })
  }

  db().trash.splice(index, 1)
  delete entry.deletedBy
  delete entry.deletedAt
  db().places.push(entry)
  await save(['places', 'trash'])
  res.json({ place: serializePlace(entry, req.user.id) })
})

router.delete('/trash/:id', requireAuth, async (req, res) => {
  const index = db().trash.findIndex((entry) => entry.id === req.params.id)
  if (index < 0) return res.status(404).json({ error: '쓰레기통에서 찾을 수 없어요.' })
  if (!canManageTrash(db().trash[index], req.user)) {
    return res.status(403).json({ error: '삭제할 권한이 없어요.' })
  }

  const [removed] = db().trash.splice(index, 1)
  for (const like of db().likes.filter((l) => l.placeId === removed.id)) {
    await toggleLike(like.placeId, like.userId)
  }
  await save(['trash'])
  res.json({ ok: true })
})

// ── 수정 / 삭제 ─────────────────────────────────────────

// 장소명·카테고리·지역·메모는 누구나 수정 가능 (고정되지 않은 경우)
router.patch('/:id', requireAuth, async (req, res) => {
  const place = db().places.find((p) => p.id === req.params.id)
  if (!place) return res.status(404).json({ error: '장소를 찾을 수 없어요.' })

  const blocked = assertEditable(place, req.user)
  if (blocked) return res.status(403).json({ error: blocked })

  const changed = applyEdits(place, req.body ?? {}, req.user.id)
  if (!changed.length) {
    return res.json({ place: serializePlace(place, req.user.id), changed: [] })
  }
  await save(['places'])
  res.json({ place: serializePlace(place, req.user.id), changed })
})

// 삭제는 올린 사람 또는 관리자. 바로 지우지 않고 쓰레기통으로 옮긴다.
router.delete('/:id', requireAuth, async (req, res) => {
  const index = db().places.findIndex((p) => p.id === req.params.id)
  if (index < 0) return res.status(404).json({ error: '장소를 찾을 수 없어요.' })

  const place = db().places[index]
  const isOwner = place.addedBy === req.user.id
  if (!isOwner && req.user.role !== 'admin') {
    return res.status(403).json({ error: '올린 사람이나 관리자만 삭제할 수 있어요.' })
  }
  const blocked = assertEditable(place, req.user)
  if (blocked) return res.status(403).json({ error: blocked })

  db().places.splice(index, 1)
  place.deletedBy = req.user.id
  place.deletedAt = nowIso()
  db().trash.push(place)
  await save(['places', 'trash'])
  res.json({ ok: true, trashed: true })
})

// ── 반응 ───────────────────────────────────────────────

// 좋아요는 개인 의견이라 고정된 장소에도 계속 누를 수 있다
router.post('/:id/like', requireAuth, async (req, res) => {
  const place = db().places.find((p) => p.id === req.params.id)
  if (!place) return res.status(404).json({ error: '장소를 찾을 수 없어요.' })

  // 여러 명이 동시에 눌러도 서로의 좋아요를 지우지 않도록 저장소의 원자 연산을 쓴다
  await toggleLike(place.id, req.user.id)
  res.json({ place: serializePlace(place, req.user.id) })
})

for (const field of ['confirmed', 'visited']) {
  router.post(`/:id/${field}`, requireAuth, async (req, res) => {
    const place = db().places.find((p) => p.id === req.params.id)
    if (!place) return res.status(404).json({ error: '장소를 찾을 수 없어요.' })

    const blocked = assertEditable(place, req.user)
    if (blocked) return res.status(403).json({ error: blocked })

    toggleFlag(place, field, req.user.id)
    await save(['places'])
    res.json({ place: serializePlace(place, req.user.id) })
  })
}

// 고정 — 관리자 전용. 켜면 이후 수정·삭제·확정·다녀옴이 모두 잠긴다.
router.post('/:id/lock', requireAdmin, async (req, res) => {
  const place = db().places.find((p) => p.id === req.params.id)
  if (!place) return res.status(404).json({ error: '장소를 찾을 수 없어요.' })

  const next = !place.locked?.value
  place.locked = { value: next, by: next ? req.user.id : null, at: next ? nowIso() : null }
  await save(['places'])
  res.json({ place: serializePlace(place, req.user.id) })
})

export default router
