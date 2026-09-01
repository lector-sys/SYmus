import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import MiniPlayer from './MiniPlayer'
import { usePlayer, useNav } from './store'
import { applyTheme, loadTheme } from './theme'

// Before the first render, not in an effect: an effect runs after paint, so the
// user on light mode would see one frame of the dark palette on every launch.
const theme = loadTheme()
applyTheme(theme.mode, theme.accent)

// The player state, reachable from the devtools console and from
// scripts/drive.mjs. Context isolation keeps this out of the preload and main
// process, and the app loads no remote content, so there is nothing to leak to.
Object.assign(window, { __store: usePlayer, __nav: useNav })

// The mini player is the same bundle in a second window, told apart by the
// hash the main process loads it with.
const isMini = window.location.hash === '#mini'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isMini ? <MiniPlayer /> : <App />}</StrictMode>
)
