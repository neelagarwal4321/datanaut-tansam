import { Fragment, Suspense, lazy, useState } from "react";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useAuth } from "./providers/AuthContext.jsx";
import { useTheme } from "./providers/ThemeContext.jsx";
import {
  Home as HomeIcon,
  Database,
  LayoutDashboard,
  BarChart2,
  Tv,
  Menu,
  X,
  LogOut,
  Sun,
  Moon,
  User,
  Activity,
} from "lucide-react";

// Lazy-loaded pages — code-split per route for faster initial paint
const Login              = lazy(() => import("./pages/Login.jsx"));
const Home               = lazy(() => import("./pages/Home.jsx"));
const DataPage           = lazy(() => import("./pages/Data.jsx"));
const VisualizePage      = lazy(() => import("./pages/Visualize.jsx"));
const DynamicDataPage    = lazy(() => import("./pages/DynamicData.jsx"));
const Dashboard          = lazy(() => import("./pages/Dashboard.jsx"));
const DynamicDashboard   = lazy(() => import("./pages/DynamicDashboard.jsx"));
const DynamicVisualizePage = lazy(() => import("./pages/DynamicVisualize.jsx"));
const PresentationMode   = lazy(() => import("./ui/PresentationMode.jsx"));
const PresentationWindow = lazy(() => import("./ui/PresentationWindow.jsx"));
const NotFound           = lazy(() => import("./pages/NotFound.jsx"));

import ChatBot from "./ui/ChatBot.jsx";
import LiquidBackdrop from "./ui/LiquidBackdrop.jsx";
import logoImage from "./LOGO.jpg";

const PageLoader = () => (
  <div className="flex h-48 items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-brand-500" />
  </div>
);

// ✅ Centralized navigation with modern icons
const navLinks = [
  { to: "/home", label: "Home", icon: HomeIcon },
  { to: "/data", label: "Static Data", icon: Database },
  { to: "/visualize", label: "Visualize", icon: BarChart2 },
  { to: "/dashboard", label: "Static Dashboard", icon: LayoutDashboard },
  { to: "/dynamic-data", label: "Dynamic Data", icon: Activity },
  { to: "/dynamic-dashboard", label: "Dynamic Dashboard", icon: LayoutDashboard },
  { to: "/presentation", label: "Presentation", icon: Tv },
];

function Layout() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isLoginPage = location.pathname === "/login";

  // If login page, render full screen minimal view
  if (isLoginPage) {
    return (
      <div className="min-h-screen flex flex-col justify-center bg-slate-950 relative w-full overflow-hidden">
        <LiquidBackdrop />
        <main className="w-full flex-1 flex flex-col justify-center relative z-10">
          <Outlet />
        </main>
      </div>
    );
  }

  // Get active link label for page header title
  const activeLink = navLinks.find(link => location.pathname.startsWith(link.to));
  const pageTitle = activeLink ? activeLink.label : "DATANAUT";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 transition-colors">
      <LiquidBackdrop />

      {/* ====== SIDEBAR (Desktop / Collapsed Mobile) ====== */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-300 dark:border-slate-800 dark:bg-slate-950 md:static md:translate-x-0 ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand / Logo Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-slate-800/60">
          <Link to="/home" className="flex items-center gap-3">
            <div className="h-10 w-10 overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-700/80">
              <img src={logoImage} alt="Logo" className="h-full w-full object-cover" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">DATANAUT</h1>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold tracking-wider uppercase">Analytics Hub</p>
            </div>
          </Link>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-900 md:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-1 px-4 py-6 overflow-y-auto">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = location.pathname.startsWith(link.to);
            return (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3.5 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-brand-50/80 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900/60 dark:hover:text-slate-100"
                }`}
              >
                <Icon className={`h-5 w-5 ${isActive ? "text-brand-500" : "text-slate-400 dark:text-slate-500"}`} />
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* User / Bottom Controls */}
        <div className="mt-auto border-t border-slate-100 px-4 py-4 dark:border-slate-800/60 space-y-3 bg-white/50 dark:bg-slate-950/50">
          {/* User Profile Badge */}
          {user && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50/80 dark:bg-slate-900/80 border border-slate-100 dark:border-slate-800">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                <User className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold uppercase">Active User</p>
                <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">{user.email}</p>
              </div>
            </div>
          )}

          {/* Theme & Logout Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex-1 flex justify-center items-center rounded-xl border border-slate-200/80 dark:border-slate-800/80 p-2.5 hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors"
              title={theme === "dark" ? "Switch to Light mode" : "Switch to Dark mode"}
            >
              {theme === "dark" ? <Sun className="h-5 w-5 text-amber-500" /> : <Moon className="h-5 w-5 text-slate-500" />}
            </button>
            <button
              onClick={logout}
              className="flex-[2] flex items-center justify-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800/80 p-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-900/60 transition-colors"
            >
              <LogOut className="h-4.5 w-4.5" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ====== MOBILE DRAWER OVERLAY ====== */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* ====== MAIN VIEWPORT (Right Panel) ====== */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top Header Navigation Bar */}
        <header className="flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/70 px-6 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/70">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="rounded-xl border border-slate-200/80 p-2 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900 md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white md:text-xl">
              {pageTitle}
            </h2>
          </div>
        </header>

        {/* Scrollable Content Outlet */}
        <main className="flex-1 overflow-y-auto min-h-0">
          <div className="min-h-full flex flex-col p-6">
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>

            {/* Footer pushed below all content — never overlaps */}
            <footer className="mt-auto pt-8 w-full text-center border-t border-slate-100 dark:border-slate-800/60 py-6">
              <div className="text-xs text-slate-400 dark:text-slate-500">
                <p>&copy; 2026 DATANAUT. All rights reserved.</p>
                <p className="mt-1 font-medium">Developed by the DATANAUT Team</p>
              </div>
            </footer>
          </div>
        </main>
      </div>

      {/* ====== ChatBot (for logged-in users only) ====== */}
      {user && <ChatBot />}
    </div>
  );
}

// ✅ Protect private routes
function PrivateRoute({ children }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Fragment>{children}</Fragment>;
}

// ✅ Define all app routes
export default function App() {
  const location = useLocation();
  const { user } = useAuth();

  return (
    <Routes location={location} key={location.pathname}>
      {/* Presentation Window Route - No Layout, No Auth Check (opened from authenticated session) */}
      <Route
        path="/presentation-window"
        element={<PresentationWindow />}
      />

      {/* Main Layout Routes */}
      <Route element={<Layout />}>
        <Route
          path="/"
          element={<Navigate to={user ? "/dashboard" : "/login"} replace />}
        />
        <Route
          path="/login"
          element={user ? <Navigate to="/dashboard" replace /> : <Login />}
        />
        <Route
          path="/home"
          element={
            <PrivateRoute>
              <Home />
            </PrivateRoute>
          }
        />
        <Route
          path="/data"
          element={
            <PrivateRoute>
              <DataPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/visualize"
          element={
            <PrivateRoute>
              <VisualizePage />
            </PrivateRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="/dynamic-data"
          element={
            <PrivateRoute>
              <DynamicDataPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/dynamic-dashboard"
          element={
            <PrivateRoute>
              <DynamicDashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="/dynamic-visualize/:id?"
          element={
            <PrivateRoute>
              <DynamicVisualizePage />
            </PrivateRoute>
          }
        />
        <Route
          path="/presentation"
          element={
            <PrivateRoute>
              <PresentationMode />
            </PrivateRoute>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
