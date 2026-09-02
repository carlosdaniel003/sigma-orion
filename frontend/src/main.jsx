import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.jsx'
import { DppWorkspaceProvider } from './DppWorkspaceContext.jsx'
import './styles.css'
import './navigation.css'
import './dashboard-visibility.css'
import './dashboard-kpi-polish.css'
import './dashboard-table-polish.css'
import './dashboard-hierarchy.css'
import './dashboard-operational-polish.css'
import './sigma-orion-theme.css'
import './sigma-orion-theme-toggle.css'
import './dashboard-theme-runtime-fixes.css'
import './brand.css'
import './dpp-test.css'
import './dashboard-export.css'
import './product-language.css'
import './dashboard-operational-scope.css'
import './dpp-test-context.css'
import './dpp-test-product.css'
import './knowledge-audit.css'
import './knowledge-navigation.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DppWorkspaceProvider>
      <App />
    </DppWorkspaceProvider>
  </StrictMode>,
)
