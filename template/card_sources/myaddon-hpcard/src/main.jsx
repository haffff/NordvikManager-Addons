import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import App from './App.jsx'

const root = createRoot(document.getElementById('root'))
const render = (api) =>
  root.render(
    <StrictMode>
      <App Api={api} />
    </StrictMode>
  )

if (import.meta.env.DEV) {
  // `pnpm dev`: no app around, so use the mock. This branch is left out of the build.
  import('../ApiMock.js').then(({ createApiMock }) =>
    render(createApiMock({ properties: { hp: '8', maxhp: '12', name: 'Aria' } }))
  )
} else if (window.CardAPI?.cardId) {
  render(window.CardAPI)
} else {
  // In the game: wait until the app has told the page which card it is.
  window.addEventListener('cardapi:ready', (e) => render(e.detail), { once: true })
}
