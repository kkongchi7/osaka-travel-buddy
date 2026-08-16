// 공유된 구글맵 링크 → place_id
//
// 카톡으로 오는 링크는 대부분 https://maps.app.goo.gl/XXXX 단축 형태다.
// 리다이렉트를 따라가면 긴 URL 이 되고, 거기서 세 가지 방법으로 장소를 특정한다.
//   1) URL 안의 place_id (!19s... 또는 ?place_id=) — 정확하고 무료
//   2) /place/<이름>/@lat,lng 파싱 후 Text Search — 좌표로 검증
//   3) 좌표만 있으면 좌표 기준 검색
// 어느 쪽이든 마지막에 사용자가 미리보기로 확인하므로, 틀려도 저장 전에 잡힌다.

import { searchText } from './places.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

const MAPS_HOSTS =
  /^(maps\.app\.goo\.gl|goo\.gl|maps\.google\.[a-z.]+|www\.google\.[a-z.]+|google\.[a-z.]+)$/i

export function looksLikeMapsUrl(value) {
  try {
    return MAPS_HOSTS.test(new URL(value).hostname)
  } catch {
    return false
  }
}

// 텍스트 안에서 첫 번째 URL 을 뽑는다 (카톡 메시지를 통째로 붙여넣는 경우 대비)
export function extractUrl(text) {
  const match = String(text ?? '').match(/https?:\/\/[^\s<>"']+/)
  return match ? match[0] : null
}

// 단축 링크 → 최종 URL
//
// 구글 지도 페이지 본문은 JS 앱 셸이라 장소 정보가 전혀 없다(확인 완료).
// 따라서 HTML 을 뒤지지 않고 리다이렉트 결과만 신뢰한다.
export async function resolveRedirect(url, timeoutMs = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9,ja;q=0.8,en;q=0.7' },
    })
    return res.url || url
  } catch (e) {
    console.warn('[resolve] 리다이렉트 실패:', e.message)
    return url
  } finally {
    clearTimeout(timer)
  }
}

// URL 에서 직접 place_id 추출 (가장 정확한 경로)
export function placeIdFromUrl(urlStr) {
  try {
    const u = new URL(urlStr)
    const param = u.searchParams.get('place_id')
    if (param) return param
  } catch {
    /* 아래 정규식으로 계속 */
  }
  // data=!...!19sChIJ... 형태 — 19s 뒤가 place_id
  const embedded = urlStr.match(/!19s([A-Za-z0-9_-]{15,})/)
  if (embedded) return embedded[1]
  const query = urlStr.match(/[?&]q=place_id:([A-Za-z0-9_-]{15,})/)
  if (query) return query[1]
  return null
}

function decodeName(segment) {
  let s
  try {
    s = decodeURIComponent(segment.replace(/\+/g, '%20'))
  } catch {
    s = segment
  }
  return s.replace(/\s+/g, ' ').trim()
}

// URL 에서 이름·좌표 추출
export function parsePlaceUrl(urlStr) {
  let name = null
  let lat = null
  let lng = null

  const placeSegment = urlStr.match(/\/maps\/place\/([^/@?]+)/)
  if (placeSegment) name = decodeName(placeSegment[1])

  // /@lat,lng,17z 는 지도 중심, !3dlat!4dlng 는 실제 핀 위치 — 핀을 우선한다
  const pin = urlStr.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)
  const center = urlStr.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  const coords = pin || center
  if (coords) {
    lat = Number(coords[1])
    lng = Number(coords[2])
  }

  if (!name) {
    try {
      const u = new URL(urlStr)
      const q = u.searchParams.get('q') || u.searchParams.get('query')
      if (q && !/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(q)) name = decodeName(q)
      else if (q) {
        const [qLat, qLng] = q.split(',').map(Number)
        if (Number.isFinite(qLat)) {
          lat = lat ?? qLat
          lng = lng ?? qLng
        }
      }
    } catch {
      /* 무시 */
    }
  }

  return { name, lat, lng }
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * 링크 → { placeId, method, confidence, parsed, candidates }
 * method: 'url' | 'search' | 'coords' | null
 * confidence: 'high' | 'medium' | 'low'
 */
export async function resolvePlace(input) {
  const url = extractUrl(input) ?? String(input ?? '').trim()
  if (!url) return { error: '링크를 찾을 수 없어요.' }
  if (!looksLikeMapsUrl(url)) return { error: '구글 지도 링크만 등록할 수 있어요.' }

  const finalUrl = await resolveRedirect(url)
  const parsed = parsePlaceUrl(finalUrl)

  // ① URL 에 place_id 가 그대로 들어있는 경우
  const direct = placeIdFromUrl(finalUrl)
  if (direct) {
    return { placeId: direct, method: 'url', confidence: 'high', parsed, finalUrl }
  }

  // ② 이름 + 좌표로 검색
  if (parsed.name) {
    const results = await searchText(parsed.name, { lat: parsed.lat, lng: parsed.lng })
    if (results.length) {
      const top = results[0]
      let confidence = 'medium'
      if (typeof parsed.lat === 'number' && top.location) {
        const gap = distanceMeters(
          parsed.lat,
          parsed.lng,
          top.location.latitude,
          top.location.longitude
        )
        confidence = gap <= 150 ? 'high' : gap <= 600 ? 'medium' : 'low'
      }
      return {
        placeId: top.id,
        method: 'search',
        confidence,
        parsed,
        finalUrl,
        candidates: results.slice(0, 5).map((r) => ({
          id: r.id,
          name: r.displayName?.text,
          address: r.formattedAddress,
        })),
      }
    }
  }

  // ③ 좌표만 있을 때 — 주변 검색으로 후보를 제시
  if (typeof parsed.lat === 'number') {
    const results = await searchText('음식점 관광 명소', {
      lat: parsed.lat,
      lng: parsed.lng,
      radius: 120,
    })
    if (results.length) {
      return {
        placeId: results[0].id,
        method: 'coords',
        confidence: 'low',
        parsed,
        finalUrl,
        candidates: results.slice(0, 5).map((r) => ({
          id: r.id,
          name: r.displayName?.text,
          address: r.formattedAddress,
        })),
      }
    }
  }

  // cid 링크(maps.google.com/?cid=...)는 URL·HTML 어디에도 장소명이 없다.
  // 구글이 place_id 조회를 제공하지 않으므로 이름 검색으로 넘긴다.
  const isCid = /[?&]cid=\d+/.test(finalUrl)
  return {
    error: isCid
      ? '이 형태의 링크로는 장소를 특정할 수 없어요. 아래에 장소 이름을 입력해 찾아주세요.'
      : '링크에서 장소를 찾지 못했어요. 장소 이름으로 직접 찾아볼 수 있어요.',
    needsManualSearch: true,
    parsed,
    finalUrl,
  }
}

// 링크 해석이 실패했을 때 쓰는 수동 검색
export async function searchByName(query) {
  const results = await searchText(String(query ?? '').trim(), {
    lat: 34.6937,
    lng: 135.5023,
    radius: 40000, // 오사카 중심 40km — 교토·고베·나라까지 포함
  })
  return results.map((r) => ({
    id: r.id,
    name: r.displayName?.text,
    address: r.formattedAddress,
    lat: r.location?.latitude ?? null,
    lng: r.location?.longitude ?? null,
  }))
}
