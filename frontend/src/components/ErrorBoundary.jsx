import { Component } from "react";
import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";

/* MW-10 fix. Before this, a render error anywhere in the app unmounted
   the whole React tree -- the page went blank with no message and no way
   forward except a manual reload. MW-08 (the Update/Escalate crash) hit
   exactly that. An ErrorBoundary contains render errors to whatever
   subtree it wraps, so a single broken component costs the reader that
   panel and nothing else.

   Notes:
     * Only class components can catch render errors -- there is no hook
       equivalent, so this stays a class on purpose.
     * The boundary catches render/lifecycle errors. Async errors (event
       handlers, promises, setTimeout) still escape -- those need their
       own try/catch. React 18's automatic batching does not change that.
     * `resetKey` is a prop the parent can bump (e.g. on route change) to
       clear a stuck error and try rendering again. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Keep this quiet on purpose -- the boundary already renders a
    // human-readable apology, and a stack trace in the console lets
    // devtools users track it down without an alert to end users.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info?.componentStack);
    // Sentry is initialised on the backend (see backend/core/observability);
    // when a frontend Sentry client lands, wire it here.
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    // Custom fallback wins if provided, so a panel-level boundary can
    // show a smaller message than the page-level one.
    if (this.props.fallback) {
      return this.props.fallback({
        error: this.state.error,
        reset: this.handleReset,
        reload: this.handleReload,
      });
    }

    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-white/60 bg-white/95 p-6 shadow-[0_8px_28px_-10px_hsl(230_18%_15%/0.22)] backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2 text-[hsl(var(--danger-600,10_78%_45%))]">
            <WarningCircle size={20} weight="bold" />
            <p className="text-[11px] font-medium uppercase tracking-[0.14em]">Something broke here</p>
          </div>
          <h2 className="mb-2 font-display text-xl">This panel couldn't render.</h2>
          <p className="mb-5 text-sm text-muted-foreground">
            The rest of the app should still work. Reload to try this section again — the error has been logged.
          </p>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-1.5 rounded-pill bg-kr-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              data-testid="error-boundary-reload"
            >
              <ArrowClockwise size={14} weight="bold" /> Reload
            </button>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-1.5 rounded-pill border border-black/10 bg-white px-4 py-2 text-sm font-medium hover:border-black/30"
              data-testid="error-boundary-dismiss"
            >
              Try again without reloading
            </button>
          </div>
          {process.env.NODE_ENV !== "production" && this.state.error?.message && (
            <pre className="mt-4 max-h-32 overflow-auto rounded-lg border border-black/10 bg-black/5 p-2 text-[11px] leading-snug text-foreground/70">
              {this.state.error.message}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
