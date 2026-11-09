import { Component, type ErrorInfo, type ReactNode } from 'react'
import { msgs } from '@shared/i18n'

/**
 * Without this, an exception during render takes down the whole tree and the
 * app becomes a black screen, with no clue about what happened. Here the error
 * stays visible and the user can reload without losing what is on disk.
 */

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  info: string | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Goes to the renderer console, which main forwards to the log.
    console.error('[renderer] unhandled error during render:', error, info.componentStack)
    this.setState({ info: info.componentStack ?? null })
  }

  render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children
    const m = msgs().ui.errorBoundary

    return (
      <div className="crash">
        <div className="crash-card">
          <h1>{m.title}</h1>
          <p className="muted">{m.body}</p>
          <pre className="crash-detail">
            {error.message}
            {info ? `\n${info}` : ''}
          </pre>
          <div className="crash-actions">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              {m.reload}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => void window.yogurt.app.openDataFolder()}
            >
              {m.openDataFolder}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
