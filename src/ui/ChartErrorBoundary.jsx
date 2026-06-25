import { Component } from "react";

export default class ChartErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, message: err?.message ?? "Render error" };
  }

  componentDidCatch(err, info) {
    console.error("[ChartErrorBoundary]", err, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-56 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50/60 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <span className="font-semibold">Chart render error</span>
          <span className="max-w-xs text-center text-xs opacity-70">{this.state.message}</span>
          <button
            className="mt-2 rounded-lg border border-red-300 px-3 py-1 text-xs font-medium hover:bg-red-100 dark:border-red-500/40 dark:hover:bg-red-500/20"
            onClick={() => this.setState({ hasError: false, message: "" })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
