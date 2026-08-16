import { openAddSheet } from './add.js'
import { openAdminSheet } from './admin.js'
import { renderAuth } from './auth.js'
import {
  applyFilters,
  applySort,
  clearFilters as resetFilterState,
  isFiltered,
  readFilters,
  readSort,
  renderFilters,
  renderSearch,
  renderSort,
  writeFilters,
} from './filters.js'
import { highlightPlace, openPlaceSheet, renderList } from './list.js'
import { createMapView } from './map.js'
import { openProfileSheet } from './profile.js'
import { openTrashSheet } from './trash.js'
import { api, avatar, h } from './ui.js'

const root = document.getElementById('root')

const state = {
  user: null,
  config: { categories: [], areas: [], colors: [], mapsApiKey: null },
  places: [],
  users: [],
  filters: readFilters(),
  sort: readSort(),
  view: new URLSearchParams(location.search).get('view') === 'map' ? 'map' : 'list',
  // 좁은 화면에서 필터가 목록을 다 밀어내므로 접어둔다 (데스크톱은 CSS 로 항상 보임)
  filtersOpen: false,
}

// 지도 인스턴스는 한 번만 만들어 재사용한다 (매번 새로 만들면 API 로딩이 반복된다)
let mapView = null

async function loadSession() {
  const [me, config] = await Promise.all([api('/api/auth/me'), api('/api/config')])
  state.user = me.user
  state.config = config
}

async function loadPlaces() {
  const data = await api('/api/places')
  state.places = data.places
  state.users = data.users
  state.config.categories = data.categories
  state.config.areas = data.areas
}

function visiblePlaces() {
  return applySort(applyFilters(state.places, state.filters, state.user?.id ?? null), state.sort)
}

function syncUrl() {
  const params = new URLSearchParams(location.search)
  if (state.view === 'map') params.set('view', 'map')
  else params.delete('view')
  if (state.sort.key === 'added') params.delete('sort')
  else params.set('sort', state.sort.key)
  if (state.sort.dir === 'desc') params.delete('dir')
  else params.set('dir', state.sort.dir)
  const query = params.toString()
  history.replaceState({}, '', query ? `/?${query}` : '/')
}

function clearFilters() {
  resetFilterState(state.filters)
  writeFilters(state.filters)
}

function resetFilters() {
  clearFilters()
  render()
}

function listContext(places) {
  return {
    places,
    total: state.places.length,
    users: state.users,
    user: state.user,
    config: state.config,
    onResetFilters: resetFilters,
    reload: async () => {
      await loadPlaces()
      render()
    },
    act: async (path, method = 'POST', body) => {
      await api(path, { method, body })
      await loadPlaces()
      render()
    },
    onAdd: openAdd,
  }
}

// 필터 때문에 특정 장소가 안 보이면 필터를 풀고 목록으로 돌아간다
function revealPlace(placeId) {
  if (!visiblePlaces().some((p) => p.id === placeId)) clearFilters()
  state.view = 'list'
  syncUrl()
  render()
  highlightPlace(placeId)
}

function openAdd() {
  openAddSheet({
    config: state.config,
    onAdded: async (placeId) => {
      await loadPlaces()
      if (placeId) revealPlace(placeId)
      else render()
    },
    onShowPlace: revealPlace,
  })
}

const menuActions = {
  openTrash: () =>
    openTrashSheet({
      onChanged: async () => {
        await loadPlaces()
        render()
      },
    }),
  openAdmin: () =>
    openAdminSheet({
      me: state.user,
      colors: state.config.colors,
      onChanged: async () => {
        await loadPlaces()
        render()
      },
    }),
  logout: async () => {
    await api('/api/auth/logout', { method: 'POST' })
    state.user = null
    render()
  },
}

function navBar() {
  return h(
    'div',
    { class: 'nav' },
    h('span', { class: 'nav-title' }, '오사카 여행 도우미'),
    h('div', { class: 'nav-spacer' }),
    h('button', { class: 'btn btn-sm nav-add', onClick: openAdd }, '＋ 장소 추가'),
    h(
      'button',
      { class: 'btn-secondary btn-sm nav-only-wide', title: '쓰레기통', onClick: menuActions.openTrash },
      '휴지통'
    ),
    state.user.role === 'admin' &&
      h(
        'button',
        { class: 'btn-secondary btn-sm nav-only-wide', title: '멤버 관리', onClick: menuActions.openAdmin },
        '관리'
      ),
    h(
      'button',
      {
        class: 'avatar-button',
        title: '내 프로필',
        onClick: () =>
          openProfileSheet({
            me: state.user,
            users: state.users,
            colors: state.config.colors,
            onChanged: async (user) => {
              state.user = user
              await loadPlaces()
              render()
            },
            actions: menuActions,
          }),
      },
      avatar(state.user)
    ),
    h(
      'button',
      { class: 'btn-secondary btn-sm nav-only-wide', onClick: menuActions.logout },
      '로그아웃'
    )
  )
}

function viewToggle() {
  return h(
    'div',
    { class: 'view-toggle' },
    ...[
      ['list', '목록'],
      ['map', '지도'],
    ].map(([key, label]) =>
      h(
        'button',
        {
          class: `view-btn${state.view === key ? ' on' : ''}`,
          onClick: () => {
            if (state.view === key) return
            state.view = key
            syncUrl()
            render()
          },
        },
        label
      )
    )
  )
}

function render({ keepFocus = false } = {}) {
  // 검색어를 입력하는 중에는 커서 위치까지 되살려야 타이핑이 끊기지 않는다
  const focused = keepFocus && document.activeElement?.classList.contains('search-input')
  const caret = focused ? document.activeElement.selectionStart : null

  const restoreFocus = () => {
    if (!focused) return
    const next = root.querySelector('.search-input')
    if (!next) return
    next.focus()
    if (caret !== null) next.setSelectionRange(caret, caret)
  }

  if (!state.user) {
    renderAuth(root, async (user) => {
      state.user = user
      await loadPlaces()
      render()
    })
    return
  }

  const places = visiblePlaces()
  const header = h(
    'div',
    { class: 'list-header' },
    h(
      'div',
      { class: 'list-title' },
      h('h2', {}, '우리가 모은 장소'),
      h(
        'span',
        { class: 'count' },
        isFiltered(state.filters)
          ? `${places.length} / ${state.places.length}곳`
          : `${state.places.length}곳`
      )
    ),
    state.places.length > 0 &&
      h(
        'div',
        { class: 'list-controls' },
        renderSort({
          sort: state.sort,
          onChange: (next) => {
            state.sort = next
            syncUrl()
            render()
          },
        }),
        viewToggle()
      )
  )

  const main = h('main', {}, header)

  if (state.places.length) {
    main.append(renderSearch({ filters: state.filters, onChange: render }))

    const activeCount =
      state.filters.users.size +
      state.filters.categories.size +
      state.filters.areas.size +
      state.filters.status.size
    main.append(
      h(
        'button',
        {
          class: `filter-toggle${state.filtersOpen ? ' on' : ''}`,
          onClick: () => {
            state.filtersOpen = !state.filtersOpen
            render()
          },
        },
        `필터${activeCount ? ` ${activeCount}` : ''}`,
        h('span', { class: 'filter-toggle-arrow' }, state.filtersOpen ? '▴' : '▾')
      )
    )

    const bar = renderFilters({
      places: state.places,
      users: state.users,
      filters: state.filters,
      viewerId: state.user.id,
      onChange: render,
    })
    if (!state.filtersOpen) bar.classList.add('collapsed')
    main.append(bar)
  }

  if (state.view === 'map' && state.places.length) {
    if (!mapView) {
      mapView = createMapView({
        apiKey: state.config.mapsApiKey,
        onSelect: (place) => openPlaceSheet(place, listContext(places)),
      })
    }
    main.append(mapView.container)
    root.replaceChildren(navBar(), main)
    restoreFocus()
    mapView.draw(places, state.users)
    return
  }

  main.append(renderList(listContext(places)))
  root.replaceChildren(navBar(), main)
  restoreFocus()
}

await loadSession()
if (state.user) await loadPlaces()
render()
