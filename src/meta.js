// 카테고리·지역 상수와 분류 규칙
// 지역은 한글 고정 enum, 카테고리는 관리자가 편집 가능해 db.json 에 저장된다.

import { db, save } from './db.js'

// 카테고리는 관리자가 UI 에서 추가·수정·삭제할 수 있어 db.json 에 저장된다.
// 여기 목록은 최초 부팅 시 seed 값이자, 구글 types 매핑이 가리키는 이름이다.
// '기타'는 삭제한 카테고리에 속한 장소가 떨어질 자리라 지울 수 없다.
export const FALLBACK_CATEGORY = '기타'

export const DEFAULT_CATEGORIES = [
  '음식점',
  '카페·디저트',
  '술집·바',
  '쇼핑',
  '관광·명소',
  '액티비티',
  '숙소',
  '기타',
]

// 지역도 관리자가 편집할 수 있어 db.json 에 저장된다.
// 좌표(lat/lng/radius)가 있으면 등록 시 자동 판정에 쓰이고, 없으면 수동 선택 전용이 된다.
export const FALLBACK_AREA = '기타'

export const DEFAULT_AREAS = [
  { name: '난바·도톤보리', lat: 34.6687, lng: 135.5013, radius: 1200 },
  { name: '신사이바시', lat: 34.6752, lng: 135.501, radius: 800 },
  { name: '우메다·기타', lat: 34.7025, lng: 135.4959, radius: 1500 },
  { name: '덴노지·신세카이', lat: 34.6525, lng: 135.5063, radius: 1500 },
  { name: '오사카성', lat: 34.6873, lng: 135.5262, radius: 1200 },
  { name: '유니버설시티', lat: 34.6654, lng: 135.4323, radius: 1500 },
  { name: '베이·난코', lat: 34.6545, lng: 135.429, radius: 2000 },
  { name: '교토', lat: 35.0116, lng: 135.7681, radius: 15000 },
  { name: '고베', lat: 34.6901, lng: 135.1955, radius: 12000 },
  { name: '나라', lat: 34.6851, lng: 135.8048, radius: 10000 },
  { name: FALLBACK_AREA, lat: null, lng: null, radius: null },
]

// Places API 의 types → 우리 카테고리.
//
// 구글은 types 를 구체적인 것부터 순서대로 준다
// (예: ramen_restaurant, noodle_shop, snack_bar, ..., restaurant, food, establishment).
// 그래서 "어떤 규칙에 걸리는가"가 아니라 "가장 앞선 type 이 무엇인가"로 판정한다.
// 이렇게 하지 않으면 라멘집의 snack_bar 가 술집으로 잡히는 식의 오분류가 난다.
const TYPE_MAP = new Map(
  Object.entries({
    '카페·디저트': [
      'cafe', 'coffee_shop', 'cat_cafe', 'dog_cafe', 'internet_cafe',
      'bakery', 'dessert_shop', 'dessert_restaurant', 'ice_cream_shop',
      'tea_house', 'juice_shop', 'donut_shop', 'bagel_shop',
      'chocolate_shop', 'chocolate_factory', 'confectionery', 'candy_store', 'acai_shop',
    ],
    '술집·바': [
      'bar', 'pub', 'wine_bar', 'night_club', 'liquor_store', 'brewery', 'bar_and_grill',
    ],
    '음식점': [
      'restaurant', 'ramen_restaurant', 'japanese_restaurant', 'sushi_restaurant',
      'noodle_shop', 'chinese_noodle_restaurant', 'chinese_restaurant',
      'korean_restaurant', 'italian_restaurant', 'french_restaurant',
      'american_restaurant', 'mexican_restaurant', 'thai_restaurant',
      'indian_restaurant', 'vietnamese_restaurant', 'spanish_restaurant',
      'greek_restaurant', 'turkish_restaurant', 'lebanese_restaurant',
      'seafood_restaurant', 'steak_house', 'barbecue_restaurant', 'hamburger_restaurant',
      'pizza_restaurant', 'buffet_restaurant', 'breakfast_restaurant', 'brunch_restaurant',
      'fast_food_restaurant', 'vegetarian_restaurant', 'vegan_restaurant',
      'asian_restaurant', 'diner', 'deli', 'sandwich_shop', 'snack_bar',
      'meal_takeaway', 'meal_delivery', 'food_court', 'fine_dining_restaurant',
      'afghani_restaurant', 'african_restaurant', 'brazilian_restaurant',
      'indonesian_restaurant', 'middle_eastern_restaurant', 'ramen', 'food',
    ],
    '숙소': [
      'hotel', 'lodging', 'motel', 'hostel', 'inn', 'resort_hotel', 'guest_house',
      'bed_and_breakfast', 'japanese_inn', 'budget_japanese_inn', 'extended_stay_hotel',
      'campground', 'cottage', 'farmstay', 'private_guest_room', 'camping_cabin',
    ],
    '쇼핑': [
      'store', 'shopping_mall', 'department_store', 'clothing_store', 'convenience_store',
      'supermarket', 'grocery_store', 'market', 'book_store', 'electronics_store',
      'gift_shop', 'jewelry_store', 'shoe_store', 'home_goods_store', 'discount_store',
      'drugstore', 'pharmacy', 'cosmetics_store', 'sporting_goods_store',
      'furniture_store', 'hardware_store', 'pet_store', 'florist', 'wholesaler',
      'asian_grocery_store', 'food_store', 'butcher_shop', 'warehouse_store',
    ],
    '관광·명소': [
      'tourist_attraction', 'museum', 'art_gallery', 'park', 'national_park',
      'state_park', 'aquarium', 'zoo',
      'historical_landmark', 'historical_place', 'monument', 'observation_deck',
      'cultural_landmark', 'temple', 'hindu_temple', 'buddhist_temple', 'shinto_shrine',
      'church', 'mosque', 'synagogue', 'place_of_worship', 'garden', 'botanical_garden',
      'plaza', 'sculpture', 'performing_arts_theater', 'movie_theater',
      'beach', 'wildlife_park', 'wildlife_refuge',
      'observation_tower', 'planetarium', 'cultural_center',
      'visitor_center', 'tourist_information_center', 'philharmonic_hall', 'opera_house',
    ],
    // 보는 곳이 아니라 '하는 곳'
    '액티비티': [
      'amusement_center', 'amusement_park', 'video_arcade', 'bowling_alley',
      'karaoke', 'escape_room_center', 'water_park', 'ferris_wheel', 'roller_coaster',
      'sports_complex', 'sports_activity_location', 'sports_club', 'athletic_field',
      'gym', 'fitness_center', 'swimming_pool', 'ice_skating_rink', 'ski_resort',
      'golf_course', 'skateboard_park', 'cycling_park', 'adventure_sports_center',
      'spa', 'public_bath', 'public_bathroom_house', 'sauna', 'onsen',
      'casino', 'hiking_area', 'dance_hall', 'observation_wheel',
    ],
  }).flatMap(([category, types]) => types.map((t) => [t, category]))
)

// 목록에 없는 새 type 을 위한 최소한의 보정. 접미사 기준으로만 판단한다.
function categoryBySuffix(type) {
  if (type === 'bar' || type.endsWith('_bar')) return '술집·바'
  if (type.endsWith('_restaurant') || type.endsWith('_shop')) return '음식점'
  if (type.endsWith('_store') || type.endsWith('_market')) return '쇼핑'
  if (type.endsWith('_hotel') || type.endsWith('_inn')) return '숙소'
  if (type.endsWith('_temple') || type.endsWith('_shrine') || type.endsWith('_museum'))
    return '관광·명소'
  return null
}

// ── 카테고리 저장소 (db.json) ───────────────────────────
// 관리자가 편집하므로 상수가 아니라 db 에서 읽는다.

export function getCategories() {
  const list = db().categories
  if (!Array.isArray(list) || !list.length) return [...DEFAULT_CATEGORIES]
  return list
}

/** 부팅 시 한 번. 없으면 기본 목록을 심고, '기타'가 빠졌으면 되살린다. */
export async function seedCategories() {
  const current = db().categories
  if (!Array.isArray(current) || !current.length) {
    db().categories = [...DEFAULT_CATEGORIES]
    await save(['categories'])
    return 'seeded'
  }
  if (!current.includes(FALLBACK_CATEGORY)) {
    current.push(FALLBACK_CATEGORY)
    await save(['categories'])
    return 'repaired'
  }
  return null
}

export function isValidCategory(value) {
  return getCategories().includes(value)
}

export function categoryFromTypes(types = []) {
  const available = getCategories()
  const pick = (name) => (name && available.includes(name) ? name : null)

  for (const type of types) {
    const exact = pick(TYPE_MAP.get(type))
    if (exact) return exact
  }
  // 정확히 매칭되는 게 없을 때만 접미사로 추정
  for (const type of types) {
    const guess = pick(categoryBySuffix(type))
    if (guess) return guess
  }
  return null
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ── 지역 저장소 (db.json) ───────────────────────────────

export function getAreaRecords() {
  const list = db().areas
  if (!Array.isArray(list) || !list.length) return DEFAULT_AREAS.map((a) => ({ ...a }))
  return list
}

export function getAreas() {
  return getAreaRecords().map((a) => a.name)
}

export async function seedAreas() {
  const current = db().areas
  if (!Array.isArray(current) || !current.length) {
    db().areas = DEFAULT_AREAS.map((a) => ({ ...a }))
    await save(['areas'])
    return 'seeded'
  }
  if (!current.some((a) => a.name === FALLBACK_AREA)) {
    current.push({ name: FALLBACK_AREA, lat: null, lng: null, radius: null })
    await save(['areas'])
    return 'repaired'
  }
  return null
}

export function isValidArea(value) {
  return getAreas().includes(value)
}

/** 좌표가 등록된 지역 중 반경 안에서 가장 가까운 곳. 없으면 '기타'. */
export function areaFromCoords(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return FALLBACK_AREA
  let best = null
  for (const area of getAreaRecords()) {
    if (typeof area.lat !== 'number' || typeof area.lng !== 'number' || !area.radius) continue
    const d = distanceMeters(lat, lng, area.lat, area.lng)
    if (d <= area.radius && (!best || d < best.d)) best = { name: area.name, d }
  }
  return best ? best.name : FALLBACK_AREA
}
