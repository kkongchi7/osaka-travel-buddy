// 필터 바 — 등록자 / 카테고리 / 지역 / 상태
//
// 전부 클라이언트에서 처리한다. 장소가 수백 개 수준이라 서버 왕복이 불필요하고,
// 나중에 지도를 붙일 때도 같은 결과를 그대로 쓸 수 있다.
// 선택 상태는 쿼리스트링에 넣어 링크로 공유 가능하게 한다.

import { h, mount } from './ui.js'

const STATUS = [
  { key: 'confirmed', label: '확정' },
  { key: 'visited', label: '다녀옴' },
  { key: 'liked', label: '내 좋아요' },
]

// ── 정렬 ──────────────────────────────────────────────
export const SORTS = [
  { key: 'added', label: '등록', get: (p) => p.addedAt ?? '' },
  { key: 'rating', label: '평점', get: (p) => p.rating ?? -1 },
  { key: 'likes', label: '좋아요', get: (p) => p.likeCount ?? 0 },
  { key: 'name', label: '이름', get: (p) => p.name ?? '' },
]

export function readSort() {
  const params = new URLSearchParams(location.search)
  const key = SORTS.some((s) => s.key === params.get('sort')) ? params.get('sort') : 'added'
  return { key, dir: params.get('dir') === 'asc' ? 'asc' : 'desc' }
}

export function applySort(places, sort) {
  const spec = SORTS.find((s) => s.key === sort.key) ?? SORTS[0]
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...places].sort((a, b) => {
    const x = spec.get(a)
    const y = spec.get(b)
    if (x === y) return String(a.name).localeCompare(String(b.name), 'ko')
    // 문자열은 한국어 기준으로, 숫자는 그대로 비교한다
    if (typeof x === 'string' || typeof y === 'string') {
      return sign * String(x).localeCompare(String(y), 'ko')
    }
    return sign * (x - y)
  })
}

export function renderSort({ sort, onChange }) {
  return h(
    'div',
    { class: 'sort' },
    h(
      'select',
      {
        class: 'sort-select',
        onChange: (event) => onChange({ ...sort, key: event.target.value }),
      },
      ...SORTS.map((s) => h('option', { value: s.key, selected: s.key === sort.key }, `${s.label}순`))
    ),
    h(
      'button',
      {
        class: 'sort-dir',
        title: sort.dir === 'desc' ? '내림차순 (높은 순)' : '오름차순 (낮은 순)',
        onClick: () => onChange({ ...sort, dir: sort.dir === 'desc' ? 'asc' : 'desc' }),
      },
      sort.dir === 'desc' ? '↓' : '↑'
    )
  )
}

// ── 이름 검색 ─────────────────────────────────────────
// 단순 포함 검사. 대소문자와 공백을 무시해 "wego"로 "Wego 신사이바시점"과
// "Wego Shinsaibashi no.3"이 함께 걸리게 한다.
function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, '')
}

function matchesQuery(place, query) {
  if (!query) return true
  const needle = normalizeText(query)
  if (!needle) return true
  return [place.name, place.nameLocal].some((v) => normalizeText(v).includes(needle))
}

/** URL 쿼리스트링 → 필터 상태 */
export function readFilters() {
  const params = new URLSearchParams(location.search)
  const list = (key) => {
    const value = params.get(key)
    return value ? new Set(value.split('|').filter(Boolean)) : new Set()
  }
  return {
    query: params.get('q') ?? '',
    users: list('user'),
    categories: list('cat'),
    areas: list('area'),
    status: list('status'),
  }
}

// 정렬·보기 같은 다른 파라미터는 건드리지 않고 필터 관련 키만 갱신한다
export function writeFilters(filters) {
  const params = new URLSearchParams(location.search)
  const put = (key, set) => {
    if (set.size) params.set(key, [...set].join('|'))
    else params.delete(key)
  }
  if (filters.query) params.set('q', filters.query)
  else params.delete('q')
  put('user', filters.users)
  put('cat', filters.categories)
  put('area', filters.areas)
  put('status', filters.status)
  const query = params.toString()
  history.replaceState({}, '', query ? `/?${query}` : '/')
}

export function isFiltered(filters) {
  return (
    Boolean(filters.query) ||
    filters.users.size + filters.categories.size + filters.areas.size + filters.status.size > 0
  )
}

export function applyFilters(places, filters, viewerId) {
  return places.filter((place) => {
    if (!matchesQuery(place, filters.query)) return false
    if (filters.users.size && !filters.users.has(place.addedBy)) return false
    if (filters.categories.size && !filters.categories.has(place.category)) return false
    if (filters.areas.size && !filters.areas.has(place.area)) return false

    for (const key of filters.status) {
      if (key === 'liked') {
        if (!viewerId || !place.likedBy?.includes(viewerId)) return false
      } else if (!place[key]?.value) {
        return false
      }
    }
    return true
  })
}

/**
 * 필터 바를 그린다.
 * 선택을 바꿔도 전체를 다시 그리지 않고 목록만 교체하도록 onChange 를 호출한다.
 */
export function renderFilters({ places, users, filters, viewerId, onChange }) {
  // 결과가 0건이 되는 선택지는 눌러봐야 의미가 없으므로 개수를 함께 보여준다
  const countBy = (key, value) => {
    const probe = {
      query: filters.query,
      users: new Set(filters.users),
      categories: new Set(filters.categories),
      areas: new Set(filters.areas),
      status: new Set(filters.status),
    }
    probe[key] = new Set([value])
    return applyFilters(places, { ...probe }, viewerId).length
  }

  function group(key, label, options) {
    const selected = filters[key]
    const chips = options
      .map((option) => {
        const count = countBy(key, option.value)
        return { ...option, count }
      })
      .filter((option) => option.count > 0 || selected.has(option.value))

    if (!chips.length) return null

    return h(
      'div',
      { class: 'filter-group' },
      h('span', { class: 'filter-label' }, label),
      h(
        'div',
        { class: 'filter-chips' },
        ...chips.map((option) =>
        h(
          'button',
          {
            class: `filter-chip${selected.has(option.value) ? ' on' : ''}`,
            onClick: () => {
              if (selected.has(option.value)) selected.delete(option.value)
              else selected.add(option.value)
              writeFilters(filters)
              onChange()
            },
          },
          option.dot &&
            h('span', { class: 'filter-dot', style: `background:${option.dot}` }),
            option.label,
            h('span', { class: 'filter-count' }, String(option.count))
          )
        )
      )
    )
  }

  const present = (field) => [...new Set(places.map((p) => p[field]))]

  const bar = h('div', { class: 'filters' })
  mount(
    bar,
    group(
      'users',
      '올린 사람',
      users
        .filter((u) => places.some((p) => p.addedBy === u.id))
        .map((u) => ({ value: u.id, label: u.nickname, dot: u.color }))
    ),
    group(
      'categories',
      '카테고리',
      present('category').map((c) => ({ value: c, label: c }))
    ),
    group(
      'areas',
      '지역',
      present('area').map((a) => ({ value: a, label: a }))
    ),
    group(
      'status',
      '상태',
      STATUS.map((s) => ({ value: s.key, label: s.label }))
    ),
    isFiltered(filters) &&
      h(
        'button',
        {
          class: 'filter-reset',
          onClick: () => {
            clearFilters(filters)
            writeFilters(filters)
            onChange()
          },
        },
        '초기화'
      )
  )
  return bar
}

/** 필터를 전부 해제한다. query 는 문자열이라 Set 과 함께 다뤄야 해 헬퍼로 둔다. */
export function clearFilters(filters) {
  filters.query = ''
  for (const value of Object.values(filters)) {
    if (value instanceof Set) value.clear()
  }
}

/**
 * 이름 검색창. 입력할 때마다 다시 그리면 포커스가 날아가므로
 * 입력 요소는 유지한 채 목록만 갱신하도록 onChange 만 호출한다.
 */
export function renderSearch({ filters, onChange }) {
  const input = h('input', {
    class: 'search-input',
    type: 'search',
    value: filters.query,
    placeholder: '장소 이름으로 검색',
    autocomplete: 'off',
    spellcheck: 'false',
  })

  input.addEventListener('input', () => {
    filters.query = input.value
    writeFilters(filters)
    onChange({ keepFocus: true })
  })

  const icon = h('span', {
    class: 'search-icon',
    html: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M6.75 1a5.75 5.75 0 1 1 3.62 10.22l3.2 3.2a.9.9 0 1 1-1.27 1.27l-3.2-3.2A5.75 5.75 0 0 1 6.75 1Zm0 1.8a3.95 3.95 0 1 0 0 7.9 3.95 3.95 0 0 0 0-7.9Z"/></svg>',
  })

  const clear = h(
    'button',
    {
      class: 'search-clear',
      title: '지우기',
      onClick: () => {
        filters.query = ''
        input.value = ''
        writeFilters(filters)
        onChange({ keepFocus: true })
      },
    },
    '✕'
  )

  const box = h('div', { class: 'search' }, icon, input)
  if (filters.query) box.append(clear)
  return box
}
