import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { adminApi, apiError, money } from "@/lib/api";
import { useAdminAuth } from "@/context/AdminAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import WorkerViewModal from "@/components/workerview/WorkerViewModal";
import AudioPlayer from "@/components/chat/AudioPlayer";
import VoiceRecorder from "@/components/chat/VoiceRecorder";
import SpeechTyping from "@/components/chat/SpeechTyping";
import { enablePushNotifications, pushSupported, updateAppBadge } from "@/lib/notifications";
import {
  HardHat, LayoutDashboard, Users, CalendarCheck, Wallet, Sparkles, LogOut,
  Plus, Pencil, Trash2, Loader2, Menu, X, Search, ArrowUpRight, UserPlus,
  MessageSquare, Eye, Send, Mic, Building2, CheckCircle2, ChevronRight,
  KeyRound, RefreshCw, Copy, Power
} from "lucide-react";

const WORK_TYPES = ["Driver", "Helper", "Labour", "Technician", "Supervisor", "Electrician", "Plumber", "Other"];
const todayDateStr = () => new Date().toISOString().slice(0, 10);

const NAV = [
  { key: "overview", label: "Overview / विवरण", icon: LayoutDashboard },
  { key: "workers", label: "Workers / कर्मचारी", icon: Users },
  { key: "attendance", label: "Attendance / हाज़िरी", icon: CalendarCheck },
  { key: "payments", label: "Payments / वेतन व पेशगी", icon: Wallet },
  { key: "extra", label: "Extra Work / अतिरिक्त काम", icon: Sparkles },
  { key: "messages", label: "Messages / संदेश", icon: MessageSquare },
];

const attStyle = {
  Present: "bg-emerald-50 text-emerald-700 border-emerald-300 font-bold",
  Absent: "bg-rose-50 text-rose-700 border-rose-300 font-bold",
  "Half Day": "bg-amber-50 text-amber-800 border-amber-300 font-bold",
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { admin, loading, logout, setAdmin } = useAdminAuth();
  const [view, setView] = useState(() => new URLSearchParams(window.location.search).has("conversation") ? "messages" : "overview");
  const [workers, setWorkers] = useState([]);
  const [sidebar, setSidebar] = useState(false);
  const [bizEditOpen, setBizEditOpen] = useState(false);
  const [bizName, setBizName] = useState("");
  const [bizSaving, setBizSaving] = useState(false);
  const [activeWorkerForView, setActiveWorkerForView] = useState(null);
  const [unreadMessages, setUnreadMessages] = useState(0);

  const loadWorkers = useCallback(async () => {
    try {
      const res = await adminApi.get("/workers");
      setWorkers(res.data);
    } catch (e) {
      toast.error(apiError(e));
    }
  }, []);

  const loadUnreadMessages = useCallback(async () => {
    try {
      const { data } = await adminApi.get("/chat/conversations");
      const count = data.reduce((total, conversation) => total + (conversation.unread_count || 0), 0);
      setUnreadMessages(count);
      updateAppBadge(count);
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (!loading && !admin) navigate("/admin/login");
    if (admin) {
      loadWorkers();
      loadUnreadMessages();
      setBizName(admin.business_name || admin.business?.name || "My Business");
    }
  }, [admin, loading, navigate, loadWorkers, loadUnreadMessages]);

  useEffect(() => {
    if (!admin) return undefined;
    const interval = setInterval(loadUnreadMessages, 10000);
    return () => clearInterval(interval);
  }, [admin, loadUnreadMessages]);

  const doLogout = async () => {
    await logout();
    navigate("/admin/login");
  };

  const handleUpdateBusinessName = async () => {
    if (!bizName.trim()) return;
    setBizSaving(true);
    try {
      const res = await adminApi.put("/admin/business", { name: bizName });
      setAdmin((prev) => ({
        ...prev,
        business_name: res.data.name,
        business: res.data,
      }));
      toast.success("Business name updated / नाम बदल दिया गया");
      setBizEditOpen(false);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBizSaving(false);
    }
  };

  if (loading || !admin) {
    return (
      <div className="min-h-screen bg-[#f8f7f2] flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-teal-800" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f7f2] flex">
      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 z-30 h-screen w-72 bg-[#102f2c] text-white flex flex-col transition-transform ${
          sidebar ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="p-5 flex items-center justify-between border-b border-teal-900/60">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-md">
              <HardHat className="h-5 w-5" />
            </div>
            <div>
              <span className="font-display font-extrabold text-lg text-white block leading-none">WorkForce</span>
              <span className="text-[10px] text-teal-300 font-bold uppercase tracking-wider">Owner Portal</span>
            </div>
          </div>
          <button className="lg:hidden p-1 text-teal-200" onClick={() => setSidebar(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Business Workspace Box */}
        <div className="p-3 mx-3 my-3 bg-white/5 border border-white/10 rounded-2xl">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] text-teal-300 font-bold uppercase tracking-wider block">दुकान / कंपनी</span>
              <p className="font-display font-bold text-sm text-white truncate">
                {admin.business_name || admin.business?.name || "My Business"}
              </p>
            </div>
            <button
              onClick={() => setBizEditOpen(true)}
              title="Edit Business Name"
              className="p-1.5 rounded-lg text-teal-200 hover:text-white hover:bg-white/10"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Navigation items */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map((n) => (
            <button
              key={n.key}
              data-testid={`nav-${n.key}`}
              onClick={() => {
                setView(n.key);
                setSidebar(false);
              }}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-semibold transition-all ${
                view === n.key
                  ? "bg-amber-400 text-slate-950 shadow-md"
                  : "text-teal-100 hover:bg-white/10 hover:text-white"
              }`}
            >
              <n.icon className={`h-4 w-4 shrink-0 ${view === n.key ? "text-slate-950" : "text-teal-300"}`} />
              <span className="truncate">{n.label}</span>
              {n.key === "messages" && unreadMessages > 0 && <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] flex items-center justify-center">{unreadMessages}</span>}
            </button>
          ))}
        </nav>

        {/* Admin Footer */}
        <div className="p-4 border-t border-teal-900/60 bg-teal-950/40">
          <div className="flex items-center gap-3 mb-2">
            {admin.picture ? (
              <img src={admin.picture} alt="" className="h-8 w-8 rounded-full border border-teal-600" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-teal-700 text-teal-100 flex items-center justify-center font-bold text-xs">
                {admin.name?.[0] || "A"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate">{admin.name || "Owner"}</p>
              <p className="text-[11px] text-teal-300 truncate">{admin.email}</p>
            </div>
          </div>
          <Button
            data-testid="admin-logout-btn"
            variant="ghost"
            onClick={doLogout}
            className="w-full justify-start text-xs text-rose-300 hover:text-rose-100 hover:bg-rose-950/30 h-8 px-2 rounded-lg"
          >
            <LogOut className="h-3.5 w-3.5 mr-2" /> Logout / लॉगआउट
          </Button>
        </div>
      </aside>

      {sidebar && <div className="fixed inset-0 bg-black/40 z-20 lg:hidden" onClick={() => setSidebar(false)} />}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden bg-white border-b border-stone-200 p-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
          <button data-testid="open-sidebar-btn" onClick={() => setSidebar(true)} className="p-1">
            <Menu className="h-6 w-6 text-slate-800" />
          </button>
          <span className="font-display font-bold text-slate-900">WorkForce</span>
          <span className="text-xs font-semibold text-teal-800 truncate max-w-[120px]">
            {admin.business_name || "Workspace"}
          </span>
        </header>

        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          {view === "overview" && <OverviewSection workers={workers} onNavigate={setView} />}
          {view === "workers" && (
            <WorkersSection
              workers={workers}
              reload={loadWorkers}
              onOpenWorkerView={(wid) => setActiveWorkerForView(wid)}
            />
          )}
          {view === "attendance" && <AttendanceSection workers={workers} />}
          {view === "payments" && <PaymentsSection workers={workers} />}
          {view === "extra" && <ExtraSection workers={workers} />}
          {view === "messages" && <MessagesSection workers={workers} onUnreadChange={loadUnreadMessages} />}
        </main>
      </div>

      {/* Edit Business Name Dialog */}
      <Dialog open={bizEditOpen} onOpenChange={setBizEditOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display">Business Name / दुकान या कंपनी का नाम</DialogTitle>
          </DialogHeader>
          <div className="py-3">
            <Label htmlFor="biz-name-input" className="text-xs text-slate-600">
              Workspace or Business Name
            </Label>
            <Input
              id="biz-name-input"
              value={bizName}
              onChange={(e) => setBizName(e.target.value)}
              placeholder="e.g. Sharma Constructions"
              className="mt-1.5"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBizEditOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateBusinessName} disabled={bizSaving} className="bg-teal-800 hover:bg-teal-900">
              {bizSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Name"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Read-Only Worker View Modal */}
      {activeWorkerForView && (
        <WorkerViewModal
          workerId={activeWorkerForView}
          open={!!activeWorkerForView}
          onClose={() => setActiveWorkerForView(null)}
        />
      )}
    </div>
  );
}

/* ---------------- 1. Overview Section ---------------- */
function OverviewSection({ workers, onNavigate }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    adminApi.get("/admin/stats").then((r) => setStats(r.data)).catch(() => {});
  }, [workers]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-7">
        <div>
          <p className="text-xs font-bold text-teal-800 uppercase tracking-[.16em]">
            Operations Center / आज का हिसाब
          </p>
          <h1 className="font-display text-3xl font-extrabold text-slate-950 mt-1">
            Today at a glance
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Live attendance, daily earned salary, advances, and payouts.
          </p>
        </div>
        <Button
          data-testid="overview-mark-attendance"
          onClick={() => onNavigate("attendance")}
          className="bg-teal-800 hover:bg-teal-900 rounded-xl font-bold shadow-md"
        >
          <CalendarCheck className="h-4 w-4 mr-2" /> Mark Attendance / हाज़िरी लगाएं
        </Button>
      </div>

      {!stats ? (
        <div className="py-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-teal-800" />
        </div>
      ) : (
        <>
          {/* Daily Attendance Count Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-sm">
              <p className="text-xs sm:text-sm text-slate-500 font-medium">Total Workers / कुल</p>
              <p className="font-display text-2xl sm:text-3xl font-bold mt-1 text-slate-900">
                {stats.total_workers}
              </p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 sm:p-5 shadow-sm">
              <p className="text-xs sm:text-sm text-emerald-800 font-medium">Present / हाज़िर</p>
              <p className="font-display text-2xl sm:text-3xl font-bold mt-1 text-emerald-700">
                {stats.present_today}
              </p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-5 shadow-sm">
              <p className="text-xs sm:text-sm text-amber-800 font-medium">Half Day / आधा दिन</p>
              <p className="font-display text-2xl sm:text-3xl font-bold mt-1 text-amber-700">
                {stats.half_day_today}
              </p>
            </div>
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 sm:p-5 shadow-sm">
              <p className="text-xs sm:text-sm text-rose-800 font-medium">Absent / गैरहाज़िर</p>
              <p className="font-display text-2xl sm:text-3xl font-bold mt-1 text-rose-700">
                {stats.absent_today}
              </p>
            </div>
          </div>

          {/* Monthly Payroll & Financial Summary Cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <p className="text-xs text-slate-500 font-medium">इस महीने की कमाई / Earned</p>
              <p className="font-display text-2xl font-bold mt-1 text-teal-800">
                {money(stats.gross_earned_month)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">हाज़िरी + अतिरिक्त काम</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <p className="text-xs text-slate-500 font-medium">वेतन भुगतान / Paid</p>
              <p className="font-display text-2xl font-bold mt-1 text-teal-600">
                {money(stats.paid_this_month)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">सैलरी पेमेंट</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <p className="text-xs text-slate-500 font-medium">पेशगी / Advances Taken</p>
              <p className="font-display text-2xl font-bold mt-1 text-amber-700">
                {money(stats.advances_this_month)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">अग्रिम राशि</p>
            </div>

            <div className="bg-[#102f2c] text-white rounded-2xl p-5 shadow-md">
              <p className="text-xs text-amber-300 font-bold uppercase tracking-wider">बाकी पैसा / Remaining</p>
              <p className="font-display text-2xl sm:text-3xl font-extrabold mt-1 text-amber-300">
                {money(stats.remaining_payable)}
              </p>
              <p className="text-[11px] text-teal-200 mt-1">कमाई - (वेतन + पेशगी)</p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid sm:grid-cols-3 gap-4 mt-6">
            <button
              data-testid="overview-add-worker"
              onClick={() => onNavigate("workers")}
              className="group bg-[#102f2c] text-white rounded-2xl p-5 text-left flex items-center justify-between shadow-sm hover:bg-[#153e3a] transition-all"
            >
              <span>
                <UserPlus className="h-5 w-5 text-amber-300 mb-3" />
                <strong className="font-display block text-base">Add Workers / कर्मचारी जोड़ें</strong>
                <small className="text-teal-200 text-xs">Manage team records</small>
              </span>
              <ArrowUpRight className="h-5 w-5 text-teal-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </button>

            <button
              data-testid="overview-record-payment"
              onClick={() => onNavigate("payments")}
              className="group bg-amber-200 text-slate-950 rounded-2xl p-5 text-left flex items-center justify-between shadow-sm hover:bg-amber-300 transition-all"
            >
              <span>
                <Wallet className="h-5 w-5 text-amber-900 mb-3" />
                <strong className="font-display block text-base">Payment & Advance / पेशगी दर्ज करें</strong>
                <small className="text-amber-950/70 text-xs">Record salary or advance</small>
              </span>
              <ArrowUpRight className="h-5 w-5 text-amber-900 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </button>

            <button
              data-testid="overview-open-messages"
              onClick={() => onNavigate("messages")}
              className="group bg-white border border-stone-300 text-slate-900 rounded-2xl p-5 text-left flex items-center justify-between shadow-sm hover:border-teal-700 transition-all"
            >
              <span>
                <MessageSquare className="h-5 w-5 text-teal-800 mb-3" />
                <strong className="font-display block text-base">Chat & Voice Notes / बातचीत</strong>
                <small className="text-slate-500 text-xs">Send audio or text to workers</small>
              </span>
              <ArrowUpRight className="h-5 w-5 text-teal-800 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- 2. Workers Section ---------------- */
const randomWorkerId = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  window.crypto.getRandomValues(bytes);
  return `WF-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
};
const randomWorkerPassword = () => {
  const bytes = new Uint32Array(1);
  window.crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
};
const newWorkerForm = () => ({
  name: "", mobile: "", work_type: "Labour", joining_date: todayDateStr(), salary: "", email: "",
  status: "ACTIVE", portal_enabled: true, login_id: randomWorkerId(), password: randomWorkerPassword(),
});

function WorkersSection({ workers, reload, onOpenWorkerView }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(newWorkerForm);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [delTarget, setDelTarget] = useState(null);
  const [query, setQuery] = useState("");
  const [credentials, setCredentials] = useState(null);
  const [resettingPassword, setResettingPassword] = useState(false);

  const visibleWorkers = workers.filter((w) =>
    [w.name, w.mobile, w.work_type, w.email, w.login_id].some((v) =>
      String(v || "").toLowerCase().includes(query.toLowerCase())
    )
  );

  const openNew = () => {
    setForm(newWorkerForm());
    setEditing(null);
    setResettingPassword(false);
    setOpen(true);
  };

  const openEdit = (w) => {
    setForm({
      ...w, salary: String(w.salary), email: w.email || "", status: w.status || "ACTIVE",
      portal_enabled: Boolean(w.portal_enabled), login_id: w.login_id || "", password: "",
    });
    setEditing(w.id);
    setResettingPassword(false);
    setOpen(true);
  };

  const save = async () => {
    if (!form.name) {
      toast.error("Worker name is required");
      return;
    }
    if (form.portal_enabled && (!form.login_id || (!editing && !form.password))) {
      toast.error("Worker ID and temporary password are required when login is enabled");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, salary: parseFloat(form.salary) || 0 };
      const response = editing
        ? await adminApi.put(`/workers/${editing}`, payload)
        : await adminApi.post("/workers", payload);
      toast.success(editing ? "Worker updated" : "Worker added successfully");
      setOpen(false);
      if (response.data.one_time_credentials) {
        setCredentials({ name: form.name, action: editing ? "updated" : "created", ...response.data.one_time_credentials });
      }
      reload();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const togglePortal = (enabled) => {
    if (enabled && !form.portal_enabled) {
      setForm({ ...form, portal_enabled: true, login_id: form.login_id || randomWorkerId(), password: randomWorkerPassword() });
      setResettingPassword(true);
    } else {
      setForm({ ...form, portal_enabled: enabled, password: "" });
      if (!enabled) setResettingPassword(false);
    }
  };

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed. Please select and copy manually.");
    }
  };

  const remove = async () => {
    try {
      await adminApi.delete(`/workers/${delTarget.id}`);
      toast.success("Worker deleted / कर्मचारी हटाया गया");
      setDelTarget(null);
      reload();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Workers / कर्मचारी सूची</h1>
          <p className="text-slate-500 text-sm">{workers.length} registered worker(s)</p>
        </div>
        <Button
          data-testid="add-worker-btn"
          onClick={openNew}
          className="bg-teal-800 hover:bg-teal-900 rounded-xl font-bold active:scale-95 transition-transform"
        >
          <Plus className="h-4 w-4 mr-1.5" /> Add Worker / नया कर्मचारी
        </Button>
      </div>

      <div className="relative max-w-md mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          data-testid="worker-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, mobile, role or email…"
          className="pl-10 bg-white rounded-xl"
        />
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-left min-w-[900px]" data-testid="workers-table">
          <thead>
            <tr className="bg-stone-50 text-slate-600 text-xs uppercase tracking-wider font-bold border-b border-stone-200">
              <th className="py-3.5 px-4">Name / नाम</th>
              <th className="py-3.5 px-4">Mobile</th>
              <th className="py-3.5 px-4">Role</th>
              <th className="py-3.5 px-4">Monthly Salary</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4">Portal Access</th>
              <th className="py-3.5 px-4">Worker ID</th>
              <th className="py-3.5 px-4 text-right">Actions / हिसाब</th>
            </tr>
          </thead>
          <tbody>
            {visibleWorkers.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400 text-sm">
                  {workers.length ? "No workers match your search." : "No workers added yet. Click 'Add Worker'."}
                </td>
              </tr>
            )}
            {visibleWorkers.map((w) => {
              return (
                <tr
                  key={w.id}
                  data-testid={`worker-row-${w.id}`}
                  className="border-t border-stone-100 hover:bg-stone-50/70 transition-colors"
                >
                  <td className="py-3.5 px-4 font-bold text-slate-900">{w.name}</td>
                  <td className="py-3.5 px-4 font-mono text-sm text-slate-600">{w.mobile}</td>
                  <td className="py-3.5 px-4">
                    <Badge variant="secondary" className="rounded-lg text-xs font-semibold">
                      {w.work_type}
                    </Badge>
                  </td>
                  <td className="py-3.5 px-4 text-slate-900 font-bold">{money(w.salary)}</td>
                  <td className="py-3.5 px-4">
                    <Badge className={w.status === "INACTIVE" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}>
                      {w.status === "INACTIVE" ? "Inactive" : "Active"}
                    </Badge>
                  </td>
                  <td className="py-3.5 px-4">
                    {w.portal_enabled ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Login Enabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                        No Login
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs font-bold text-slate-700">{w.login_id || "—"}</td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Worker View (Phone display mode) */}
                      <button
                        data-testid={`view-worker-account-${w.id}`}
                        onClick={() => onOpenWorkerView(w.id)}
                        className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-xl bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100 transition-colors"
                        title="Open read-only view for worker on owner phone"
                      >
                        <Eye className="h-3.5 w-3.5" /> हिसाब दिखाएं
                      </button>
                      <Button
                        data-testid={`edit-worker-${w.id}`}
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(w)}
                        className="h-8 w-8 text-slate-500 hover:text-slate-900 rounded-lg"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        data-testid={`delete-worker-${w.id}`}
                        variant="ghost"
                        size="icon"
                        onClick={() => setDelTarget(w)}
                        className="h-8 w-8 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Worker Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100%_-_1.5rem)] max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-stone-200">
            <DialogTitle className="font-display text-xl">
              {editing ? "Edit Worker / कर्मचारी का विवरण बदलें" : "Add Worker / नया कर्मचारी जोड़ें"}
            </DialogTitle>
            <p className="text-xs text-slate-500 mt-1">
              Email is optional. Workers without emails are fully managed here.
            </p>
          </DialogHeader>
          <div className="p-5 sm:p-6 space-y-6">
            <section className="space-y-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-teal-800">Worker Details / कर्मचारी विवरण</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">
              <div className="min-w-0">
                <Label className="text-xs font-semibold text-slate-700">Full Name / पूरा नाम</Label>
                <Input
                  data-testid="worker-name-input"
                  autoFocus
                  placeholder="e.g. Ramesh Kumar"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full min-w-0 rounded-xl"
                />
              </div>
              <div className="min-w-0">
                <Label className="text-xs font-semibold text-slate-700">Mobile Number / मोबाइल नंबर</Label>
                <Input
                  data-testid="worker-mobile-input"
                  type="tel"
                  placeholder="10-digit mobile"
                  value={form.mobile}
                  onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                  className="mt-1 w-full min-w-0 rounded-xl"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-slate-700">Work Type / काम का प्रकार</Label>
              <div data-testid="worker-type-select" className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1.5">
                {WORK_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    data-testid={`worker-type-${type.toLowerCase().replace(/\s/g, "-")}`}
                    onClick={() => setForm({ ...form, work_type: type })}
                    className={`min-h-10 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${
                      form.work_type === type
                        ? "bg-teal-800 border-teal-800 text-white shadow-sm"
                        : "bg-white border-stone-200 text-slate-700 hover:bg-stone-50"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">
              <div className="min-w-0">
                <Label className="text-xs font-semibold text-slate-700">Joining Date / तारीख</Label>
                <Input
                  data-testid="worker-joindate-input"
                  type="date"
                  value={form.joining_date}
                  onChange={(e) => setForm({ ...form, joining_date: e.target.value })}
                  className="mt-1 w-full min-w-0 rounded-xl"
                />
              </div>
              <div className="min-w-0">
                <Label className="text-xs font-semibold text-slate-700">Monthly Salary (₹) / मासिक वेतन</Label>
                <Input
                  data-testid="worker-salary-input"
                  type="number"
                  placeholder="e.g. 25000"
                  value={form.salary}
                  onChange={(e) => setForm({ ...form, salary: e.target.value })}
                  className="mt-1 w-full min-w-0 rounded-xl"
                />
              </div>
            </div>

            <div className="min-w-0">
              <Label className="text-xs font-semibold text-slate-700">
                Email Address (Optional / वैकल्पिक)
              </Label>
              <Input
                data-testid="worker-email-input"
                type="email"
                placeholder="worker@example.com (वैकल्पिक)"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="mt-1 w-full min-w-0 rounded-xl"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                वैकल्पिक — सूचनाओं और रिकॉर्ड के लिए उपयोगी।
              </p>
            </div>
            </section>

            <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4 space-y-3">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">Employment Status / काम की स्थिति</h3>
              <div className="grid grid-cols-2 gap-2">
                {["ACTIVE", "INACTIVE"].map((status) => (
                  <button key={status} type="button" onClick={() => setForm({ ...form, status })}
                    className={`min-h-10 rounded-xl border text-xs font-bold ${form.status === status ? "bg-teal-800 border-teal-800 text-white" : "bg-white border-stone-200 text-slate-700"}`}>
                    {status === "ACTIVE" ? "Active / सक्रिय" : "Inactive / निष्क्रिय"}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">Portal Login / लॉगिन सुविधा</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Worker ID और password से self-service portal access दें।</p>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer shrink-0">
                  <input data-testid="worker-portal-toggle" type="checkbox" checked={Boolean(form.portal_enabled)}
                    onChange={(e) => togglePortal(e.target.checked)} className="h-5 w-5 accent-teal-800" />
                  {form.portal_enabled ? "Enabled" : "Disabled"}
                </label>
              </div>

              {form.portal_enabled && (
                <div className="space-y-4">
                  <div className="min-w-0">
                    <Label className="text-xs font-semibold text-slate-700">Worker ID / कर्मचारी ID</Label>
                    <div className="flex flex-col sm:flex-row gap-2 mt-1">
                      <Input data-testid="worker-login-id-input" value={form.login_id || ""}
                        onChange={(e) => setForm({ ...form, login_id: e.target.value.toUpperCase() })}
                        className="w-full min-w-0 rounded-xl font-mono uppercase" placeholder="WF-XXXXXX" />
                      <Button type="button" variant="outline" onClick={() => setForm({ ...form, login_id: randomWorkerId() })}
                        className="rounded-xl shrink-0"><RefreshCw className="h-4 w-4 mr-1.5" /> Generate ID</Button>
                    </div>
                  </div>

                  {(!editing || resettingPassword) ? (
                    <div className="min-w-0">
                      <Label className="text-xs font-semibold text-slate-700">Temporary Password / अस्थायी पासवर्ड</Label>
                      <div className="flex flex-col sm:flex-row gap-2 mt-1">
                        <Input data-testid="worker-temp-password-input" value={form.password || ""}
                          onChange={(e) => setForm({ ...form, password: e.target.value })}
                          className="w-full min-w-0 rounded-xl font-mono tracking-widest" placeholder="6 or more characters" />
                        <Button type="button" variant="outline" onClick={() => setForm({ ...form, password: randomWorkerPassword() })}
                          className="rounded-xl shrink-0"><RefreshCw className="h-4 w-4 mr-1.5" /> Generate Password</Button>
                      </div>
                      <p className="text-[11px] text-amber-800 mt-1.5">यह password save होने के बाद दोबारा दिखाई नहीं देगा।</p>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white border border-amber-200 p-3">
                      <p className="text-xs text-slate-600">Current password is securely hidden.</p>
                      <Button type="button" variant="outline" onClick={() => { setResettingPassword(true); setForm({ ...form, password: randomWorkerPassword() }); }}
                        className="rounded-xl"><KeyRound className="h-4 w-4 mr-1.5" /> Reset Password / नया पासवर्ड</Button>
                    </div>
                  )}

                  {editing && (
                    <Button type="button" variant="outline" onClick={() => togglePortal(false)}
                      className="w-full rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50"><Power className="h-4 w-4 mr-1.5" /> Disable Login / लॉगिन बंद करें</Button>
                  )}
                </div>
              )}
            </section>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-stone-200 bg-stone-50 gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button data-testid="save-worker-btn" onClick={save} disabled={saving} className="bg-teal-800 hover:bg-teal-900">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save changes" : "Add worker"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time worker credentials */}
      <Dialog open={Boolean(credentials)} onOpenChange={(isOpen) => !isOpen && setCredentials(null)}>
        <DialogContent className="w-[calc(100%_-_1.5rem)] max-w-md rounded-3xl">
          <DialogHeader>
            <div className="h-12 w-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <DialogTitle>{credentials?.action === "updated" ? "Worker Login Updated Successfully" : "Worker Added Successfully"}</DialogTitle>
            <p className="text-sm font-bold text-slate-700">{credentials?.name}</p>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-2xl bg-stone-50 border border-stone-200 p-4">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Worker ID</span>
              <div className="flex items-center justify-between gap-3 mt-1">
                <code className="text-lg font-extrabold text-slate-900 break-all">{credentials?.login_id}</code>
                <Button type="button" size="sm" variant="outline" onClick={() => copyText(credentials?.login_id || "", "Worker ID")}><Copy className="h-4 w-4 mr-1" /> Copy ID</Button>
              </div>
            </div>
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Temporary Password</span>
              <div className="flex items-center justify-between gap-3 mt-1">
                <code className="text-lg font-extrabold text-slate-900 break-all">{credentials?.password}</code>
                <Button type="button" size="sm" variant="outline" onClick={() => copyText(credentials?.password || "", "Password")}><Copy className="h-4 w-4 mr-1" /> Copy Password</Button>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-rose-700 font-semibold">इन Details को Worker को दे दें। Password बाद में दोबारा दिखाई नहीं देगा।</p>
            <Button type="button" onClick={() => copyText(`WorkForce Login\n\nWorker ID: ${credentials?.login_id}\nPassword: ${credentials?.password}`, "Credentials")}
              className="w-full bg-teal-800 hover:bg-teal-900 rounded-xl"><Copy className="h-4 w-4 mr-1.5" /> Copy Both / Credentials कॉपी करें</Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCredentials(null)} className="w-full rounded-xl">Done / बंद करें</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {delTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes their attendance, payment, and extra-work records from your workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-delete-btn"
              onClick={remove}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Delete / हटाएं
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------------- 3. Attendance Section ---------------- */
function AttendanceSection({ workers }) {
  const [date, setDate] = useState(todayDateStr());
  const [records, setRecords] = useState({});
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await adminApi.get("/attendance", { params: { date } });
      const map = {};
      r.data.forEach((a) => {
        map[a.worker_id] = a.status;
      });
      setRecords(map);
    } catch (e) {
      toast.error(apiError(e));
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const mark = async (worker_id, status) => {
    const previous = records[worker_id];
    setRecords((p) => ({ ...p, [worker_id]: status }));
    try {
      await adminApi.post("/attendance", { worker_id, date, status });
      toast.success("Attendance updated / हाज़िरी दर्ज");
    } catch (e) {
      setRecords((p) => ({ ...p, [worker_id]: previous }));
      toast.error(apiError(e));
    }
  };

  const markEveryonePresent = async () => {
    if (!workers.length) return;
    setMarkingAll(true);
    try {
      await Promise.all(
        workers.map((w) => adminApi.post("/attendance", { worker_id: w.id, date, status: "Present" }))
      );
      setRecords(Object.fromEntries(workers.map((w) => [w.id, "Present"])));
      toast.success(`Marked all ${workers.length} workers present / सभी हाज़िर`);
    } catch (e) {
      toast.error(apiError(e));
      load();
    } finally {
      setMarkingAll(false);
    }
  };

  const setQuickDate = (type) => {
    if (type === "today") setDate(todayDateStr());
    else if (type === "yesterday") {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      setDate(d.toISOString().slice(0, 10));
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Attendance / हाज़िरी</h1>
          <p className="text-slate-500 text-sm">
            Mark attendance for today or any previous date. Attendance calculates daily earned salary.
          </p>
        </div>

        {/* Date Selector with Quick Buttons */}
        <div className="flex items-center gap-2 bg-white p-2 border border-stone-200 rounded-2xl shadow-sm">
          <button
            type="button"
            onClick={() => setQuickDate("today")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              date === todayDateStr() ? "bg-teal-800 text-white" : "bg-stone-100 text-slate-700 hover:bg-stone-200"
            }`}
          >
            आज (Today)
          </button>
          <button
            type="button"
            onClick={() => setQuickDate("yesterday")}
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-stone-100 text-slate-700 hover:bg-stone-200 transition-colors"
          >
            पिछला दिन (Yesterday)
          </button>
          <Input
            data-testid="attendance-date-input"
            type="date"
            max={todayDateStr()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-auto h-8 text-xs font-semibold rounded-xl"
          />
        </div>
      </div>

      {workers.length > 0 && (
        <div className="flex justify-end mb-4">
          <Button
            data-testid="mark-all-present-btn"
            variant="outline"
            onClick={markEveryonePresent}
            disabled={markingAll}
            className="bg-white border-teal-300 text-teal-900 hover:bg-teal-50 rounded-xl text-xs font-bold"
          >
            {markingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CalendarCheck className="h-3.5 w-3.5 mr-1.5 text-teal-800" />}
            Mark everyone present / सभी को हाज़िर करें
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {workers.length === 0 && <p className="text-slate-400 py-10 text-center">Add workers first.</p>}
        {workers.map((w) => {
          const currentStatus = records[w.id];
          return (
            <div
              key={w.id}
              data-testid={`attendance-row-${w.id}`}
              className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3"
            >
              <div>
                <p className="font-bold text-slate-900">{w.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-slate-500 font-medium">{w.work_type}</span>
                  <span className="text-[11px] text-slate-400">· ₹{w.salary}/माह</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {[
                  { key: "Present", label: "हाज़िर / Present" },
                  { key: "Half Day", label: "आधा दिन / Half" },
                  { key: "Absent", label: "गैरहाज़िर / Absent" },
                ].map(({ key: s, label }) => (
                  <button
                    key={s}
                    data-testid={`mark-${s.replace(/\s/g, "").toLowerCase()}-${w.id}`}
                    onClick={() => mark(w.id, s)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${
                      currentStatus === s
                        ? attStyle[s]
                        : "bg-white text-slate-600 border-stone-200 hover:bg-stone-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- 4. Payments & Advances Section ---------------- */
function PaymentsSection({ workers }) {
  const [payments, setPayments] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [form, setForm] = useState({
    worker_id: "",
    type: "SALARY_PAYMENT",
    amount: "",
    date: todayDateStr(),
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const [delTarget, setDelTarget] = useState(null);

  const load = useCallback(async () => {
    try {
      const p = await adminApi.get("/payments");
      setPayments(p.data);

      const s = {};
      await Promise.all(
        workers.map(async (w) => {
          try {
            s[w.id] = (await adminApi.get(`/workers/${w.id}/summary`)).data;
          } catch {}
        })
      );
      setSummaries(s);
    } catch (e) {
      toast.error(apiError(e));
    }
  }, [workers]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!form.worker_id || !form.amount) {
      toast.error("Please select a worker and enter an amount");
      return;
    }
    setSaving(true);
    try {
      await adminApi.post("/payments", {
        ...form,
        amount: parseFloat(form.amount),
      });
      toast.success(
        form.type === "ADVANCE" ? "Advance recorded / पेशगी दर्ज" : "Payment recorded / भुगतान दर्ज"
      );
      setForm({
        worker_id: "",
        type: "SALARY_PAYMENT",
        amount: "",
        date: todayDateStr(),
        note: "",
      });
      load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const removePayment = async () => {
    if (!delTarget) return;
    try {
      await adminApi.delete(`/payments/${delTarget.id}`);
      toast.success("Transaction removed / लेन-देन हटाया गया");
      setDelTarget(null);
      load();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const wname = (id) => workers.find((w) => w.id === id)?.name || "—";

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-slate-900">
        Payments & Advances / वेतन व पेशगी
      </h1>
      <p className="text-slate-500 text-sm mb-6">
        Record salary payouts, advances, and extra-work settlements with clear transaction history.
      </p>

      {/* Record Payment / Advance Form with FIXED non-overlapping select */}
      <div className="bg-white border border-stone-200 rounded-3xl p-6 sm:p-7 shadow-sm mb-8">
        <h2 className="font-display text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Wallet className="h-5 w-5 text-teal-800" /> लेन-देन दर्ज करें / Record Transaction
        </h2>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          {/* Worker Select */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-700">Worker / कर्मचारी</Label>
            <Select
              value={form.worker_id}
              onValueChange={(v) => setForm({ ...form, worker_id: v })}
            >
              <SelectTrigger data-testid="payment-worker-select">
                <SelectValue placeholder="Select worker / कर्मचारी चुनें" />
              </SelectTrigger>
              <SelectContent>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name} ({w.work_type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Type Select */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-700">Type / प्रकार</Label>
            <Select
              value={form.type}
              onValueChange={(v) => setForm({ ...form, type: v })}
            >
              <SelectTrigger data-testid="payment-type-select">
                <SelectValue placeholder="Payment type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SALARY_PAYMENT">वेतन भुगतान (Salary Payment)</SelectItem>
                <SelectItem value="ADVANCE">पेशगी (Advance)</SelectItem>
                <SelectItem value="EXTRA_WORK_PAYMENT">अतिरिक्त काम भुगतान</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Amount */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-700">Amount (₹) / राशि</Label>
            <Input
              data-testid="payment-amount-input"
              type="number"
              min="0"
              placeholder="e.g. 5000"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="rounded-xl h-10"
            />
          </div>

          {/* Date */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-700">Date / तारीख</Label>
            <Input
              data-testid="payment-date-input"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="rounded-xl h-10"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-[1fr_auto] gap-4 items-end mt-4">
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-700">Note (Optional / विवरण)</Label>
            <Input
              data-testid="payment-note-input"
              placeholder="e.g. दीवाली बोनस, या दवा के लिए पेशगी"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="rounded-xl h-10"
            />
          </div>
          <Button
            data-testid="record-payment-btn"
            onClick={save}
            disabled={saving}
            className="bg-teal-800 hover:bg-teal-900 rounded-xl h-10 px-6 font-bold shadow-md"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Record / दर्ज करें"}
          </Button>
        </div>
      </div>

      {/* Salary & Advance Status Cards per Worker */}
      <h2 className="font-display text-lg font-bold text-slate-900 mb-3">
        इस महीने का हिसाब / Monthly Status by Worker
      </h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {workers.map((w) => {
          const s = summaries[w.id];
          return (
            <div
              key={w.id}
              data-testid={`salary-status-${w.id}`}
              className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-slate-900 text-base">{w.name}</p>
                  <p className="text-xs text-slate-500">{w.work_type}</p>
                </div>
                <span className="text-xs font-mono font-bold text-slate-500">
                  {money(w.salary)}/माह
                </span>
              </div>

              {s ? (
                <div className="mt-4 space-y-1.5 text-xs">
                  <div className="flex justify-between py-1 border-b border-stone-100">
                    <span className="text-slate-500">कमाई (Earned):</span>
                    <span className="font-bold text-teal-800">{money(s.gross_earned)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-stone-100">
                    <span className="text-slate-500">वेतन मिला (Paid):</span>
                    <span className="font-bold text-teal-600">{money(s.paid_this_month)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-stone-100">
                    <span className="text-slate-500">पेशगी (Advance):</span>
                    <span className="font-bold text-amber-700">{money(s.advance_taken)}</span>
                  </div>
                  <div className="flex justify-between pt-1 font-bold text-sm">
                    <span className="text-slate-800">बाकी (Payable):</span>
                    <span className="text-amber-800">{money(s.remaining_payable)}</span>
                  </div>
                </div>
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-slate-300 mt-4" />
              )}
            </div>
          );
        })}
      </div>

      {/* Transaction History Table */}
      <h2 className="font-display text-lg font-bold text-slate-900 mb-3">
        लेन-देन इतिहास / Transaction History
      </h2>
      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-left min-w-[650px]" data-testid="payments-table">
          <thead>
            <tr className="bg-stone-50 text-slate-600 text-xs uppercase tracking-wider font-bold border-b border-stone-200">
              <th className="py-3.5 px-4">Worker</th>
              <th className="py-3.5 px-4">Type / प्रकार</th>
              <th className="py-3.5 px-4">Date</th>
              <th className="py-3.5 px-4">Note</th>
              <th className="py-3.5 px-4 text-right">Amount</th>
              <th className="py-3.5 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-400 text-sm">
                  कोई लेन-देन दर्ज नहीं है / No payments or advances recorded yet.
                </td>
              </tr>
            )}
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-stone-100 hover:bg-stone-50/70">
                <td className="py-3.5 px-4 font-bold text-slate-900">{wname(p.worker_id)}</td>
                <td className="py-3.5 px-4">
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                      p.type === "ADVANCE"
                        ? "bg-amber-100 text-amber-800 border border-amber-300"
                        : "bg-teal-100 text-teal-800 border border-teal-300"
                    }`}
                  >
                    {p.type === "ADVANCE" ? "पेशगी (Advance)" : "वेतन (Salary)"}
                  </span>
                </td>
                <td className="py-3.5 px-4 font-mono text-sm text-slate-600">{p.date}</td>
                <td className="py-3.5 px-4 text-sm text-slate-500">{p.note || "—"}</td>
                <td className="py-3.5 px-4 text-right font-display font-bold text-teal-800">
                  {money(p.amount)}
                </td>
                <td className="py-3.5 px-4 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDelTarget(p)}
                    className="h-8 w-8 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete Transaction Alert */}
      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transaction / लेन-देन हटाएं?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this {money(delTarget?.amount)} entry?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={removePayment} className="bg-rose-600 hover:bg-rose-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------------- 5. Extra Work Section ---------------- */
function ExtraSection({ workers }) {
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState({
    worker_id: "",
    description: "",
    date: todayDateStr(),
    amount: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.get("/extra-work");
      setEntries(res.data);
    } catch (e) {
      toast.error(apiError(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!form.worker_id || !form.description || !form.amount) {
      toast.error("Fill all required fields");
      return;
    }
    setSaving(true);
    try {
      await adminApi.post("/extra-work", {
        ...form,
        amount: parseFloat(form.amount),
      });
      toast.success("Extra work entry saved / अतिरिक्त काम दर्ज");
      setForm({ worker_id: "", description: "", date: todayDateStr(), amount: "" });
      load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const wname = (id) => workers.find((w) => w.id === id)?.name || "—";

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-slate-900">Extra Work / अतिरिक्त काम</h1>
      <p className="text-slate-500 text-sm mb-6">
        Record overtime or specialized tasks added to worker earnings.
      </p>

      {/* Extra Work Form with FIXED select */}
      <div className="bg-white border border-stone-200 rounded-3xl p-6 sm:p-7 shadow-sm mb-8">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-700">Worker / कर्मचारी</Label>
            <Select
              value={form.worker_id}
              onValueChange={(v) => setForm({ ...form, worker_id: v })}
            >
              <SelectTrigger data-testid="extra-worker-select">
                <SelectValue placeholder="Select worker / कर्मचारी चुनें" />
              </SelectTrigger>
              <SelectContent>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name} ({w.work_type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-700">Date / तारीख</Label>
            <Input
              data-testid="extra-date-input"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="rounded-xl h-10"
            />
          </div>
        </div>

        <div className="mt-4 space-y-1">
          <Label className="text-xs font-semibold text-slate-700">
            Work Description / काम का विवरण
          </Label>
          <Textarea
            data-testid="extra-desc-input"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="e.g. संडे को 4 घंटे एक्स्ट्रा काम, या साइट पर नाइट शिफ्ट"
            rows={2}
            className="rounded-xl"
          />
        </div>

        <div className="grid sm:grid-cols-[1fr_auto] gap-4 mt-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-700">Extra Amount (₹) / अतिरिक्त राशि</Label>
            <Input
              data-testid="extra-amount-input"
              type="number"
              min="0"
              placeholder="e.g. 1500"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="rounded-xl h-10"
            />
          </div>
          <Button
            data-testid="add-extra-btn"
            onClick={save}
            disabled={saving}
            className="bg-indigo-700 hover:bg-indigo-800 rounded-xl h-10 px-6 font-bold shadow-md"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Entry / जोड़ें"}
          </Button>
        </div>
      </div>

      {/* History Table */}
      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-left min-w-[600px]" data-testid="extra-table">
          <thead>
            <tr className="bg-stone-50 text-slate-600 text-xs uppercase tracking-wider font-bold border-b border-stone-200">
              <th className="py-3.5 px-4">Worker</th>
              <th className="py-3.5 px-4">Description</th>
              <th className="py-3.5 px-4">Date</th>
              <th className="py-3.5 px-4 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="py-10 text-center text-slate-400 text-sm">
                  कोई अतिरिक्त काम दर्ज नहीं है।
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-stone-100 hover:bg-stone-50/70">
                <td className="py-3.5 px-4 font-bold text-slate-900">{wname(e.worker_id)}</td>
                <td className="py-3.5 px-4 text-sm text-slate-600">{e.description}</td>
                <td className="py-3.5 px-4 font-mono text-sm text-slate-600">{e.date}</td>
                <td className="py-3.5 px-4 text-right font-display font-bold text-indigo-700">
                  {money(e.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- 6. Messages / Chat Section ---------------- */
function MessagesSection({ workers, onUnreadChange }) {
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [enablingNotifications, setEnablingNotifications] = useState(false);
  const messagesEndRef = useRef(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await adminApi.get("/chat/conversations");
      setConversations(res.data);
      onUnreadChange?.();
      if (!activeConv && res.data.length > 0) {
        const requested = new URLSearchParams(window.location.search).get("conversation");
        setActiveConv(res.data.find((item) => item.conversation_id === requested) || res.data[0]);
      }
    } catch (e) {
      console.error(e);
    }
  }, [activeConv]);

  const loadMessages = useCallback(async () => {
    if (!activeConv) return;
    try {
      const res = await adminApi.get(`/chat/conversations/${activeConv.conversation_id}/messages`);
      setMessages(res.data);
      setConversations((items) => items.map((item) => item.conversation_id === activeConv.conversation_id ? { ...item, unread_count: 0 } : item));
      onUnreadChange?.();
    } catch (e) {
      console.error(e);
    }
  }, [activeConv]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    loadMessages();
    const interval = setInterval(loadMessages, 3500); // Polling for new chat messages
    return () => clearInterval(interval);
  }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const enableNotifications = async () => {
    setEnablingNotifications(true);
    try {
      await enablePushNotifications(true);
      toast.success("Notifications enabled / नोटिफिकेशन चालू हैं");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setEnablingNotifications(false);
    }
  };

  const handleSendText = async (e) => {
    e?.preventDefault();
    if (!text.trim() || !activeConv) return;
    setSending(true);
    try {
      await adminApi.post("/chat/messages", {
        conversation_id: activeConv.conversation_id,
        worker_id: activeConv.worker.id,
        message_type: "text",
        text: text.trim(),
      });
      setText("");
      loadMessages();
      loadConversations();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSending(false);
    }
  };

  const handleSendAudio = async ({ audioAssetId, duration }) => {
    if (!activeConv) return;
    try {
      await adminApi.post("/chat/messages", {
        conversation_id: activeConv.conversation_id,
        worker_id: activeConv.worker.id,
        message_type: "audio",
        audio_asset_id: audioAssetId,
        duration,
      });
      setShowRecorder(false);
      loadMessages();
      loadConversations();
      toast.success("Voice note sent / आवाज़ संदेश भेजा गया");
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-slate-900">Messages / संदेश</h1>
        <p className="text-slate-500 text-sm">
          Chat with workers directly through text messages, voice notes, and speech typing.
        </p>
        {pushSupported() && <Button type="button" variant="outline" size="sm" onClick={enableNotifications} disabled={enablingNotifications} className="mt-3 rounded-xl text-xs">
          {enablingNotifications ? "Enabling…" : "Enable Notifications / नोटिफिकेशन चालू करें"}
        </Button>}
      </div>

      <div className="bg-white border border-stone-200 rounded-3xl shadow-md overflow-hidden grid md:grid-cols-[300px_1fr] h-[72vh] min-h-[500px]">
        {/* Left Side: Worker Conversations List */}
        <div className="border-r border-stone-200 flex flex-col bg-stone-50/50">
          <div className="p-4 border-b border-stone-200 bg-white">
            <span className="text-xs font-bold text-teal-800 uppercase tracking-wider block">
              कर्मचारी / Worker Chats
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {conversations.length === 0 && (
              <p className="text-xs text-slate-400 p-4 text-center">Add workers to begin chatting.</p>
            )}
            {conversations.map((c) => {
              const isSelected = activeConv?.conversation_id === c.conversation_id;
              return (
                <button
                  key={c.conversation_id}
                  onClick={() => setActiveConv(c)}
                  className={`w-full p-3 rounded-2xl text-left transition-all flex items-center justify-between gap-2 ${
                    isSelected ? "bg-teal-800 text-white shadow-sm" : "hover:bg-white text-slate-800"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm truncate">{c.worker.name}</p>
                    <p className={`text-xs truncate ${isSelected ? "text-teal-200" : "text-slate-500"}`}>
                      {c.last_message?.text || c.worker.work_type}
                    </p>
                  </div>
                  {c.unread_count > 0 && (
                    <span className="h-5 min-w-5 px-1.5 rounded-full bg-amber-400 text-slate-950 font-bold text-[10px] flex items-center justify-center">
                      {c.unread_count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Side: Active Chat Window */}
        {activeConv ? (
          <div className="flex flex-col h-full bg-[#fcfbfa]">
            {/* Chat Header */}
            <div className="p-4 border-b border-stone-200 bg-white flex items-center justify-between">
              <div>
                <h2 className="font-display font-bold text-base text-slate-900">
                  {activeConv.worker.name}
                </h2>
                <p className="text-xs text-slate-500">
                  {activeConv.worker.work_type} · {activeConv.worker.mobile}
                </p>
              </div>
            </div>

            {/* Message Thread */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-center text-slate-400 text-sm">
                  <div>
                    <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40 text-teal-800" />
                    <p>No messages yet. Send a message or voice note below.</p>
                  </div>
                </div>
              )}

              {messages.map((m) => {
                const isOwner = m.sender_type === "owner";
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${isOwner ? "items-end" : "items-start"}`}
                  >
                    <span className="text-[10px] text-slate-400 mb-1 px-1">
                      {isOwner ? "आप (Owner)" : activeConv.worker.name}
                    </span>

                    {m.message_type === "audio" ? (
                      <AudioPlayer audioUrl={m.audio_url} duration={m.duration} />
                    ) : (
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                          isOwner
                            ? "bg-teal-800 text-white rounded-br-none"
                            : "bg-white text-slate-900 border border-stone-200 rounded-bl-none"
                        }`}
                      >
                        {m.text}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Recorder or Chat Input */}
            <div className="p-3 bg-white border-t border-stone-200 space-y-2">
              {showRecorder ? (
                <VoiceRecorder
                  conversationId={activeConv.conversation_id}
                  isAdmin={true}
                  onSend={handleSendAudio}
                  onCancel={() => setShowRecorder(false)}
                />
              ) : (
                <form onSubmit={handleSendText} className="flex items-center gap-2">
                  {/* Voice Note Button */}
                  <button
                    type="button"
                    onClick={() => setShowRecorder(true)}
                    title="Send audio message / आवाज़ भेजें"
                    className="p-2.5 rounded-xl border border-stone-200 bg-amber-50 text-amber-900 hover:bg-amber-100 flex items-center gap-1 text-xs font-bold shrink-0 transition-colors"
                  >
                    <Mic className="h-4 w-4 text-amber-700" />
                    <span className="hidden sm:inline">आवाज़ संदेश</span>
                  </button>

                  {/* Speech to text */}
                  <SpeechTyping
                    currentText={text}
                    onSpeechResult={(transcript) => setText(transcript)}
                    disabled={showRecorder}
                  />

                  {/* Text Input */}
                  <Input
                    placeholder="संदेश लिखें / Type message..."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="rounded-xl h-10 text-sm"
                  />

                  <Button
                    type="submit"
                    disabled={sending || !text.trim()}
                    className="bg-teal-800 hover:bg-teal-900 rounded-xl h-10 px-4 font-bold shrink-0"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </form>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center p-8 text-center text-slate-400">
            Select a worker to open messages
          </div>
        )}
      </div>
    </div>
  );
}
