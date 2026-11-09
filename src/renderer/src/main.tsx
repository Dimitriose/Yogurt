import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './styles.css'

// Failures outside the render cycle (async handlers, dangling promises) do not
// go through the ErrorBoundary. We log them so main forwards them to the log
// file, instead of letting them die silently in the renderer console.
window.addEventListener('error', (event) => {
  console.error('[renderer] uncaught error:', event.error ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer] unhandled promise rejection:', event.reason)
})

const container = document.getElementById('root')
if (!container) throw new Error('#root not found')

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
