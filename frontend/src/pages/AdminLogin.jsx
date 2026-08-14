import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  ShieldCheck,
  Building2,
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  KeyRound,
  CheckCircle2,
  X,
} from "lucide-react";
import { useAdminAuth } from "@/context/AdminAuth";
import { apiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminLogin() {
  const navigate = useNavigate();
  const { admin, login, signup, forgotPassword } = useAdminAuth();

  const [tab, setTab] = useState("login"); // "login" | "signup"
  const [loading, setLoading] = useState(false);

  // Login form state
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Signup form state
  const [signupForm, setSignupForm] = useState({
    name: "",
    business_name: "",
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  // Forgot password modal
  const [forgotModalOpen, setForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);

  useEffect(() => {
    if (admin) {
      navigate("/admin");
    }
  }, [admin, navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!loginIdentifier.trim() || !loginPassword) {
      toast.error("Please enter both username/email and password");
      return;
    }

    setLoading(true);
    try {
      await login(loginIdentifier.trim(), loginPassword);
      toast.success("Signed in successfully / स्वागत है!");
      navigate("/admin");
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    const { name, business_name, username, email, password, confirmPassword } = signupForm;

    if (!name.trim() || !business_name.trim() || !username.trim() || !email.trim() || !password) {
      toast.error("Please fill in all required fields / सभी विवरण भरें");
      return;
    }

    if (username.trim().length < 3) {
      toast.error("Username must be at least 3 characters / यूज़रनेम कम से कम 3 अक्षरों का होना चाहिए");
      return;
    }

    if (password.length < 8) {
      toast.error("Password must be at least 8 characters / पासवर्ड कम से कम 8 अक्षरों का होना चाहिए");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match / दोनों पासवर्ड मेल नहीं खा रहे हैं");
      return;
    }

    setLoading(true);
    try {
      await signup({
        name: name.trim(),
        business_name: business_name.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        password,
      });
      toast.success("Account created successfully / आपका खाता तैयार है!");
      navigate("/admin");
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      toast.error("Please enter your email address / कृपया अपना ईमेल दर्ज करें");
      return;
    }

    setForgotLoading(true);
    try {
      await forgotPassword(forgotEmail.trim().toLowerCase());
      setForgotSuccess(true);
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f7f2] flex flex-col">
      {/* Top Header */}
      <header className="p-4 sm:p-6 flex items-center justify-between">
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Home / मुख्य पृष्ठ
        </button>
      </header>

      {/* Main Form Container */}
      <div className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className={`w-full bg-white border border-stone-200 rounded-3xl shadow-xl p-6 sm:p-10 transition-[max-width] ${tab === "signup" ? "max-w-2xl" : "max-w-lg"}`}>
          {/* Brand Icon & Heading */}
          <div className="flex items-center gap-3 mb-6">
            <div className="h-12 w-12 rounded-2xl bg-[#102f2c] flex items-center justify-center shadow-md">
              <ShieldCheck className="h-6 w-6 text-amber-300" />
            </div>
            <div>
              <span className="text-[11px] font-bold text-teal-800 uppercase tracking-widest block">
                Owner & Admin Portal / मालिक पोर्टल
              </span>
              <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">
                {tab === "login" ? "Admin Sign In" : "Create Admin Account"}
              </h1>
            </div>
          </div>

          {/* Tab Switcher */}
          <div className="flex p-1 bg-stone-100 rounded-2xl mb-8">
            <button
              type="button"
              data-testid="tab-login"
              onClick={() => setTab("login")}
              className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                tab === "login"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Sign In / लॉगिन
            </button>
            <button
              type="button"
              data-testid="tab-signup"
              onClick={() => setTab("signup")}
              className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                tab === "signup"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Sign Up / नया खाता
            </button>
          </div>

          {/* 1. SIGN IN FORM */}
          {tab === "login" && (
            <form onSubmit={handleLogin} className="space-y-4" data-testid="admin-login-form">
              <div>
                <Label className="text-xs font-bold text-slate-700">
                  Username or Email / यूज़रनेम या ईमेल
                </Label>
                <div className="relative mt-1.5">
                  <User className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    data-testid="login-identifier-input"
                    type="text"
                    required
                    placeholder="e.g. nishant or owner@example.com"
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    className="pl-10 h-11 rounded-xl text-sm"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-slate-700">Password / पासवर्ड</Label>
                  <button
                    type="button"
                    data-testid="forgot-password-link"
                    onClick={() => {
                      setForgotEmail(loginIdentifier.includes("@") ? loginIdentifier : "");
                      setForgotSuccess(false);
                      setForgotModalOpen(true);
                    }}
                    className="text-xs font-bold text-teal-800 hover:text-teal-900 underline"
                  >
                    Forgot? / भूल गए?
                  </button>
                </div>
                <div className="relative mt-1.5">
                  <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    data-testid="login-password-input"
                    type={showLoginPassword ? "text" : "password"}
                    required
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="pl-10 pr-10 h-11 rounded-xl text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                  >
                    {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                data-testid="admin-login-submit"
                disabled={loading}
                className="w-full bg-teal-800 hover:bg-teal-900 text-white font-bold h-11 rounded-xl shadow-md text-sm mt-6"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Sign In to Workspace / कार्यक्षेत्र में प्रवेश करें
              </Button>
            </form>
          )}

          {/* 2. SIGN UP FORM */}
          {tab === "signup" && (
            <form onSubmit={handleSignup} className="space-y-5" data-testid="admin-signup-form">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-bold text-slate-700">Full Name / आपका नाम</Label>
                  <div className="relative min-w-0">
                    <User className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      data-testid="signup-name-input"
                      type="text"
                      required
                      placeholder="e.g. Ramesh Sharma"
                      value={signupForm.name}
                      onChange={(e) => setSignupForm({ ...signupForm, name: e.target.value })}
                      className="w-full min-w-0 pl-10 h-11 rounded-xl text-sm"
                    />
                  </div>
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-bold text-slate-700">Business / दुकान या फर्म</Label>
                  <div className="relative min-w-0">
                    <Building2 className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      data-testid="signup-biz-input"
                      type="text"
                      required
                      placeholder="e.g. Sharma Construction"
                      value={signupForm.business_name}
                      onChange={(e) => setSignupForm({ ...signupForm, business_name: e.target.value })}
                      className="w-full min-w-0 pl-10 h-11 rounded-xl text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-bold text-slate-700">Username / यूज़रनेम</Label>
                  <div className="relative min-w-0">
                    <Input
                      data-testid="signup-username-input"
                      type="text"
                      required
                      placeholder="e.g. ramesh_owner"
                      value={signupForm.username}
                      onChange={(e) => setSignupForm({ ...signupForm, username: e.target.value })}
                      className="w-full min-w-0 h-11 rounded-xl text-sm lowercase"
                    />
                  </div>
                  <span className="text-[10px] leading-4 text-slate-400 block">3-50 letters, numbers, _, -</span>
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-bold text-slate-700">Email / ईमेल</Label>
                  <div className="relative min-w-0">
                    <Mail className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      data-testid="signup-email-input"
                      type="email"
                      required
                      placeholder="owner@example.com"
                      value={signupForm.email}
                      onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })}
                      className="w-full min-w-0 pl-10 h-11 rounded-xl text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-bold text-slate-700">Password / पासवर्ड</Label>
                  <div className="relative min-w-0">
                    <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      data-testid="signup-password-input"
                      type={showSignupPassword ? "text" : "password"}
                      required
                      placeholder="Min 8 chars"
                      value={signupForm.password}
                      onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })}
                      className="w-full min-w-0 pl-10 pr-12 h-11 rounded-xl text-sm font-mono"
                    />
                    <button
                      type="button"
                      aria-label={showSignupPassword ? "Hide signup passwords" : "Show signup passwords"}
                      onClick={() => setShowSignupPassword(!showSignupPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600"
                    >
                      {showSignupPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-bold text-slate-700">Confirm Password / दोबारा दर्ज करें</Label>
                  <div className="relative min-w-0">
                    <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      data-testid="signup-confirmpassword-input"
                      type={showSignupPassword ? "text" : "password"}
                      required
                      placeholder="••••••••"
                      value={signupForm.confirmPassword}
                      onChange={(e) => setSignupForm({ ...signupForm, confirmPassword: e.target.value })}
                      className="w-full min-w-0 pl-10 pr-4 h-11 rounded-xl text-sm font-mono"
                    />
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                data-testid="admin-signup-submit"
                disabled={loading}
                className="w-full bg-teal-800 hover:bg-teal-900 text-white font-bold h-11 rounded-xl shadow-md text-sm mt-6"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create Account & Workspace / खाता और कार्यक्षेत्र बनाएं
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* Forgot Password Modal */}
      {forgotModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full min-w-0 max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto bg-white rounded-3xl shadow-2xl p-6 sm:p-8 relative">
            <button
              onClick={() => setForgotModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="h-12 w-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mb-4">
              <KeyRound className="h-6 w-6" />
            </div>

            <h2 className="font-display text-xl font-bold text-slate-900">
              Forgot Password / पासवर्ड रीसेट
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Enter your registered email address. We will send you a secure password reset link.
            </p>

            {forgotSuccess ? (
              <div className="mt-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Email Sent / ईमेल भेजा गया</p>
                  <p className="text-xs text-emerald-800 mt-1">
                    If an account exists for <strong>{forgotEmail}</strong>, a reset link has been sent. Please check your inbox and spam folder.
                  </p>
                  <Button
                    onClick={() => setForgotModalOpen(false)}
                    className="mt-4 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold"
                  >
                    Close / बंद करें
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="mt-5 space-y-4">
                <div>
                  <Label className="text-xs font-bold text-slate-700">Registered Email / पंजीकृत ईमेल</Label>
                  <div className="relative mt-1.5 min-w-0">
                    <Mail className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      type="email"
                      required
                      placeholder="owner@example.com"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="w-full min-w-0 pl-10 h-11 rounded-xl text-sm"
                    />
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setForgotModalOpen(false)}
                    className="rounded-xl text-xs"
                  >
                    Cancel / रद्द करें
                  </Button>
                  <Button
                    type="submit"
                    disabled={forgotLoading}
                    className="bg-teal-800 hover:bg-teal-900 text-white rounded-xl text-xs font-bold"
                  >
                    {forgotLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                    Send Reset Link / लिंक भेजें
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
