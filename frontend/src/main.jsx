import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.jsx'
import { DppWorkspaceProvider } from './DppWorkspaceContext.jsx'
import './styles.css'
import './navigation.css'
import './dashboard-visibility.css'
import './dashboard-kpi-polish.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DppWorkspaceProvider>
      <App />
    </DppWorkspaceProvider>
  </StrictMode>,
)
