import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles.css";
import "./styles/liquid.css";

import { AuthProvider } from "./providers/AuthContext.jsx";
import { StoreProvider } from "./providers/StoreContext.jsx";
import { ThemeProvider } from "./providers/ThemeContext.jsx";
import { WebSocketProvider } from "./providers/WebSocketContext.jsx";

// ✅ Simple ErrorBoundary to prevent blank screen on render crash
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ error, info });
    console.error(" Unhandled error caught by ErrorBoundary:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-center">
          <h2 className="text-xl font-semibold text-red-700">
            ⚠️ Something went wrong
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            The application encountered an unexpected error. Try reloading.
          </p>
          <pre className="mt-4 max-h-48 overflow-auto rounded bg-slate-100 p-3 text-xs text-red-600 text-left">
            {this.state.error?.message || "Unknown Error"}
            {this.state.info?.componentStack
              ? `\n\n${this.state.info.componentStack}`
              : ""}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Inject X-API-Key header on every fetch call that targets the backend.
// IoT devices hitting /update use their own api_key query param — unaffected.
if (typeof window !== "undefined") {
  const _fetch = window.fetch.bind(window);
  const BACKEND = import.meta.env.VITE_BACKEND_URL ?? `http://127.0.0.1:8085`;
  const API_KEY = import.meta.env.VITE_API_SECRET ?? "";

  window.fetch = (resource, init = {}) => {
    const url =
      typeof resource === "string"
        ? resource
        : resource instanceof Request
        ? resource.url
        : String(resource);

    if (API_KEY && url.startsWith(BACKEND)) {
      const headers = new Headers(init.headers ?? {});
      headers.set("X-API-Key", API_KEY);
      return _fetch(resource, { ...init, headers });
    }
    return _fetch(resource, init);
  };
}

// ✅ Global error handlers (non-React)
if (typeof window !== "undefined") {
  window.addEventListener("error", (evt) => {
    console.error("🌐 Global error:", evt.error || evt.message, evt);
  });
  window.addEventListener("unhandledrejection", (evt) => {
    console.error("🌐 Unhandled promise rejection:", evt.reason);
  });
}

// ✅ Main App Mount
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <StoreProvider>
          <WebSocketProvider>
            <BrowserRouter>
              <ErrorBoundary>
                <Suspense fallback={<div className="p-6 text-center">Loading...</div>}>
                  <App />
                </Suspense>
              </ErrorBoundary>
            </BrowserRouter>
          </WebSocketProvider>
        </StoreProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
