// 관리자 패널 — 멤버 프로필 변경 · 권한 · 정지 · 삭제

import { api, avatar, confirmDialog, h, loadingRow, mount, openSheet, toast } from './ui.js'

export function openAdminSheet({ me, colors, users: allUsers, onChanged }) {
  const COLORS = colors ?? []
  const sheet = openSheet({ title: '관리', subtitle: '관리자만 볼 수 있어요', wide: true })
  let tab = 'members'
  draw()

  function tabs() {
    return h(
      'div',
      { class: 'view-toggle', style: 'margin-bottom:4px' },
      ...[
        ['members', '멤버'],
        ['categories', '카테고리'],
        ['areas', '지역'],
      ].map(([key, label]) =>
        h(
          'button',
          {
            class: `view-btn${tab === key ? ' on' : ''}`,
            onClick: () => {
              if (tab === key) return
              tab = key
              draw()
            },
          },
          label
        )
      )
    )
  }

  async function draw() {
    sheet.body.replaceChildren(tabs(), loadingRow())
    sheet.foot.replaceChildren(
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn btn-sm', onClick: sheet.close }, '닫기')
    )

    try {
      if (tab === 'members') {
        const { users } = await api('/api/admin/users')
        sheet.body.replaceChildren(tabs(), ...users.map((u) => row(u, users)))
      } else if (tab === 'categories') {
        const { categories } = await api('/api/admin/categories')
        sheet.body.replaceChildren(tabs(), categoryEditor(categories))
      } else {
        const { areas } = await api('/api/admin/areas')
        sheet.body.replaceChildren(tabs(), areaEditor(areas))
      }
    } catch (e) {
      sheet.body.replaceChildren(tabs(), h('div', { class: 'notice notice-error' }, e.message))
    }
  }

  // ── 카테고리 ──
  function categoryEditor(categories) {
    const input = h('input', { placeholder: '새 카테고리 이름', maxlength: '14' })
    const addButton = h(
      'button',
      {
        class: 'btn btn-sm',
        onClick: () => {
          const name = input.value.trim()
          if (!name) return
          act(() => api('/api/admin/categories', { method: 'POST', body: { name } }))
        },
      },
      '추가'
    )
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') addButton.click()
    })

    return h(
      'div',
      {},
      h(
        'div',
        { class: 'notice' },
        '카테고리를 지우면 그 카테고리를 쓰던 장소는 ‘기타’로 옮겨갑니다. 이름을 바꾸면 장소도 함께 바뀝니다.'
      ),
      ...categories.map((cat) => categoryRow(cat)),
      h('div', { class: 'admin-controls', style: 'margin-top:14px' }, input, addButton)
    )
  }

  function categoryRow(cat) {
    const nameInput = h('input', { value: cat.name, maxlength: '14' })
    nameInput.disabled = cat.fixed

    return h(
      'div',
      { class: 'admin-row' },
      h(
        'div',
        { class: 'admin-controls' },
        nameInput,
        !cat.fixed &&
          h(
            'button',
            {
              class: 'btn-quiet btn-sm',
              onClick: () => {
                const next = nameInput.value.trim()
                if (!next || next === cat.name) return
                act(async () => {
                  const res = await api(`/api/admin/categories/${encodeURIComponent(cat.name)}`, {
                    method: 'PATCH',
                    body: { name: next },
                  })
                  if (res.moved) toast(`${res.moved}곳의 카테고리가 함께 바뀌었어요`)
                })
              },
            },
            '이름 저장'
          ),
        h('span', { class: 'admin-stat' }, `${cat.placeCount}곳`),
        h('span', { class: 'spacer' }),
        cat.fixed
          ? h('span', { class: 'chip' }, '기본값 · 삭제 불가')
          : h(
              'button',
              {
                class: 'btn-danger btn-sm',
                onClick: async () => {
                  const ok = await confirmDialog({
                    title: `‘${cat.name}’ 카테고리를 삭제할까요?`,
                    message: cat.placeCount
                      ? `이 카테고리를 쓰는 장소 ${cat.placeCount}곳은 ‘기타’로 옮겨집니다. 장소가 사라지지는 않아요.`
                      : '사용 중인 장소가 없어 바로 삭제됩니다.',
                    confirmLabel: '삭제',
                    danger: true,
                  })
                  if (!ok) return
                  act(async () => {
                    const res = await api(
                      `/api/admin/categories/${encodeURIComponent(cat.name)}`,
                      { method: 'DELETE' }
                    )
                    if (res.moved) toast(`${res.moved}곳이 ‘기타’로 옮겨졌어요`)
                  })
                },
              },
              '삭제'
            )
      )
    )
  }

  async function act(fn) {
    try {
      await fn()
      await draw()
      onChanged()
    } catch (e) {
      toast(e.message)
    }
  }

  // ── 지역 ──
  // 카테고리와 같되, 자동 판정용 좌표(위도·경도·반경)를 함께 다룬다.
  function areaEditor(areas) {
    const nameInput = h('input', { placeholder: '새 지역 이름', maxlength: '14' })
    const latInput = h('input', { class: 'geo-input', placeholder: '위도', inputmode: 'decimal' })
    const lngInput = h('input', { class: 'geo-input', placeholder: '경도', inputmode: 'decimal' })
    const radiusInput = h('input', { class: 'geo-input', placeholder: '반경 m', inputmode: 'numeric' })

    const addButton = h(
      'button',
      {
        class: 'btn btn-sm',
        onClick: () => {
          const name = nameInput.value.trim()
          if (!name) return
          act(() =>
            api('/api/admin/areas', {
              method: 'POST',
              body: {
                name,
                lat: latInput.value.trim(),
                lng: lngInput.value.trim(),
                radius: radiusInput.value.trim(),
              },
            })
          )
        },
      },
      '추가'
    )

    return h(
      'div',
      {},
      h(
        'div',
        { class: 'notice' },
        '좌표를 넣으면 장소를 등록할 때 그 반경 안에 들어오는 곳이 자동으로 이 지역으로 분류됩니다. ' +
          '비워두면 목록에만 나오고 직접 선택할 때만 쓰입니다. 지역을 지우면 그 지역 장소는 ‘기타’로 옮겨갑니다.'
      ),
      ...areas.map(areaRow),
      h(
        'div',
        { class: 'admin-controls', style: 'margin-top:14px' },
        nameInput,
        latInput,
        lngInput,
        radiusInput,
        addButton
      )
    )
  }

  function areaRow(area) {
    const nameInput = h('input', { value: area.name, maxlength: '14' })
    const latInput = h('input', { class: 'geo-input', placeholder: '위도', value: area.lat ?? '' })
    const lngInput = h('input', { class: 'geo-input', placeholder: '경도', value: area.lng ?? '' })
    const radiusInput = h('input', { class: 'geo-input', placeholder: '반경 m', value: area.radius ?? '' })
    if (area.fixed) {
      for (const el of [nameInput, latInput, lngInput, radiusInput]) el.disabled = true
    }

    const save = () =>
      act(async () => {
        const res = await api(`/api/admin/areas/${encodeURIComponent(area.name)}`, {
          method: 'PATCH',
          body: {
            name: nameInput.value.trim(),
            lat: latInput.value.trim(),
            lng: lngInput.value.trim(),
            radius: radiusInput.value.trim(),
          },
        })
        if (res.moved) toast(`${res.moved}곳의 지역이 함께 바뀌었어요`)
      })

    return h(
      'div',
      { class: 'admin-row' },
      h(
        'div',
        { class: 'admin-controls' },
        nameInput,
        h('span', { class: 'admin-stat' }, `${area.placeCount}곳`),
        h('span', { class: 'spacer' }),
        area.fixed
          ? h('span', { class: 'chip' }, '기본값 · 삭제 불가')
          : h(
              'button',
              {
                class: 'btn-danger btn-sm',
                onClick: async () => {
                  const ok = await confirmDialog({
                    title: `‘${area.name}’ 지역을 삭제할까요?`,
                    message: area.placeCount
                      ? `이 지역의 장소 ${area.placeCount}곳은 ‘기타’로 옮겨집니다. 장소가 사라지지는 않아요.`
                      : '사용 중인 장소가 없어 바로 삭제됩니다.',
                    confirmLabel: '삭제',
                    danger: true,
                  })
                  if (!ok) return
                  act(async () => {
                    const res = await api(`/api/admin/areas/${encodeURIComponent(area.name)}`, {
                      method: 'DELETE',
                    })
                    if (res.moved) toast(`${res.moved}곳이 ‘기타’로 옮겨졌어요`)
                  })
                },
              },
              '삭제'
            )
      ),
      !area.fixed &&
        h(
          'div',
          { class: 'admin-controls' },
          h('span', { class: 'admin-stat', style: 'flex:0 0 68px' }, '자동 판정'),
          latInput,
          lngInput,
          radiusInput,
          h('button', { class: 'btn-quiet btn-sm', onClick: save }, '저장')
        )
    )
  }

  function row(user, allUsers) {
    const isMe = user.id === me.id
    const nameInput = h('input', { value: user.nickname, maxlength: '12' })

    // 다른 멤버가 쓰는 색은 고를 수 없다 (지도에서 사람을 구분해야 하므로)
    const taken = new Map(allUsers.filter((u) => u.id !== user.id).map((u) => [u.color, u.nickname]))
    const colorPicker = h(
      'div',
      { class: 'color-picker' },
      ...COLORS.map((color) =>
        h('button', {
          class: `color-dot${color === user.color ? ' on' : ''}${taken.has(color) ? ' taken' : ''}`,
          style: `background:${color}`,
          title: taken.has(color) ? `${taken.get(color)}님이 사용 중` : color,
          disabled: taken.has(color),
          onClick: () =>
            act(() => api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { color } })),
        })
      )
    )

    // PIN 은 해시로만 저장돼 원본을 볼 수 없다. 새로 지정하는 것만 가능하다.
    const pinInput = h('input', {
      class: 'geo-input',
      inputmode: 'numeric',
      maxlength: '4',
      placeholder: '새 PIN',
    })
    const pinButton = h(
      'button',
      {
        class: 'btn-quiet btn-sm',
        onClick: () => {
          const pin = pinInput.value.trim()
          if (!/^\d{4}$/.test(pin)) return toast('PIN은 숫자 4자리로 입력해주세요.')
          act(async () => {
            await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { pin } })
            toast(`${user.nickname}님의 PIN을 ${pin} 로 바꿨어요`)
          })
        },
      },
      'PIN 재설정'
    )

    return h(
      'div',
      { class: `admin-row${user.active ? '' : ' inactive'}` },
      h(
        'div',
        { class: 'admin-head' },
        avatar(user),
        h('strong', {}, user.nickname),
        user.role === 'admin' && h('span', { class: 'chip' }, '관리자'),
        !user.active && h('span', { class: 'chip' }, '정지됨'),
        h('span', { class: 'spacer' }),
        h('span', { class: 'admin-stat' }, `장소 ${user.placeCount} · 좋아요 ${user.likeCount}`)
      ),
      h(
        'div',
        { class: 'admin-controls' },
        nameInput,
        h(
          'button',
          {
            class: 'btn-quiet btn-sm',
            onClick: () =>
              act(() =>
                api(`/api/admin/users/${user.id}`, {
                  method: 'PATCH',
                  body: { nickname: nameInput.value },
                })
              ),
          },
          '이름 저장'
        ),
        colorPicker
      ),
      h('div', { class: 'admin-controls' }, pinInput, pinButton),
      mount(
        h('div', { class: 'admin-actions' }),
        !isMe &&
          h(
            'button',
            {
              class: 'btn-quiet btn-sm',
              onClick: () =>
                act(() =>
                  api(`/api/admin/users/${user.id}`, {
                    method: 'PATCH',
                    body: { role: user.role === 'admin' ? 'member' : 'admin' },
                  })
                ),
            },
            user.role === 'admin' ? '관리자 해제' : '관리자로'
          ),
        !isMe &&
          h(
            'button',
            {
              class: 'btn-quiet btn-sm',
              onClick: () =>
                act(() =>
                  api(`/api/admin/users/${user.id}`, {
                    method: 'PATCH',
                    body: { active: !user.active },
                  })
                ),
            },
            user.active ? '정지' : '정지 해제'
          ),
        !isMe &&
          h(
            'button',
            {
              class: 'btn-danger btn-sm',
              onClick: async () => {
                const ok = await confirmDialog({
                  title: `${user.nickname}님을 삭제할까요?`,
                  message:
                    user.placeCount > 0
                      ? `이 사람이 올린 장소 ${user.placeCount}곳도 함께 사라집니다. 되돌릴 수 없어요.`
                      : '되돌릴 수 없어요.',
                  confirmLabel: '삭제',
                  danger: true,
                })
                if (!ok) return
                act(async () => {
                  const res = await api(`/api/admin/users/${user.id}`, { method: 'DELETE' })
                  toast(`삭제했어요 (장소 ${res.removedPlaces}곳 함께 삭제)`)
                })
              },
            },
            '삭제'
          ),
        isMe && h('span', { class: 'admin-stat' }, '본인 계정은 권한 변경·삭제할 수 없어요')
      )
    )
  }
}
