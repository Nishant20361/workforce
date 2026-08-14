import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useAdminAuth } from "@/context/AdminAuth";
import { apiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { resetPassword } = useAdminAuth();

  const token = searchParams.get("token") || "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [tokenError, setTokenError] = useState(!token);

  useEffect(() => {
    if (!token) setTokenError(true);
  }, [token]);

  const handleReset = async (e) => {
    e.preventDefault();

    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match / पासवर्ड मेल नहीं खा रहे हैं");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, newPassword);
      setSuccess(true);
      toast.success("Password reset successful!");
    } catch (error) {
      const msg = apiError(error);
      if (msg.toLowerCase().includes("expired") || msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("used")) {
        setTokenError(true);
      }
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f7f2] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-stone-200 rounded-3xl shadow-xl p-8 sm:p-10">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-8">
          <div className="h-12 w-12 rounded-2xl bg-[#102f2c] flex items-center justify-center shadow-md">
            <ShieldCheck className="h-6 w-6 text-amber-300" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-teal-800 uppercase tracking-widest block">
              Admin Portal / मालिक पोर्टल
            </span>
            <h1 className="font-display text-2xl font-extrabold text-slate-900">
              Reset Password
            </h1>
          </div>
        </div>

        {/* Invalid / Expired Token State */}
        {tokenError && (
          <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-rose-600" />
              <div>
                <p className="font-bold text-sm">Invalid or Expired Link / लिंक अमान्य या एक्सपायर</p>
                <p className="text-xs text-rose-800 mt-1">
                  This password reset link is invalid, has already been used, or has expired (30 minutes).
                  Please request a new link.
                </p>
                <Button
                  onClick={() => navigate("/admin/login")}
                  className="mt-4 bg-rose-700 hover:bg-rose-800 text-white rounded-xl text-xs font-bold"
                >
                  Back to Login / लॉगिन पर वापस जाएं
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Success State */}
        {!tokenError && success && (
          <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-emerald-600" />
              <div>
                <p className="font-bold text-sm">Password Reset Successful! / पासवर्ड बदल गया!</p>
                <p className="text-xs text-emerald-800 mt-1">
                  Your password has been reset. You can now sign in with your new password.
                </p>
                <Button
                  onClick={() => navigate("/admin/login")}
                  className="mt-4 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold"
                >
                  Go to Sign In / लॉगिन पर जाएं
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Reset Form */}
        {!tokenError && !success && (
          <form onSubmit={handleReset} className="space-y-5" data-testid="reset-password-form">
            <p className="text-sm text-slate-500">
              Enter your new password below. Use a strong password with at least 8 characters.
            </p>

            <div>
              <Label className="text-xs font-bold text-slate-700">
                New Password / नया पासवर्ड
              </Label>
              <div className="relative mt-1.5">
                <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                <Input
                  data-testid="reset-new-password-input"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Min 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pl-10 pr-10 h-11 rounded-xl text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold text-slate-700">
                Confirm Password / पासवर्ड दोबारा दर्ज करें
              </Label>
              <div className="relative mt-1.5">
                <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                <Input
                  data-testid="reset-confirm-password-input"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10 h-11 rounded-xl text-sm font-mono"
                />
              </div>
            </div>

            <Button
              type="submit"
              data-testid="reset-password-submit"
              disabled={loading}
              className="w-full bg-teal-800 hover:bg-teal-900 text-white font-bold h-11 rounded-xl shadow-md text-sm"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Set New Password / नया पासवर्ड सेट करें
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
