import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  HardHat,
  KeyRound,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { useWorkerAuth } from "@/context/WorkerAuth";
import { apiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function WorkerLogin() {
  const navigate = useNavigate();
  const { worker, loading: authLoading, login } = useWorkerAuth();
  const [loading, setLoading] = useState(false);

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!authLoading && worker) navigate("/worker");
  }, [worker, authLoading, navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!loginId.trim() || !password) {
      toast.error("Please enter your Worker ID and password / Worker ID और पासवर्ड दर्ज करें");
      return;
    }

    setLoading(true);
    try {
      await login(loginId.trim(), password);
      toast.success("Signed in / सफलतापूर्वक लॉगिन हुआ");
      navigate("/worker");
    } catch (error) {
      const msg = apiError(error);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f7f2] flex flex-col">
      {/* Back button */}
      <header className="p-4 sm:p-6">
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Home / मुख्य पृष्ठ
        </button>
      </header>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md bg-white border border-stone-200 rounded-3xl shadow-xl p-8 sm:p-10">
          {/* Icon & heading */}
          <div className="flex items-center gap-3 mb-8">
            <div className="h-14 w-14 rounded-2xl bg-amber-400 flex items-center justify-center shadow-md">
              <HardHat className="h-7 w-7 text-amber-950" />
            </div>
            <div>
              <span className="text-[11px] font-bold text-teal-800 uppercase tracking-widest block">
                कर्मचारी पोर्टल / Worker Portal
              </span>
              <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">
                Worker Sign In
              </h1>
            </div>
          </div>

          <p className="text-sm text-slate-500 mb-7 leading-relaxed">
            अपना Worker ID और पासवर्ड डालें जो आपके मालिक ने दिया है।
            <br />
            <span className="text-[12px] text-slate-400">
              Enter the Worker ID and password provided by your employer.
            </span>
          </p>

          <form onSubmit={handleLogin} className="space-y-5" data-testid="worker-login-form">
            <div>
              <Label className="text-xs font-bold text-slate-700">
                Worker ID / वर्कर आईडी
              </Label>
              <div className="relative mt-1.5">
                <KeyRound className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                <Input
                  data-testid="worker-loginid-input"
                  type="text"
                  required
                  placeholder="e.g. WF-123456"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  className="pl-10 h-11 rounded-xl text-sm font-mono tracking-wide"
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold text-slate-700">
                Password / पासवर्ड
              </Label>
              <div className="relative mt-1.5">
                <Input
                  data-testid="worker-password-input"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10 h-11 rounded-xl text-sm font-mono"
                  autoComplete="current-password"
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

            <Button
              type="submit"
              data-testid="worker-login-submit"
              disabled={loading || authLoading}
              className="w-full bg-teal-800 hover:bg-teal-900 text-white font-bold h-11 rounded-xl shadow-md text-sm"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Sign In / लॉगिन करें
            </Button>
          </form>

          <p className="text-xs text-center text-slate-400 mt-7 leading-relaxed">
            अगर आपके पास Worker ID नहीं है, तो अपने मालिक से संपर्क करें।
            <br />
            Contact your employer if you don't have a Worker ID yet.
          </p>
        </div>
      </div>
    </div>
  );
}
