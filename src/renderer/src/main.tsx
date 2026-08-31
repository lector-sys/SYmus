import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { usePlayer, useNav } from './store'

// The player state, reachable from the devtools console and from
// scripts/drive.mjs. Context isolation keeps this out of the preload and main
// process, and the app loads no remote content, so there is nothing to leak to.
Object.assign(window, { __store: usePlayer, __nav: useNav })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
