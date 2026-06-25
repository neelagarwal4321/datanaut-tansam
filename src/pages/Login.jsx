import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../providers/AuthContext.jsx";
import { DEMO_MODE } from "../firebase.js";

export default function Login() {
  const { login, signup, loginWithGoogle, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [authError, setAuthError] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(DEMO_MODE);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    // Check if we're in demo mode
    setIsDemoMode(DEMO_MODE);
  }, []);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting }
  } = useForm({
    defaultValues: {
      email: "",
      password: ""
    }
  });

  const onSubmit = async (values) => {
    setAuthError("");
    setStatusMessage("");
    try {
      if (isRegister) {
        await signup(values.email, values.password);
        try {
          await logout();
        } catch (logoutError) {
          console.warn("Logout after signup failed:", logoutError);
        }
        setIsRegister(false);
        reset({ email: values.email, password: "" });
        setStatusMessage("Account created successfully. Please sign in with your new credentials.");
        return;
      } else {
        await login(values.email, values.password);
      }
      const redirect = location.state?.from?.pathname || "/home";
      navigate(redirect, { replace: true });
    } catch (error) {
      setAuthError(error?.message || "Authentication failed");
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError("");
    setStatusMessage("");
    try {
      await loginWithGoogle();
      const redirect = location.state?.from?.pathname || "/home";
      navigate(redirect, { replace: true });
    } catch (error) {
      setAuthError(error?.message || "Google sign-in failed");
    }
  };

  return (
    <div className="flex w-full min-h-screen items-center justify-center p-4 bg-slate-950 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.15),transparent_60%),radial-gradient(circle_at_bottom,_rgba(99,102,241,0.15),transparent_65%)]" />
      
      <div className="relative z-10 flex w-full max-w-md flex-col gap-6 rounded-3xl border border-white/10 bg-slate-900/80 p-8 shadow-2xl backdrop-blur-xl transition-all duration-300">
        <div className="space-y-2.5 text-center">
          <div className="inline-flex items-center rounded-full bg-brand-500/15 px-3.5 py-1 text-xs font-semibold text-brand-300">
            {isDemoMode ? "Demo Mode - No Firebase required" : "Secure System Authentication"}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {isRegister ? "Create account" : "Welcome back"}
          </h1>
          <p className="text-sm text-slate-400">
            {isDemoMode ? (
              isRegister 
                ? "Create a demo credentials set to explore the live dashboard features."
                : "Sign in with any email and password or use Google to explore local states."
            ) : (
              isRegister
                ? "Set up your credentials or use Google Auth to register."
                : "Sign in to access saved dashboards and connect direct stream protocols."
            )}
          </p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Email Address
            <input
              type="email"
              placeholder="you@example.com"
              className="m3-input bg-slate-950/60 border-slate-700/60 text-slate-100 placeholder-slate-500 focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.2)] rounded-xl py-3"
              {...register("email", {
                required: "Email is required.",
                pattern: { value: /\S+@\S+\.\S+/, message: "Enter a valid email address." }
              })}
            />
            {errors.email ? (
              <span className="text-xs text-red-400 font-medium mt-1">{errors.email.message}</span>
            ) : (
              <span className="text-[10px] text-slate-500 font-normal normal-case">We'll remember this session configuration.</span>
            )}
          </label>

          <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Password
            <input
              type="password"
              placeholder="••••••••"
              className="m3-input bg-slate-950/60 border-slate-700/60 text-slate-100 placeholder-slate-500 focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.2)] rounded-xl py-3"
              {...register("password", {
                required: "Password is required.",
                minLength: { value: 6, message: "Password must be at least 6 characters." }
              })}
            />
            {errors.password ? (
              <span className="text-xs text-red-400 font-medium mt-1">{errors.password.message}</span>
            ) : (
              <span className="text-[10px] text-slate-500 font-normal normal-case">Choose a secure password.</span>
            )}
          </label>

          {authError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-medium text-red-300">
              {authError}
            </div>
          ) : null}

          {statusMessage ? (
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-xs font-medium text-green-300">
              {statusMessage}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 hover:bg-brand-500 transition-colors disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
          >
            {isSubmitting ? (
              <>
                <span className="h-2 w-2 animate-ping rounded-full bg-white" />
                {isRegister ? "Creating account..." : "Signing in..."}
              </>
            ) : isRegister ? (
              "Create account"
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="h-px flex-1 bg-slate-800" />
          <span>or continue with</span>
          <span className="h-px flex-1 bg-slate-800" />
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          className="inline-flex items-center justify-center gap-2.5 rounded-xl border border-slate-700 bg-slate-800/50 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 48 48"
            className="h-5 w-5"
          >
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.68 1.22 9.16 3.6l6.87-6.87C35.66 2.65 30.2 0 24 0 14.7 0 6.59 5.38 2.56 13.22l7.99 6.2C12.65 13.22 17.86 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.5 24.5c0-1.65-.16-3.24-.46-4.79H24v9.06h12.7c-.55 2.83-2.23 5.24-4.75 6.88l7.45 5.78C43.4 37.89 46.5 31.68 46.5 24.5z"
            />
            <path
              fill="#FBBC05"
              d="M10.55 28.27c-.48-1.43-.75-2.96-.75-4.52s.27-3.09.75-4.52l-7.99-6.2C.84 17.18 0 20.5 0 23.75 0 27 0.84 30.32 2.56 33.22l7.99-6.2z"
            />
            <path
              fill="#34A853"
              d="M24 47.5c6.2 0 11.43-2.04 15.24-5.54l-7.45-5.78c-2.07 1.38-4.71 2.19-7.79 2.19-6.14 0-11.35-3.72-13.45-9.02l-7.99 6.2C6.59 42.62 14.7 47.5 24 47.5z"
            />
          </svg>
          Google
        </button>

        <div className="flex items-center justify-center">
          <button
            onClick={() => setIsRegister((s) => !s)}
            className="text-sm font-medium text-brand-400 hover:underline"
            type="button"
          >
            {isRegister ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
          </button>
        </div>
      </div>
    </div>
  );
}
