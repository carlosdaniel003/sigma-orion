import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.jsx'
import { DppWorkspaceProvider } from './DppWorkspaceContext.jsx'
import './styles.css'
import './navigation.css'
import './dashboard-visibility.css'
import './dashboard-kpi-polish.css'
import './dashboard-table-polish.css'
import './dashboard-comparison.css'
import './dashboard-hierarchy.css'
import './dashboard-operational-polish.css'
import './sigma-orion-theme.css'
import './sigma-orion-theme-toggle.css'
import './dashboard-theme-runtime-fixes.css'
import './dashboard-operational-scope.css'
import './brand.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DppWorkspaceProvider>
      <App />
    </DppWorkspaceProvider>
  </StrictMode>,
)
