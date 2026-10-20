import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from '@/components/shared/ErrorState'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Last line of defence outside the router (providers, toaster, router bootstrap).
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  override render() {
    if (this.state.error) return <ErrorState fullScreen />
    return this.props.children
  }
}
