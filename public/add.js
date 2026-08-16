// 장소 추가 흐름
//   링크 입력 → 미리보기 → (분류 확인) → 등록
//   저장 목록 링크면 → 여러 개 매칭 목록 → 선택 등록
//   해석 실패 시 → 이름으로 직접 검색

import { api, h, loadingRow, mount, openSheet, toast } from './ui.js'

export function openAddSheet({ config, onAdded, onShowPlace }) {
  const sheet = openSheet({ title: '장소 추가', subtitle: '구글 지도 링크를 붙여넣으세요' })
  renderInput(sheet, { config, onAdded, onShowPlace })
}

function renderInput(sheet, ctx, presetError = '') {
  sheet.body.replaceChildren()
  sheet.foot.replaceChildren()

  const input = h('input', {
    placeholder: 'https://maps.app.goo.gl/…',
    autocomplete: 'off',
    spellcheck: 'false',
  })
  const errorLine = h('p', { class: 'error' }, presetError)

  sheet.body.append(
    h(
      'div',
      { class: 'field' },
      h('label', {}, '구글 지도 링크'),
      input,
      h(
        'p',
        { style: 'margin:0;font-size:13px;color:var(--fg-secondary)' },
        '개별 장소 링크는 물론, 저장 목록 공유 링크를 넣으면 여러 곳을 한 번에 가져옵니다.'
      )
    ),
    errorLine
  )

  const submit = h('button', { class: 'btn' }, '가져오기')
  sheet.foot.append(
    h('button', { class: 'btn-secondary', onClick: sheet.close }, '취소'),
    h('div', { class: 'spacer' }),
    submit
  )

  async function run() {
    const url = input.value.trim()
    if (!url) return
    submit.disabled = true
    errorLine.textContent = ''
    sheet.body.replaceChildren(loadingRow('링크를 확인하는 중…'))

    try {
      const result = await api('/api/places/preview', { method: 'POST', body: { url } })
      if (result.kind === 'list') renderBulk(sheet, ctx, url)
      else renderConfirm(sheet, ctx, result)
    } catch (e) {
      if (e.status === 409) renderDuplicate(sheet, ctx, e.data)
      else if (e.data?.needsManualSearch) renderManualSearch(sheet, ctx, e.message)
      else renderInput(sheet, ctx, e.message)
    }
  }

  submit.addEventListener('click', run)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') run()
  })
  input.focus()
}

// ── 중복 ──────────────────────────────────────────────
function renderDuplicate(sheet, ctx, data) {
  sheet.body.replaceChildren(
    h('div', { class: 'notice notice-warn' }, data?.message ?? '이미 등록된 장소예요.'),
    h('div', { class: 'preview' }, h('div', { class: 'preview-info' }, h('div', { class: 'name' }, data?.name ?? '')))
  )
  sheet.foot.replaceChildren(
    h('button', { class: 'btn-secondary', onClick: () => renderInput(sheet, ctx) }, '다른 링크'),
    h('div', { class: 'spacer' }),
    h(
      'button',
      {
        class: 'btn',
        onClick: () => {
          sheet.close()
          ctx.onShowPlace(data.placeId)
        },
      },
      '확인하기'
    )
  )
}

// ── 수동 검색 ─────────────────────────────────────────
function renderManualSearch(sheet, ctx, message) {
  sheet.body.replaceChildren()
  sheet.foot.replaceChildren()

  const input = h('input', { placeholder: '예: 구로몬시장', autocomplete: 'off' })
  const results = h('div', { class: 'bulk-list' })

  mount(
    sheet.body,
    message && h('div', { class: 'notice notice-warn' }, message),
    h('div', { class: 'field' }, h('label', {}, '장소 이름'), input),
    results
  )

  async function search() {
    const query = input.value.trim()
    if (query.length < 2) return
    results.replaceChildren(loadingRow('검색 중…'))
    try {
      const { results: found } = await api('/api/places/search', { method: 'POST', body: { query } })
      if (!found.length) {
        results.replaceChildren(h('div', { class: 'notice' }, '검색 결과가 없어요.'))
        return
      }
      results.replaceChildren(
        ...found.map((r) =>
          h(
            'div',
            {
              class: 'bulk-row',
              onClick: async () => {
                results.replaceChildren(loadingRow('장소 정보를 가져오는 중…'))
                try {
                  const preview = await api('/api/places/preview', {
                    method: 'POST',
                    body: { url: `https://www.google.com/maps/place/?q=place_id:${r.id}` },
                  })
                  renderConfirm(sheet, ctx, preview)
                } catch {
                  // preview 경로가 막히면 후보 정보만으로 바로 등록 확인 화면을 띄운다
                  renderConfirm(sheet, ctx, {
                    candidate: {
                      googlePlaceId: r.id,
                      name: r.name,
                      address: r.address,
                      lat: r.lat,
                      lng: r.lng,
                      photos: [],
                      reviews: [],
                      category: '기타',
                      area: '기타',
                    },
                    confidence: 'medium',
                  })
                }
              },
            },
            h('span', { class: 'name' }, r.name),
            h('span', { class: 'tag' }, (r.address ?? '').slice(0, 24))
          )
        )
      )
    } catch (e) {
      results.replaceChildren(h('div', { class: 'notice notice-error' }, e.message))
    }
  }

  const button = h('button', { class: 'btn', onClick: search }, '검색')
  sheet.foot.append(
    h('button', { class: 'btn-secondary', onClick: () => renderInput(sheet, ctx) }, '뒤로'),
    h('div', { class: 'spacer' }),
    button
  )
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') search()
  })
  input.focus()
}

// ── 단일 등록 확인 ────────────────────────────────────
function renderConfirm(sheet, ctx, result) {
  const c = result.candidate
  sheet.body.replaceChildren()
  sheet.foot.replaceChildren()

  const nameInput = h('input', { value: c.name ?? '' })
  const categorySelect = h(
    'select',
    {},
    ...ctx.config.categories.map((v) => h('option', { value: v, selected: v === c.category }, v))
  )
  const areaSelect = h(
    'select',
    {},
    ...ctx.config.areas.map((v) => h('option', { value: v, selected: v === c.area }, v))
  )
  const memoInput = h('textarea', { placeholder: '이 장소에 대해 간단하게 적어주세요 (선택)' })

  mount(
    sheet.body,
    result.confidence === 'low' &&
      h(
        'div',
        { class: 'notice notice-warn' },
        '링크에서 장소를 정확히 특정하지 못했어요. 아래 정보가 맞는지 확인해주세요.'
      ),
    h(
      'div',
      { class: 'preview' },
      c.photos?.[0]?.ref
        ? h('img', {
          src: `/api/photo/preview?ref=${encodeURIComponent(c.photos[0].ref)}&w=300`,
          alt: '',
            onError: (e) => e.target.remove(),
          })
        : null,
      h(
        'div',
        { class: 'preview-info' },
        h('div', { class: 'name' }, c.name ?? ''),
        h('div', { class: 'addr' }, c.address ?? ''),
        h(
          'div',
          { class: 'addr' },
          [c.rating ? `★ ${c.rating}` : null, c.typeLabel, `사진 ${c.photos?.length ?? 0}`, `리뷰 ${c.reviews?.length ?? 0}`]
            .filter(Boolean)
            .join(' · ')
        )
      )
    ),
    h('div', { class: 'field' }, h('label', {}, '표시할 이름'), nameInput),
    h(
      'div',
      { class: 'field-row' },
      h('div', { class: 'field' }, h('label', {}, '카테고리'), categorySelect),
      h('div', { class: 'field' }, h('label', {}, '지역'), areaSelect)
    ),
    h('div', { class: 'field' }, h('label', {}, '메모'), memoInput)
  )

  const submit = h('button', { class: 'btn' }, '등록하기')
  sheet.foot.append(
    h('button', { class: 'btn-secondary', onClick: () => renderInput(sheet, ctx) }, '뒤로'),
    h('div', { class: 'spacer' }),
    submit
  )

  submit.addEventListener('click', async () => {
    submit.disabled = true
    submit.textContent = '등록 중…'
    try {
      const { place } = await api('/api/places', {
        method: 'POST',
        body: {
          googlePlaceId: c.googlePlaceId,
          name: nameInput.value,
          category: categorySelect.value,
          area: areaSelect.value,
          memo: memoInput.value,
        },
      })
      sheet.close()
      ctx.onAdded(place.id)
      toast(`${place.name} 등록 완료`)
    } catch (e) {
      submit.disabled = false
      submit.textContent = '등록하기'
      if (e.status === 409) renderDuplicate(sheet, ctx, e.data)
      else toast(e.message)
    }
  })
}

// ── 저장 목록 일괄 등록 ───────────────────────────────
function renderBulk(sheet, ctx, url) {
  sheet.body.replaceChildren(loadingRow('저장 목록을 여는 중… 20초 정도 걸릴 수 있어요'))
  sheet.foot.replaceChildren()

  api('/api/places/preview-list', { method: 'POST', body: { url } })
    .then((result) => drawBulk(sheet, ctx, result))
    .catch((e) => renderInput(sheet, ctx, e.message))
}

function drawBulk(sheet, ctx, result) {
  const selectable = result.items.filter((it) => it.matched && !it.duplicate)
  const checks = new Map()

  sheet.body.replaceChildren()
  sheet.foot.replaceChildren()

  const rows = h('div', { class: 'bulk-list' })
  for (const item of result.items) {
    const isDup = Boolean(item.duplicate)
    const unmatched = !item.matched
    const box = h('input', {
      type: 'checkbox',
      checked: !isDup && !unmatched,
      disabled: isDup || unmatched,
    })
    if (!isDup && !unmatched) checks.set(item, box)

    const row = h(
      'label',
      { class: `bulk-row${isDup || unmatched ? ' is-dup' : ''}` },
      box,
      h('span', { class: 'name' }, item.matched?.name ?? item.name),
      item.rating && h('span', { class: 'tag' }, `★${item.rating}`),
      h('span', { class: 'tag' }, item.typeLabel ?? ''),
      isDup
        ? h('span', { class: 'flag flag-dup' }, '이미 있음')
        : unmatched
          ? h('span', { class: 'flag flag-dup' }, '못 찾음')
          : item.confidence !== 'high'
            ? h('span', { class: 'flag flag-check' }, '확인 필요')
            : null
    )
    row.addEventListener('change', updateCount)
    rows.append(row)
  }

  const dupCount = result.items.filter((it) => it.duplicate).length
  const missCount = result.items.filter((it) => !it.matched).length

  sheet.body.append(
    h(
      'div',
      { class: 'notice' },
      `"${result.title}" · 총 ${result.total}곳` +
        (dupCount ? ` · 이미 등록 ${dupCount}곳` : '') +
        (missCount ? ` · 못 찾음 ${missCount}곳` : '')
    ),
    rows
  )

  const submit = h('button', { class: 'btn' }, '')
  function updateCount() {
    const count = [...checks.values()].filter((b) => b.checked).length
    submit.textContent = `${count}곳 등록하기`
    submit.disabled = count === 0
  }

  const toggleAll = h(
    'button',
    {
      class: 'btn-secondary',
      onClick: () => {
        const allOn = [...checks.values()].every((b) => b.checked)
        for (const b of checks.values()) b.checked = !allOn
        updateCount()
      },
    },
    '전체 선택/해제'
  )

  sheet.foot.append(toggleAll, h('div', { class: 'spacer' }), submit)
  updateCount()

  submit.addEventListener('click', async () => {
    const chosen = [...checks.entries()]
      .filter(([, box]) => box.checked)
      .map(([item]) => ({ googlePlaceId: item.matched.placeId, name: item.matched.name }))

    submit.disabled = true
    sheet.body.replaceChildren(loadingRow(`${chosen.length}곳을 등록하는 중…`))
    try {
      const res = await api('/api/places/bulk', { method: 'POST', body: { items: chosen } })
      sheet.close()
      ctx.onAdded()
      const failedNote = res.failed.length ? `, 실패 ${res.failed.length}곳` : ''
      toast(`${res.addedCount}곳 등록 완료${failedNote}`)
    } catch (e) {
      sheet.body.replaceChildren(h('div', { class: 'notice notice-error' }, e.message))
      submit.disabled = false
    }
  })

  void selectable
}
