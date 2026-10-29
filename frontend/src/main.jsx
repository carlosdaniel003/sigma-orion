import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.jsx'
import { DppWorkspaceProvider } from './DppWorkspaceContext.jsx'
import './styles.css'
import './navigation.css'
import './dashboard-visibility.css'
import './dashboard-hierarchy.css'
import './sigma-orion-theme.css'
import './sigma-orion-theme-toggle.css'
import './brand.css'
import './dashboard-export.css'
import './product-language.css'
import './dashboard-operational-scope.css'
import './dpp-test-product.css'
import './knowledge-audit.css'
import './knowledge-navigation.css'
import './industrial-neutral-language.css'
import './sidebar-theme.css'
import './orion-dark-refinement.css'
import './dashboard-interaction-accents.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DppWorkspaceProvider>
      <App />
    </DppWorkspaceProvider>
  </StrictMode>,
)
