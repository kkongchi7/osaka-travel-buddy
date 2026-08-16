// 장소 레코드 생성·수정 규칙
//
// 사실 정보(이름·주소·좌표·사진·리뷰)는 구글에서 오고,
// 분류 정보(카테고리·지역)와 그룹 상태(좋아요·확정·다녀옴·고정)는 우리가 관리한다.
// 카테고리·지역·장소명은 누구나 고칠 수 있으므로 변경 이력을 함께 남긴다.

import { db, newId, nowIso } from './db.js'
import {
  areaFromCoords,
  categoryFromTypes,
  FALLBACK_AREA,
  FALLBACK_CATEGORY,
  isValidArea,
  isValidCategory,
} from './meta.js'
import { getDetails, normalizeDetails } from './places.js'

const HISTORY_LIMIT = 20

// 사용자가 직접 고칠 수 있는 필드
export const EDITABLE_FIELDS = ['name', 'category', 'area', 'memo']

export function findByGooglePlaceId(googlePlaceId) {
  return db().places.find((p) => p.googlePlaceId === googlePlaceId) ?? null
}

// 일본 밖 장소는 등록하지 않는다.
// addressComponents 의 국가 코드를 우선 보고, 없으면 주소 문자열로 판단한다
// (languageCode=ko 로 요청하므로 일본 주소에는 '일본' 또는 'Japan' 이 들어간다).
export function isInJapan(details) {
  if (details.countryCode) return details.countryCode === 'JP'
  return /일본|Japan/i.test(details.address ?? '')
}

export class NotInJapanError extends Error {
  constructor(details) {
    super('일본에 있는 장소만 등록할 수 있어요.')
    this.name = 'NotInJapanError'
    this.placeName = details.name ?? null
    this.address = details.address ?? null
  }
}

/** Places 상세를 받아 등록 후보(아직 저장 안 함)를 만든다 */
export async function buildCandidate(googlePlaceId) {
  const details = normalizeDetails(await getDetails(googlePlaceId))
  if (!isInJapan(details)) throw new NotInJapanError(details)
  return {
    ...details,
    category: categoryFromTypes(details.googleTypes) ?? FALLBACK_CATEGORY,
    area: areaFromCoords(details.lat, details.lng),
  }
}

/** 후보 + 사용자 입력 → 저장할 장소 레코드 */
export function createPlace(candidate, { userId, category, area, name, memo }) {
  const now = nowIso()
  return {
    id: newId('p'),
    addedBy: userId,
    addedAt: now,

    googlePlaceId: candidate.googlePlaceId,
    name: (name || candidate.name || '이름 없음').trim(),
    nameLocal: candidate.name ?? null, // 구글 원본명 — 현지에서 간판 찾을 때 필요
    address: candidate.address ?? null,
    lat: candidate.lat,
    lng: candidate.lng,
    googleTypes: candidate.googleTypes ?? [],
    typeLabel: candidate.typeLabel ?? null,
    rating: candidate.rating ?? null,
    ratingCount: candidate.ratingCount ?? null,
    googleMapsUri: candidate.googleMapsUri ?? null,
    photo: candidate.photo ?? null,

    category: isValidCategory(category) ? category : (candidate.category ?? FALLBACK_CATEGORY),
    area: isValidArea(area) ? area : (candidate.area ?? FALLBACK_AREA),
    memo: (memo || '').trim() || null,

    confirmed: { value: false, by: null, at: null },
    visited: { value: false, by: null, at: null },
    locked: { value: false, by: null, at: null },

    history: [],
  }
}

/** 필드 수정 + 이력 기록. 실제로 바뀐 필드 목록을 돌려준다. */
export function applyEdits(place, changes, userId) {
  const changed = []
  const now = nowIso()

  for (const field of EDITABLE_FIELDS) {
    if (!(field in changes)) continue

    let next = changes[field]
    if (typeof next === 'string') next = next.trim()
    if (field === 'category' && !isValidCategory(next)) continue
    if (field === 'area' && !isValidArea(next)) continue
    if (field === 'name' && !next) continue
    if (field === 'memo' && next === '') next = null

    const previous = place[field] ?? null
    if (previous === next) continue

    place[field] = next
    place.history.unshift({ field, from: previous, to: next, by: userId, at: now })
    changed.push(field)
  }

  if (changed.length) {
    place.history = place.history.slice(0, HISTORY_LIMIT)
    place.editedBy = userId
    place.editedAt = now
  }
  return changed
}

/** 확정 / 다녀옴 토글 */
export function toggleFlag(place, field, userId) {
  const current = place[field] ?? { value: false }
  const next = !current.value
  place[field] = { value: next, by: next ? userId : null, at: next ? nowIso() : null }
  place.history.unshift({
    field,
    from: current.value,
    to: next,
    by: userId,
    at: nowIso(),
  })
  place.history = place.history.slice(0, HISTORY_LIMIT)
  return next
}

/** 저장된 장소 + 좋아요 정보를 클라이언트 형태로 */
export function serializePlace(place, viewerId) {
  const likes = db().likes.filter((l) => l.placeId === place.id)
  // 사진 참조(API 키가 필요한 값)는 내보내지 않는다. 있는지 여부만 알려주고
  // 실제 이미지는 /api/photo/:id 프록시가 준다.
  const { photo, ...rest } = place
  return {
    ...rest,
    hasPhoto: Boolean(photo?.ref),
    likeCount: likes.length,
    likedByMe: viewerId ? likes.some((l) => l.userId === viewerId) : false,
    likedBy: likes.map((l) => l.userId),
  }
}

/**
 * 기존 레코드에서 더 이상 쓰지 않는 필드를 걷어낸다.
 * 리뷰·여러 장의 사진·영업시간을 빼면서 db.json 이 크게 줄어든다.
 */
export function pruneLegacyFields(place) {
  let changed = false

  if (Array.isArray(place.photos)) {
    const first = place.photos[0]
    place.photo = first?.ref ? { ref: first.ref } : null
    delete place.photos
    changed = true
  }
  for (const field of ['reviews', 'openingHours', 'priceLevel', 'addressShort', 'nameLang']) {
    if (field in place) {
      delete place[field]
      changed = true
    }
  }
  return changed
}
