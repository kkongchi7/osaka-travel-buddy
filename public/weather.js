// 목록 맨 위에 붙는 한 줄 날씨. 출처는 tenki.jp 오사카 기타구 예보.
import { api, h, mount, openSheet } from './ui.js'

let cached = null // 화면을 다시 그려도 매번 부르지 않는다

const dayLabel = (d) => `${d.month}/${d.day}`

function detailSheet(forecast) {
  const sheet = openSheet({
    title: '오사카 날씨',
    subtitle: `${forecast.place} · 앞으로 ${forecast.days.length}일`,
  })

  const rows = forecast.days.map((d) =>
    h(
      'div',
      { class: `weather-row${d.isWeekend ? ' weekend' : ''}` },
      h(
        'div',
        { class: 'weather-row-day' },
        h('span', { class: 'weather-row-date' }, dayLabel(d)),
        h('span', { class: 'weather-row-weekday' }, d.weekday)
      ),
      h('span', { class: 'weather-row-icon' }, d.icon),
      h('span', { class: 'weather-row-label' }, d.label),
      h(
        'span',
        { class: 'weather-row-temp' },
        h('span', { class: 'high' }, d.high ?? '—'),
        h('span', { class: 'low' }, d.low ?? '—')
      ),
      h('span', { class: 'weather-row-prob' }, d.prob ?? '—'),
      h('span', { class: 'weather-row-precip' }, d.precip ?? '—')
    )
  )

  mount(
    sheet.body,
    h(
      'div',
      { class: 'weather-table' },
      h(
        'div',
        { class: 'weather-row weather-head' },
        h('div', { class: 'weather-row-day' }, '날짜'),
        h('span', { class: 'weather-row-icon' }, ''),
        h('span', { class: 'weather-row-label' }, '날씨'),
        h('span', { class: 'weather-row-temp' }, '최고/최저'),
        h('span', { class: 'weather-row-prob' }, '강수확률'),
        h('span', { class: 'weather-row-precip' }, '강수량')
      ),
      ...rows
    )
  )

  mount(
    sheet.foot,
    h(
      'a',
      {
        class: 'btn-secondary',
        href: forecast.source,
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      'tenki.jp 에서 보기'
    ),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn', onClick: sheet.close }, '닫기')
  )
}

/** 한 줄 날씨 바. 아직 못 불러왔으면 null 을 돌려주고 조용히 사라진다. */
export function renderWeather() {
  if (!cached) return null
  const forecast = cached

  const days = forecast.days.map((d) =>
    h(
      'div',
      { class: `weather-day${d.isWeekend ? ' weekend' : ''}`, title: `${d.label} ${d.high ?? ''}` },
      h('span', { class: 'weather-day-date' }, dayLabel(d)),
      h('span', { class: 'weather-day-icon' }, d.icon)
    )
  )

  return h(
    'section',
    { class: 'weather' },
    h(
      'a',
      {
        class: 'weather-source',
        href: forecast.source,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: `출처: tenki.jp · ${forecast.place}`,
      },
      'tenki.jp'
    ),
    h('div', { class: 'weather-days' }, ...days),
    h(
      'button',
      { class: 'weather-more', onClick: () => detailSheet(forecast) },
      '자세히 보기'
    )
  )
}

/** 배경에서 한 번 불러온다. 실패하면 바를 그리지 않는다. */
export async function loadWeather() {
  if (cached) return cached
  try {
    cached = await api('/api/weather')
  } catch {
    cached = null // 날씨는 부가 기능이라 실패해도 넘어간다
  }
  return cached
}
