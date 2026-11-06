import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/tokens.css'
import '../styles/app.css'
import './torenscherm.css'
import { Torenscherm } from './Torenscherm'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Torenscherm />
  </StrictMode>,
)
