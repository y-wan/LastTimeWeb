import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initializePwaUpdates } from './pwaUpdate'
import './styles.css'

initializePwaUpdates()

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
