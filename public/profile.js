// 내 프로필 — 색상 변경 · PIN 변경
// 색은 지도에서 사람을 구분하는 용도라 다른 멤버가 쓰는 색은 고를 수 없다.

import { api, avatar, h, mount, openSheet, toast } from './ui.js'

export function openProfileSheet({ me, users, colors, onChanged, actions }) {
  const sheet = openSheet({ title: '내 프로필', subtitle: me.nickname })

  const takenBy = new Map()
  for (const user of users) {
    if (user.id !== me.id) takenBy.set(user.color, user.nickname)
  }

  // ── 색상 ──
  const picker = h('div', { class: 'color-picker' })
  function drawColors(current) {
    picker.replaceChildren(
      ...colors.map((color) => {
        const owner = takenBy.get(color)
        return h('button', {
          class: `color-dot${color === current ? ' on' : ''}${owner ? ' taken' : ''}`,
          style: `background:${color}`,
          title: owner ? `${owner}님이 사용 중` : color,
          disabled: Boolean(owner),
          onClick: async () => {
            try {
              const { user } = await api('/api/auth/me', { method: 'PATCH', body: { color } })
              me.color = user.color
              drawColors(user.color)
              onChanged(user)
              toast('색을 바꿨어요')
            } catch (e) {
              toast(e.message)
            }
          },
        })
      })
    )
  }
  drawColors(me.color)

  // ── PIN ──
  const currentPin = h('input', { type: 'password', inputmode: 'numeric', maxlength: '4', placeholder: '••••' })
  const newPin = h('input', { type: 'password', inputmode: 'numeric', maxlength: '4', placeholder: '••••' })
  const pinError = h('p', { class: 'error' })

  const changePin = h(
    'button',
    {
      class: 'btn btn-sm',
      onClick: async () => {
        pinError.textContent = ''
        try {
          await api('/api/auth/me/pin', {
            method: 'PATCH',
            body: { currentPin: currentPin.value, newPin: newPin.value },
          })
          currentPin.value = ''
          newPin.value = ''
          toast('PIN을 바꿨어요')
        } catch (e) {
          pinError.textContent = e.message
        }
      },
    },
    'PIN 변경'
  )

  mount(
    sheet.body,
    h(
      'div',
      { class: 'profile-head' },
      avatar(me),
      h('div', {}, h('strong', {}, me.nickname), me.role === 'admin' && h('span', { class: 'chip' }, '관리자'))
    ),
    h('h3', { class: 'profile-label' }, '내 색상'),
    h(
      'p',
      { class: 'profile-hint' },
      '지도 마커와 이름표에 쓰입니다. 흐린 색은 다른 멤버가 쓰고 있어 고를 수 없어요.'
    ),
    picker,
    h('h3', { class: 'profile-label', style: 'margin-top:22px' }, 'PIN 변경'),
    h(
      'div',
      { class: 'field-row' },
      h('div', { class: 'field' }, h('label', {}, '현재 PIN'), currentPin),
      h('div', { class: 'field' }, h('label', {}, '새 PIN'), newPin)
    ),
    pinError
  )

  // 좁은 화면에서는 네비에 다 넣을 수 없어 여기로 모은다
  if (actions) {
    mount(
      sheet.body,
      h('h3', { class: 'profile-label', style: 'margin-top:22px' }, '메뉴'),
      h(
        'div',
        { class: 'profile-menu' },
        h(
          'button',
          {
            class: 'btn-quiet btn-sm',
            onClick: () => {
              sheet.close()
              actions.openTrash()
            },
          },
          '휴지통'
        ),
        me.role === 'admin' &&
          h(
            'button',
            {
              class: 'btn-quiet btn-sm',
              onClick: () => {
                sheet.close()
                actions.openAdmin()
              },
            },
            '관리'
          ),
        h(
          'button',
          {
            class: 'btn-danger btn-sm',
            onClick: () => {
              sheet.close()
              actions.logout()
            },
          },
          '로그아웃'
        )
      )
    )
  }

  mount(
    sheet.foot,
    changePin,
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn-secondary btn-sm', onClick: sheet.close }, '닫기')
  )
}
