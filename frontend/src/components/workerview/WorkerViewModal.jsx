import React, { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import WorkerAvatar from "@/components/ui/WorkerAvatar";
import AttendanceCalendar from "@/components/attendance/AttendanceCalendar";
import SalarySlipModal from "@/components/salary/SalarySlipModal";
import { adminApi, apiError, money } from "@/lib/api";
import {
  CalendarCheck,
  IndianRupee,
  TrendingUp,
  Wallet,
  Sparkles,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Phone,
  Calendar,
  Briefcase,
  ShieldCheck,
  IdCard,
  FileText,
} from "lucide-react";

const statusStyle = {
  Present: "bg-emerald-100 text-emerald-800 border-emerald-300",
  Absent: "bg-rose-100 text-rose-800 border-rose-300",
  "Half Day": "bg-amber-100 text-amber-800 border-amber-300",
};

const statusHindi = {
  Present: "हाज़िर (पूरा दिन)",
  Absent: "गैरहाज़िर",
  "Half Day": "आधा दिन",
};

export default function WorkerViewModal({ workerId, open, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalTab, setModalTab] = useState("calendar"); // "calendar" or "finance"
  const [salarySlipOpen, setSalarySlipOpen] = useState(false);

  useEffect(() => {
    if (!open || !workerId) return;
    setLoading(true);
    setError("");

    (async () => {
      try {
        const res = await adminApi.get(`/workers/${workerId}/details`);
        setData(res.data);
      } catch (err) {
        setError(apiError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [open, workerId]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%_-_1.5rem)] max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl p-0 gap-0 border-0 shadow-2xl bg-[#f8f7f2]">
        {/* Header with clean Exit */}
        <div className="bg-[#102f2c] text-white p-6 sm:p-8 rounded-t-3xl relative">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <WorkerAvatar
                name={data?.worker?.name || ""}
                photoUrl={data?.worker?.profile_photo_url || ""}
                size="xl"
                className="shadow-lg border-2 border-white/20 ring-2 ring-amber-400/30"
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-widest text-teal-300 block">
                    कर्मचारी प्रोफाइल / Worker Profile
                  </span>
                  {data?.worker?.login_id && (
                    <span className="bg-amber-400/20 text-amber-300 border border-amber-400/40 text-[11px] font-mono font-bold px-2 py-0.5 rounded-md">
                      {data.worker.login_id}
                    </span>
                  )}
                </div>
                <h1 className="font-display text-2xl sm:text-3xl font-extrabold mt-0.5 truncate">
                  {data?.worker?.name || "लोड हो रहा है..."}
                </h1>
                <p className="text-xs text-teal-200 mt-0.5 font-medium flex items-center gap-2">
                  <span>{data?.worker?.work_type}</span>
                  {data?.worker?.status && (
                    <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full ${data.worker.status === 'INACTIVE' ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                      {data.worker.status === 'INACTIVE' ? 'निष्क्रिय / Inactive' : 'सक्रिय / Active'}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                data-testid="worker-modal-salary-slip-btn"
                onClick={() => setSalarySlipOpen(true)}
                size="sm"
                className="bg-amber-400 hover:bg-amber-500 text-slate-950 rounded-xl font-bold text-xs shadow-sm"
              >
                <FileText className="h-4 w-4 mr-1.5" /> वेतन पर्ची (PDF)
              </Button>
              <Button
                onClick={onClose}
                variant="outline"
                size="sm"
                className="bg-white/10 hover:bg-white/20 text-white border-white/20 rounded-xl"
              >
                <ArrowLeft className="h-4 w-4 mr-1.5" /> वापस / Close
              </Button>
            </div>
          </div>

          {data && (
            <div className="flex flex-wrap gap-2.5 mt-6 text-xs text-teal-100">
              <span className="bg-white/10 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5 text-amber-300" /> काम: <strong>{data.worker.work_type}</strong>
              </span>
              <span className="bg-white/10 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-amber-300" /> मोबाइल: <strong className="font-mono">{data.worker.mobile || "—"}</strong>
              </span>
              <span className="bg-white/10 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-amber-300" /> शामिल: <strong>{data.worker.joining_date}</strong>
              </span>
              <span
                className={`px-3 py-1.5 rounded-xl font-semibold flex items-center gap-1.5 ${
                  data.connected
                    ? "bg-emerald-400/20 text-emerald-300 border border-emerald-400/30"
                    : "bg-white/10 text-stone-300"
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" /> पोर्टल: {data.connected ? "जुड़ा हुआ (App Enabled)" : "नहीं जुड़ा (No App)"}
              </span>
            </div>
          )}

          {/* Sub-tab navigation */}
          <div className="flex items-center gap-2 mt-5 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={() => setModalTab("calendar")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                modalTab === "calendar"
                  ? "bg-amber-400 text-slate-950 shadow-sm"
                  : "bg-white/10 text-teal-200 hover:bg-white/20"
              }`}
            >
              <CalendarCheck className="h-3.5 w-3.5 inline mr-1.5" />
              मासिक हाज़िरी कैलेंडर (Calendar)
            </button>
            <button
              type="button"
              onClick={() => setModalTab("finance")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                modalTab === "finance"
                  ? "bg-amber-400 text-slate-950 shadow-sm"
                  : "bg-white/10 text-teal-200 hover:bg-white/20"
              }`}
            >
              <Wallet className="h-3.5 w-3.5 inline mr-1.5" />
              हिसाब व रिकॉर्ड (Finance & Logs)
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 sm:p-8 space-y-6">
          {loading && (
            <div className="py-16 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-teal-800" />
              <p className="text-slate-600 mt-3 font-medium">हिसाब लोड हो रहा है...</p>
            </div>
          )}

          {error && (
            <div className="p-6 bg-rose-50 text-rose-700 rounded-2xl text-center">
              <p className="font-semibold">{error}</p>
            </div>
          )}

          {data && !loading && modalTab === "calendar" && (
            <AttendanceCalendar
              workerId={workerId}
              worker={data.worker}
              isAdmin={true}
            />
          )}

          {data && !loading && modalTab === "finance" && (
            <>
              {/* Highlight Financial Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                  <p className="text-xs sm:text-sm text-slate-500 font-medium">महीने का वेतन</p>
                  <p className="font-display text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
                    {money(data.summary.monthly_salary)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                    ₹{data.summary.daily_rate}/दिन
                  </p>
                </div>

                <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                  <p className="text-xs sm:text-sm text-teal-800 font-semibold">इस महीने की कमाई</p>
                  <p className="font-display text-xl sm:text-2xl font-extrabold text-teal-900 mt-1">
                    {money(data.summary.earned_salary)}
                  </p>
                  <p className="text-[11px] text-teal-700 mt-0.5">
                    {data.summary.present_days} दिन हाज़िर · {data.summary.half_days} आधा दिन
                  </p>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                  <p className="text-xs sm:text-sm text-amber-900 font-semibold">पेशगी (Advance)</p>
                  <p className="font-display text-xl sm:text-2xl font-extrabold text-amber-900 mt-1">
                    {money(data.summary.advance_taken)}
                  </p>
                  <p className="text-[11px] text-amber-700 mt-0.5">अग्रिम राशि</p>
                </div>

                <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                  <p className="text-xs sm:text-sm text-slate-500 font-medium">अब तक मिला</p>
                  <p className="font-display text-xl sm:text-2xl font-extrabold text-teal-700 mt-1">
                    {money(data.summary.paid_this_month)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">वेतन भुगतान</p>
                </div>

                <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                  <p className="text-xs sm:text-sm text-slate-500 font-medium">अतिरिक्त काम</p>
                  <p className="font-display text-xl sm:text-2xl font-extrabold text-indigo-700 mt-1">
                    {money(data.summary.extra_work_earned)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">अलग से काम</p>
                </div>

                <div className="bg-[#102f2c] text-white rounded-2xl p-4 sm:p-5 shadow-md">
                  <p className="text-xs sm:text-sm text-amber-300 font-bold">बाकी पैसा (Payable)</p>
                  <p className="font-display text-2xl sm:text-3xl font-extrabold text-amber-300 mt-1">
                    {money(data.summary.remaining_payable)}
                  </p>
                  <p className="text-[11px] text-teal-200 mt-0.5">कुल बकाया राशि</p>
                </div>
              </div>

              {/* Attendance & Payment Logs */}
              <div className="grid md:grid-cols-2 gap-6 mt-6">
                {/* Attendance History */}
                <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
                  <h3 className="font-display text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <CalendarCheck className="h-5 w-5 text-teal-800" />
                    हाज़िरी का रिकॉर्ड / Attendance History
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {data.attendance.length === 0 && (
                      <p className="text-sm text-slate-400 py-6 text-center">
                        कोई हाज़िरी दर्ज नहीं है।
                      </p>
                    )}
                    {data.attendance.map((a) => (
                      <div
                        key={a.date}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100"
                      >
                        <span className="font-mono text-sm font-medium text-slate-800">
                          {a.date}
                        </span>
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full font-bold border ${
                            statusStyle[a.status] || "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {statusHindi[a.status] || a.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Payments & Advances List */}
                <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
                  <h3 className="font-display text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-amber-600" />
                    लेन-देन विवरण / Payments & Advances
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {data.payments.length === 0 && (
                      <p className="text-sm text-slate-400 py-6 text-center">
                        कोई भुगतान दर्ज नहीं है।
                      </p>
                    )}
                    {data.payments.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold uppercase px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                              {p.type === "ADVANCE" ? "पेशगी" : "वेतन"}
                            </span>
                            <span className="font-mono text-xs text-slate-500">{p.date}</span>
                          </div>
                          {p.note && <p className="text-xs text-slate-500 mt-1">{p.note}</p>}
                        </div>
                        <span
                          className={`font-display font-bold ${
                            p.type === "ADVANCE" ? "text-amber-700" : "text-teal-800"
                          }`}
                        >
                          {money(p.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>

      {/* Salary Slip Modal */}
      <SalarySlipModal
        open={salarySlipOpen}
        onClose={() => setSalarySlipOpen(false)}
        workerId={workerId}
        worker={data?.worker}
        isAdmin={true}
      />
    </Dialog>
  );
}

