// 공통 UI 헬퍼 — DOM 생성, 시트, 토스트, API 호출

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue
    if (key === 'class') el.className = value
    else if (key === 'style') el.setAttribute('style', value)
    else if (key === 'html') el.innerHTML = value
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value)
    else el.setAttribute(key, value === true ? '' : value)
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return el
}

// Element.append() 는 false/null 을 문자열로 바꿔 넣어버린다.
// 조건부 자식을 붙일 때는 h() 대신 이걸 쓴다.
export function mount(parent, ...children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return parent
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  if (!res.ok) {
    const error = new Error(data?.message || data?.error || `요청에 실패했어요 (${res.status})`)
    error.status = res.status
    error.data = data
    // 세션이 끊긴 상태로 계속 두면 뭘 눌러도 실패한다. 앱이 로그인 화면으로 되돌리게 알린다.
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent('otb:session-expired', { detail: error.message }))
    }
    throw error
  }
  return data
}

export function avatar(user, small = false) {
  return h(
    'span',
    {
      class: `avatar${small ? ' avatar-sm' : ''}`,
      style: `background:${user?.color ?? '#86868b'}`,
      title: user?.nickname ?? '',
    },
    (user?.nickname ?? '?').slice(0, 1).toUpperCase()
  )
}

let toastTimer = null
export function toast(message, action) {
  document.querySelector('.toast')?.remove()
  clearTimeout(toastTimer)

  const node = h(
    'div',
    { class: 'toast' },
    h('span', {}, message),
    action &&
      h(
        'button',
        {
          onClick: () => {
            node.remove()
            action.onClick()
          },
        },
        action.label
      )
  )
  document.body.append(node)
  toastTimer = setTimeout(() => node.remove(), action ? 8000 : 3200)
}

/** 시트를 열고 { body, foot, close } 를 돌려준다 */
export function openSheet({ title, subtitle, wide = false, onClose } = {}) {
  const body = h('div', { class: 'sheet-body' })
  const foot = h('div', { class: 'sheet-foot' })

  function close() {
    backdrop.remove()
    document.removeEventListener('keydown', onKey)
    onClose?.()
  }
  function onKey(event) {
    if (event.key === 'Escape') close()
  }

  const sheet = h(
    'div',
    { class: `sheet${wide ? ' sheet-wide' : ''}`, onClick: (e) => e.stopPropagation() },
    h(
      'div',
      { class: 'sheet-head' },
      h('div', {}, h('h2', {}, title), subtitle && h('div', { class: 'sub' }, subtitle)),
      h('div', { class: 'nav-spacer' }),
      h('button', { class: 'close-x', onClick: close, 'aria-label': '닫기' }, '✕')
    ),
    body,
    foot
  )

  const backdrop = h('div', { class: 'sheet-backdrop', onClick: close }, sheet)
  document.body.append(backdrop)
  document.addEventListener('keydown', onKey)

  return { body, foot, close, sheet }
}

/**
 * 브라우저 기본 confirm() 대신 쓰는 확인 대화상자.
 * true/false 로 resolve 되는 Promise 를 돌려준다.
 */
export function confirmDialog({
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      backdrop.remove()
      document.removeEventListener('keydown', onKey)
      resolve(value)
    }
    function onKey(event) {
      if (event.key === 'Escape') finish(false)
      if (event.key === 'Enter') finish(true)
    }

    const confirmButton = h(
      'button',
      { class: `btn btn-sm${danger ? ' btn-solid-danger' : ''}`, onClick: () => finish(true) },
      confirmLabel
    )

    const dialog = h(
      'div',
      { class: 'sheet confirm', onClick: (e) => e.stopPropagation() },
      h(
        'div',
        { class: 'confirm-body' },
        h('h2', {}, title),
        message && h('p', {}, message)
      ),
      h(
        'div',
        { class: 'sheet-foot' },
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn-secondary btn-sm', onClick: () => finish(false) }, cancelLabel),
        confirmButton
      )
    )

    const backdrop = h('div', { class: 'sheet-backdrop', onClick: () => finish(false) }, dialog)
    document.body.append(backdrop)
    document.addEventListener('keydown', onKey)
    confirmButton.focus()
  })
}

export function loadingRow(text = '불러오는 중…') {
  return h('div', { class: 'loading-row' }, h('div', { class: 'spinner' }), text)
}

export function timeAgo(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return '방금'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}일 전`
  return new Date(iso).toLocaleDateString('ko-KR')
}
