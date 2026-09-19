import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyLocalizedAppMetadata } from './appMetadata'
import { initializePwaUpdates } from './pwaUpdate'
import './styles.css'

applyLocalizedAppMetadata(navigator.language)
initializePwaUpdates()

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
