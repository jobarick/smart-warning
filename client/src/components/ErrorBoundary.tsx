import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Last line of defense: if any render throws — a malformed alert that slipped
 * past validation, a browser-API quirk — show a recoverable fallback instead of
 * a blank white screen. Without this, one bad message blanked the whole app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Alert app crashed and was caught by the error boundary:', error, info);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-fallback" role="alert">
        <h1>Something went wrong</h1>
        <p>The alert screen hit an error and was stopped so the app stays usable.</p>
        <button className="btn" onClick={this.reset}>
          Dismiss and continue
        </button>
      </div>
    );
  }
}
