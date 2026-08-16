// Google Places API (New) 클라이언트
// 등록 시점에 한 번만 호출하고 결과를 db.json 에 저장한다 — 조회 때는 다시 부르지 않는다.

const BASE = 'https://places.googleapis.com/v1'

// 필요한 필드만 요청한다. FieldMask 를 좁힐수록 과금 등급이 낮아진다.
// 리뷰·영업시간·가격대는 쓰지 않는다 — 목록 카드에 필요한 것만 남긴다.
const DETAIL_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'primaryTypeDisplayName',
  'rating',
  'userRatingCount',
  'googleMapsUri',
  'photos',
  'addressComponents', // 국가 확인용 — 일본이 아닌 장소를 걸러낸다
].join(',')

// rating 은 저장 목록 가져오기에서 "이름이 비슷한데 평점도 같다"는 검증 신호로 쓴다.
const SEARCH_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.rating',
  'places.userRatingCount',
].join(',')

export function placesAvailable() {
  return Boolean(process.env.GOOGLE_API_KEY)
}

function apiKey() {
  const key = process.env.GOOGLE_API_KEY
  if (!key) throw new Error('GOOGLE_API_KEY 미설정')
  return key
}

async function request(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    const body = await res.json()
    if (!res.ok) {
      const message = body?.error?.message || `HTTP ${res.status}`
      const error = new Error(message)
      error.status = res.status
      throw error
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

// 이름(+좌표)으로 장소를 찾는다. 링크에 place_id 가 없을 때만 쓴다.
export async function searchText(query, { lat, lng, radius = 500 } = {}) {
  const body = {
    textQuery: query,
    languageCode: 'ko',
    regionCode: 'KR',
    maxResultCount: 5,
  }
  if (typeof lat === 'number' && typeof lng === 'number') {
    body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius } }
  }

  const data = await request(`${BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': SEARCH_FIELDS,
    },
    body: JSON.stringify(body),
  })
  return data.places ?? []
}

export async function getDetails(placeId) {
  return request(`${BASE}/places/${encodeURIComponent(placeId)}?languageCode=ko&regionCode=KR`, {
    headers: {
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': DETAIL_FIELDS,
    },
  })
}

// 사진 원본 바이트. 프록시 라우트에서 호출해 디스크에 캐시한다.
export async function fetchPhoto(photoName, maxWidthPx = 900) {
  const url = `${BASE}/${photoName}/media?maxWidthPx=${maxWidthPx}&key=${apiKey()}`
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    const error = new Error(`사진 요청 실패 (HTTP ${res.status})`)
    error.status = res.status
    throw error
  }
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'image/jpeg',
  }
}

// Places 응답 → 우리 저장 형식. 대표 사진 한 장만 남긴다.
export function normalizeDetails(place) {
  const cover = place.photos?.[0]
  const country = place.addressComponents?.find((c) => c.types?.includes('country'))
  return {
    countryCode: country?.shortText ?? null,
    googlePlaceId: place.id,
    name: place.displayName?.text ?? null,
    address: place.formattedAddress ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    googleTypes: place.types ?? [],
    typeLabel: place.primaryTypeDisplayName?.text ?? null,
    rating: place.rating ?? null,
    ratingCount: place.userRatingCount ?? null,
    googleMapsUri: place.googleMapsUri ?? null,
    photo: cover ? { ref: cover.name } : null,
  }
}
