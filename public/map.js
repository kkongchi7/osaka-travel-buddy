// 구글 지도 — 필터를 통과한 장소만 마커로 찍는다.
//
// Maps JS API 는 지도 탭을 처음 열 때만 불러온다 (초기 로딩을 가볍게 유지).
// 마커 색은 올린 사람의 색을 그대로 쓴다.

let loader = null

function loadMapsApi(key) {
  if (window.google?.maps) return Promise.resolve()
  if (loader) return loader

  loader = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&language=ko&region=JP&loading=async&callback=__otbMapReady`
    script.async = true
    script.onerror = () => reject(new Error('지도를 불러오지 못했어요.'))
    window.__otbMapReady = resolve
    document.head.append(script)
  })
  return loader
}

function pinIcon(color, { confirmed, visited }) {
  // 확정은 테두리를 굵게, 다녀옴은 반투명하게 해서 한눈에 구분되게 한다
  const stroke = confirmed ? '#ffffff' : 'rgba(255,255,255,0.85)'
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">
      <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.7 23.3 0 15 0z"
            fill="${color}" opacity="${visited ? 0.45 : 1}"
            stroke="${stroke}" stroke-width="${confirmed ? 3 : 1.5}"/>
      <circle cx="15" cy="15" r="5.5" fill="#fff" opacity="${visited ? 0.6 : 0.95}"/>
    </svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.trim())}`
}

const PENCIL_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11.9 1.3a1.6 1.6 0 0 1 2.3 0l.5.5a1.6 1.6 0 0 1 0 2.3l-7.6 7.6c-.2.2-.4.3-.6.4l-2.7.8a.7.7 0 0 1-.9-.9l.8-2.7c.1-.2.2-.4.4-.6l7.8-7.4Zm1.3 1a.2.2 0 0 0-.3 0l-.8.8 1.8 1.8.8-.8a.2.2 0 0 0 0-.3l-.5-.5-1-1Zm-.3 3.6L11.1 4.1 5 10.2l-.4 1.5 1.5-.4 6.1-6.4Z"/></svg>'

export function createMapView({ apiKey, onSelect }) {
  const container = document.createElement('div')
  container.className = 'map'

  // 마커를 누르면 뜨는 정보창. 연필 버튼으로 편집 시트를 연다.
  function infoCard(place, owner) {
    const node = document.createElement('div')
    node.className = 'map-info'

    const head = document.createElement('div')
    head.className = 'map-info-head'

    const title = document.createElement('strong')
    title.textContent = place.name

    const edit = document.createElement('button')
    edit.className = 'map-info-edit'
    edit.title = '편집'
    edit.setAttribute('aria-label', '편집')
    edit.innerHTML = PENCIL_SVG
    edit.addEventListener('click', () => {
      info.close()
      onSelect?.(place)
    })

    head.append(title, edit)

    const meta = document.createElement('span')
    meta.className = 'map-info-meta'
    meta.textContent = [
      place.category,
      place.area,
      place.rating ? `★ ${place.rating}` : null,
    ]
      .filter(Boolean)
      .join(' · ')

    node.append(head, meta)

    if (place.memo) {
      const memo = document.createElement('span')
      memo.className = 'map-info-memo'
      memo.textContent = place.memo
      node.append(memo)
    }

    const foot = document.createElement('div')
    foot.className = 'map-info-foot'

    const badges = [
      place.confirmed?.value && '확정',
      place.visited?.value && '다녀옴',
      place.locked?.value && '고정',
    ].filter(Boolean)
    for (const label of badges) {
      const chip = document.createElement('span')
      chip.className = 'map-info-chip'
      chip.textContent = label
      foot.append(chip)
    }

    const who = document.createElement('span')
    who.className = 'map-info-who'
    who.textContent = `${owner?.nickname ?? '?'} · ♥ ${place.likeCount ?? 0}`
    foot.append(who)

    const link = document.createElement('a')
    link.href =
      place.googleMapsUri ??
      `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`
    link.target = '_blank'
    link.rel = 'noreferrer'
    link.textContent = '구글 지도 ↗'
    foot.append(link)

    node.append(foot)
    return node
  }

  let map = null
  let markers = []
  let info = null
  // draw() 가 연달아 호출되면 Maps API 로딩을 기다리는 사이 양쪽이 마커를 추가해
  // 중복이 생긴다. 세대 번호로 오래된 호출을 버린다.
  let generation = 0

  async function ensureMap() {
    if (map) return map
    if (!apiKey) throw new Error('지도 키가 설정되지 않았어요. (.env 의 GOOGLE_MAPS_BROWSER_KEY)')
    await loadMapsApi(apiKey)
    map = new google.maps.Map(container, {
      center: { lat: 34.6845, lng: 135.5, },
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
    })
    info = new google.maps.InfoWindow()
    return map
  }

  async function draw(places, users) {
    const mine = ++generation

    let target
    try {
      target = await ensureMap()
    } catch (e) {
      container.replaceChildren(
        Object.assign(document.createElement('div'), { className: 'empty', textContent: e.message })
      )
      return
    }
    if (mine !== generation) return // 더 최근 draw 가 시작됐다

    for (const marker of markers) marker.setMap(null)
    markers = []
    info?.close()

    const bounds = new google.maps.LatLngBounds()
    let placed = 0

    for (const place of places) {
      if (typeof place.lat !== 'number' || typeof place.lng !== 'number') continue
      const owner = users.find((u) => u.id === place.addedBy)
      const position = { lat: place.lat, lng: place.lng }

      const marker = new google.maps.Marker({
        map: target,
        position,
        title: place.name,
        icon: {
          url: pinIcon(owner?.color ?? '#86868b', {
            confirmed: place.confirmed?.value,
            visited: place.visited?.value,
          }),
          scaledSize: new google.maps.Size(26, 35),
          anchor: new google.maps.Point(13, 35),
        },
      })

      marker.addListener('click', () => {
        // HTML 문자열 대신 DOM 노드를 넘긴다 — 이스케이프 걱정이 없고 버튼에 핸들러를 달 수 있다
        info.setContent(infoCard(place, owner))
        info.open({ anchor: marker, map: target })
      })

      markers.push(marker)
      bounds.extend(position)
      placed++
    }

    if (placed === 1) {
      target.setCenter(bounds.getCenter())
      target.setZoom(16)
    } else if (placed > 1) {
      target.fitBounds(bounds, 48)
    }

    window.__otbMarkers = markers.length // 테스트에서 실제 마커 수를 확인하는 용도
  }

  return { container, draw }
}
