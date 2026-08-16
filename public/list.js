// 장소 목록. 상세 페이지 없이 카드 하나로 끝난다.
// 수정·확정·다녀옴·고정·삭제는 카드의 ⋯ 메뉴에서 작은 시트로 처리한다.

import { api, avatar, confirmDialog, h, mount, openSheet, toast } from './ui.js'

// 좋아요 누른 사람 목록. 데스크톱은 마우스 올리면, 모바일은 길게 누르면 뜬다.
function attachLikePeek(button, place, users) {
  if (!place.likeCount) return

  let bubble = null
  const show = () => {
    if (bubble) return
    const names = place.likedBy.map((id) => users.find((u) => u.id === id)).filter(Boolean)
    bubble = h(
      'div',
      { class: 'like-peek' },
      ...names.map((u) =>
        h('span', { class: 'like-peek-item' }, avatar(u, true), u.nickname)
      )
    )
    button.append(bubble)
  }
  const hide = () => {
    bubble?.remove()
    bubble = null
  }

  button.addEventListener('mouseenter', show)
  button.addEventListener('mouseleave', hide)

  // 모바일: 450ms 이상 누르면 목록을 띄우고, 그 경우 좋아요 토글은 취소한다
  let timer = null
  button.addEventListener('touchstart', (event) => {
    event.stopPropagation()
    timer = setTimeout(() => {
      timer = null
      button.dataset.peeked = '1'
      show()
    }, 450)
  }, { passive: true })

  const endTouch = () => {
    if (timer) clearTimeout(timer)
    timer = null
    setTimeout(hide, 2000)
  }
  button.addEventListener('touchend', endTouch)
  button.addEventListener('touchcancel', endTouch)
}

function card(place, ctx) {
  const owner = ctx.users.find((u) => u.id === place.addedBy)

  const like = h(
    'button',
    {
      class: `icon-btn like${place.likedByMe ? ' on' : ''}`,
      title: place.likeCount ? '좋아요 (올려두면 누른 사람 보기)' : '좋아요',
      onClick: (event) => {
        event.stopPropagation()
        // 길게 눌러 목록만 본 경우에는 토글하지 않는다
        if (event.currentTarget.dataset.peeked) {
          delete event.currentTarget.dataset.peeked
          return
        }
        ctx.act(`/api/places/${place.id}/like`)
      },
    },
    place.likedByMe ? '♥' : '♡',
    place.likeCount ? String(place.likeCount) : ''
  )
  attachLikePeek(like, place, ctx.users)

  const mapLink = h(
    'a',
    {
      class: 'icon-btn',
      href: place.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`,
      target: '_blank',
      rel: 'noreferrer',
      title: '구글 지도에서 열기',
      onClick: (event) => event.stopPropagation(),
    },
    '지도'
  )

  const menu = h(
    'button',
    {
      class: 'icon-btn',
      title: '더보기',
      onClick: (event) => {
        event.stopPropagation()
        openPlaceSheet(place, ctx)
      },
    },
    '⋯'
  )

  return h(
    'article',
    { class: 'card', id: `place-${place.id}`, onClick: () => openPlaceSheet(place, ctx) },
    h(
      'div',
      { class: 'card-photo' },
      place.hasPhoto
        ? h('img', { src: `/api/photo/${place.id}?w=420`, alt: '', loading: 'lazy' })
        : h('div', { class: 'placeholder' }, '📍'),
      mount(
        h('div', { class: 'card-badges' }),
        place.confirmed?.value && h('span', { class: 'badge badge-confirmed' }, '확정'),
        place.visited?.value && h('span', { class: 'badge badge-visited' }, '다녀옴'),
        place.locked?.value && h('span', { class: 'badge badge-locked' }, '고정')
      )
    ),
    mount(
      h('div', { class: 'card-body' }),
      h('div', { class: 'card-name' }, place.name),
      // 좁은 화면에서 뒤가 잘리므로 평점을 지역보다 앞에 둔다
      h(
        'div',
        { class: 'card-sub' },
        [place.category, place.rating ? `★ ${place.rating}` : null, place.area].filter(Boolean).join(' · ')
      ),
      // 메모는 두 줄까지만. 말줄임은 안쪽 span 에 걸어야 패딩 영역으로 다음 줄이 새지 않는다
      place.memo &&
        h(
          'div',
          { class: 'card-memo', title: place.memo },
          h('span', { class: 'card-memo-text' }, place.memo)
        ),
      h('div', { class: 'card-foot' }, avatar(owner, true), h('span', { class: 'spacer' }), like, mapLink, menu)
    )
  )
}

// ── 카드 메뉴 시트 ────────────────────────────────────
// 목록 카드와 지도 마커 양쪽에서 쓴다
export function openPlaceSheet(place, ctx) {
  const { user, config } = ctx
  const locked = Boolean(place.locked?.value)
  const canEdit = user && (!locked || user.role === 'admin')
  const canDelete = user && (user.role === 'admin' || place.addedBy === user.id) && canEdit

  const sheet = openSheet({
    title: place.name,
    subtitle: [place.category, place.area].join(' · '),
  })

  async function run(path, method = 'POST', body) {
    try {
      await api(path, { method, body })
      sheet.close()
      await ctx.reload()
    } catch (e) {
      toast(e.message)
    }
  }

  const nameInput = h('input', { value: place.name })
  const categorySelect = h(
    'select',
    {},
    ...config.categories.map((v) => h('option', { value: v, selected: v === place.category }, v))
  )
  const areaSelect = h(
    'select',
    {},
    ...config.areas.map((v) => h('option', { value: v, selected: v === place.area }, v))
  )
  const memoInput = h('textarea', { placeholder: '메모 (선택)' }, place.memo ?? '')
  for (const field of [nameInput, categorySelect, areaSelect, memoInput]) field.disabled = !canEdit

  mount(
    sheet.body,
    locked &&
      h(
        'div',
        { class: 'notice notice-warn' },
        user?.role === 'admin' ? '고정된 장소예요.' : '관리자가 고정한 장소라 수정할 수 없어요.'
      ),

    place.address && h('div', { class: 'notice' }, place.address),

    user &&
      h(
        'div',
        { class: 'toggle-row' },
        h(
          'button',
          {
            class: `toggle${place.confirmed?.value ? ' on' : ''}`,
            disabled: !canEdit,
            onClick: () => run(`/api/places/${place.id}/confirmed`),
          },
          '확정'
        ),
        h(
          'button',
          {
            class: `toggle visited-toggle${place.visited?.value ? ' on' : ''}`,
            disabled: !canEdit,
            onClick: () => run(`/api/places/${place.id}/visited`),
          },
          '다녀옴'
        ),
        user.role === 'admin' &&
          h(
            'button',
            {
              class: `toggle${locked ? ' on' : ''}`,
              onClick: () => run(`/api/places/${place.id}/lock`),
            },
            locked ? '고정 해제' : '고정'
          )
      ),

    canEdit && h('div', { class: 'field' }, h('label', {}, '이름'), nameInput),
    canEdit &&
      h(
        'div',
        { class: 'field-row' },
        h('div', { class: 'field' }, h('label', {}, '카테고리'), categorySelect),
        h('div', { class: 'field' }, h('label', {}, '지역'), areaSelect)
      ),
    canEdit && h('div', { class: 'field' }, h('label', {}, '메모'), memoInput),
    !canEdit && place.memo && h('div', { class: 'notice' }, place.memo)
  )

  mount(
    sheet.foot,
    canDelete &&
      h(
        'button',
        {
          class: 'btn-danger btn-sm',
          onClick: async () => {
            const ok = await confirmDialog({
              title: '이 장소를 삭제할까요?',
              message: `'${place.name}'이(가) 휴지통으로 이동합니다. 휴지통에서 다시 되살릴 수 있어요.`,
              confirmLabel: '삭제',
              danger: true,
            })
            if (ok) run(`/api/places/${place.id}`, 'DELETE')
          },
        },
        '삭제'
      ),
    h('div', { class: 'spacer' }),
    h(
      'a',
      {
        class: 'btn-secondary btn-sm',
        href: place.googleMapsUri ?? '#',
        target: '_blank',
        rel: 'noreferrer',
      },
      '구글 지도 ↗'
    ),
    canEdit &&
      h(
        'button',
        {
          class: 'btn btn-sm',
          onClick: () =>
            run(`/api/places/${place.id}`, 'PATCH', {
              name: nameInput.value,
              category: categorySelect.value,
              area: areaSelect.value,
              memo: memoInput.value,
            }),
        },
        '저장'
      )
  )
}

/** 등록·중복 안내에서 특정 카드로 스크롤하고 잠깐 강조한다 */
export function highlightPlace(placeId) {
  const node = document.getElementById(`place-${placeId}`)
  if (!node) return
  node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  node.classList.add('flash')
  setTimeout(() => node.classList.remove('flash'), 1600)
}

/** 이미 필터·정렬이 끝난 목록을 그린다. total 은 필터 전 전체 개수. */
export function renderList(ctx) {
  const { places, total, onResetFilters } = ctx

  if (!total) {
    return h(
      'div',
      { class: 'empty' },
      h('h3', {}, '아직 등록된 장소가 없어요'),
      h('p', {}, '카톡에 공유하던 구글 지도 링크를 여기에 붙여넣어 보세요.'),
      h('button', { class: 'btn', style: 'margin-top:16px', onClick: ctx.onAdd }, '장소 추가')
    )
  }

  if (!places.length) {
    return h(
      'div',
      { class: 'empty' },
      h('h3', {}, '조건에 맞는 장소가 없어요'),
      h('button', { class: 'btn', style: 'margin-top:16px', onClick: onResetFilters }, '필터 초기화')
    )
  }

  return h('div', { class: 'grid' }, ...places.map((p) => card(p, ctx)))
}
