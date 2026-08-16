// 로그인 / 프로필 생성 화면

export function renderAuth(root, onSignedIn) {
  let mode = 'login'

  function draw(error = '') {
    const isLogin = mode === 'login'
    root.innerHTML = `
      <div class="auth-screen">
        <div class="auth-card">
          <header>
            <h1>오사카 여행 도우미</h1>
            <p>${isLogin ? '닉네임과 PIN을 입력해주세요' : '프로필을 만들어주세요'}</p>
          </header>
          <form id="auth-form">
            <div class="field">
              <label for="nickname">닉네임</label>
              <input id="nickname" name="nickname" autocomplete="username"
                     placeholder="여행 멤버들이 알아볼 이름" maxlength="12" required />
            </div>
            <div class="field">
              <label for="pin">PIN 4자리</label>
              <input id="pin" name="pin" type="password" inputmode="numeric"
                     autocomplete="${isLogin ? 'current-password' : 'new-password'}"
                     placeholder="••••" pattern="\\d{4}" maxlength="4" required />
            </div>
            <p class="error">${error}</p>
            <button class="btn" type="submit">${isLogin ? '로그인' : '프로필 만들기'}</button>
          </form>
          <p class="auth-toggle">
            ${isLogin ? '아직 프로필이 없나요?' : '이미 프로필이 있나요?'}
            <button type="button" id="auth-toggle">${isLogin ? '만들기' : '로그인'}</button>
          </p>
        </div>
      </div>
    `

    root.querySelector('#auth-toggle').addEventListener('click', () => {
      mode = isLogin ? 'register' : 'login'
      draw()
    })

    const form = root.querySelector('#auth-form')
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const button = form.querySelector('button[type=submit]')
      button.disabled = true

      const body = {
        nickname: form.nickname.value.trim(),
        pin: form.pin.value,
      }

      try {
        const res = await fetch(`/api/auth/${mode}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) {
          button.disabled = false
          draw(data.error || '잠시 후 다시 시도해주세요.')
          root.querySelector('#nickname').value = body.nickname
          root.querySelector('#pin').focus()
          return
        }
        onSignedIn(data.user)
      } catch {
        button.disabled = false
        draw('서버에 연결하지 못했어요.')
      }
    })

    root.querySelector('#nickname').focus()
  }

  draw()
}
