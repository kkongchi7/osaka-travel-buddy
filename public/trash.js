// 쓰레기통 — 삭제한 장소를 되살리거나 완전히 지운다

import { api, avatar, confirmDialog, h, loadingRow, mount, openSheet, timeAgo, toast } from './ui.js'

export function openTrashSheet({ onChanged }) {
  const sheet = openSheet({
    title: '쓰레기통',
    subtitle: '삭제한 장소는 여기서 되살릴 수 있어요',
  })
  draw()

  async function draw() {
    sheet.body.replaceChildren(loadingRow())
    sheet.foot.replaceChildren(
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn btn-sm', onClick: sheet.close }, '닫기')
    )

    let data
    try {
      data = await api('/api/places/trash')
    } catch (e) {
      sheet.body.replaceChildren(h('div', { class: 'notice notice-error' }, e.message))
      return
    }

    if (!data.items.length) {
      sheet.body.replaceChildren(
        h('div', { class: 'empty' }, h('h3', {}, '비어 있어요'), h('p', {}, '삭제한 장소가 없습니다.'))
      )
      return
    }

    sheet.body.replaceChildren(...data.items.map((item) => row(item, data.users)))
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

  function row(item, users) {
    const remover = users.find((u) => u.id === item.deletedBy)
    return h(
      'div',
      { class: 'trash-row' },
      item.hasPhoto
        ? h('img', { class: 'trash-thumb', src: `/api/photo/${item.id}?w=120`, alt: '', loading: 'lazy' })
        : h('div', { class: 'trash-thumb placeholder' }, '📍'),
      h(
        'div',
        { class: 'trash-info' },
        h('div', { class: 'trash-name' }, item.name),
        mount(
          h('div', { class: 'trash-meta' }),
          h('span', {}, [item.category, item.area].join(' · ')),
          remover && avatar(remover, true),
          h('span', {}, `${timeAgo(item.deletedAt)} 삭제`)
        )
      ),
      h(
        'div',
        { class: 'trash-actions' },
        h(
          'button',
          {
            class: 'btn-quiet btn-sm',
            onClick: () =>
              act(async () => {
                await api(`/api/places/trash/${item.id}/restore`, { method: 'POST' })
                toast(`${item.name} 복원됨`)
              }),
          },
          '복원'
        ),
        h(
          'button',
          {
            class: 'btn-danger btn-sm',
            onClick: async () => {
              const ok = await confirmDialog({
                title: '완전히 삭제할까요?',
                message: `'${item.name}'을(를) 영구히 지웁니다. 되돌릴 수 없어요.`,
                confirmLabel: '완전 삭제',
                danger: true,
              })
              if (ok) act(() => api(`/api/places/trash/${item.id}`, { method: 'DELETE' }))
            },
          },
          '완전 삭제'
        )
      )
    )
  }
}
