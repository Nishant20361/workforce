import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarCheck, Check, HardHat, IndianRupee, ShieldCheck, Users, MessageSquare } from "lucide-react";

const features = [
  {
    icon: CalendarCheck,
    title: "Attendance in seconds / आसान हाज़िरी",
    copy: "Mark present, absent, or half-day for today or past dates. Attendance directly drives accurate daily salary earnings.",
  },
  {
    icon: IndianRupee,
    title: "Salary & Advance clarity / वेतन व पेशगी",
    copy: "Separate salary earned from advances and payments. Live balance calculation prevents confusion and disputes.",
  },
  {
    icon: MessageSquare,
    title: "Voice & Text Chat / बातचीत",
    copy: "Communicate directly with your workforce via Hindi/English text, audio voice notes, and speech-to-text dictation.",
  },
];

export default function Landing() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-[#f8f7f2] text-slate-950 overflow-hidden">
      <header className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 py-6 flex items-center justify-between">
        <button
          data-testid="home-logo"
          onClick={() => navigate("/")}
          className="flex items-center gap-3 rounded-lg"
        >
          <span className="h-10 w-10 rounded-xl bg-teal-800 text-white flex items-center justify-center shadow-lg shadow-teal-900/15">
            <HardHat className="h-5 w-5" />
          </span>
          <div className="text-left">
            <span className="font-display font-extrabold tracking-tight text-xl block leading-none">WorkForce</span>
            <span className="text-[10px] text-teal-800 font-bold uppercase tracking-wider">कार्यबल प्रबंधन</span>
          </div>
        </button>
        <button
          data-testid="header-admin-login"
          onClick={() => navigate("/admin/login")}
          className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:border-teal-700 hover:text-teal-900 transition-colors shadow-sm"
        >
          <ShieldCheck className="h-4 w-4 text-teal-800" />
          <span>Admin Sign In / मालिक लॉगिन</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </header>

      <main>
        <section className="relative max-w-7xl mx-auto px-5 sm:px-8 pt-12 lg:pt-20 pb-20 grid lg:grid-cols-[1.08fr_.92fr] gap-12 items-center">
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 text-amber-950 px-4 py-2 text-xs font-bold uppercase tracking-[.16em]">
              <span className="h-2 w-2 bg-amber-500 rounded-full animate-pulse" /> Built for Indian Workforces & Contractors
            </div>
            <h1 className="font-display text-[clamp(2.7rem,6.5vw,5.8rem)] font-extrabold leading-[.95] tracking-[-.05em] mt-6 max-w-4xl">
              Every worker.<br />
              <span className="text-teal-800">Every workday.</span><br />
              Total clarity.
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-slate-600 leading-relaxed max-w-2xl">
              Attendance, daily earned salary, advances, and audio-text messaging—organized cleanly for business owners and accessible for every worker.
            </p>

            <div className="flex flex-col sm:flex-row gap-3.5 mt-8">
              <button
                data-testid="goto-admin-btn"
                onClick={() => navigate("/admin/login")}
                className="inline-flex justify-center items-center gap-2.5 rounded-xl bg-teal-800 hover:bg-teal-900 text-white font-bold px-6 py-4 shadow-xl shadow-teal-900/20 active:scale-[0.98] transition-all text-base"
              >
                <ShieldCheck className="h-5 w-5 text-amber-300" />
                <span>Admin / मालिक — Continue</span>
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                data-testid="goto-worker-btn"
                onClick={() => navigate("/worker/login")}
                className="inline-flex justify-center items-center gap-2 rounded-xl bg-white hover:bg-amber-50/80 border border-slate-300 font-bold px-6 py-4 text-slate-800 active:scale-[0.98] transition-all shadow-sm text-base"
              >
                <HardHat className="h-5 w-5 text-amber-600" />
                <span>Worker Portal / कर्मचारी पोर्टल</span>
              </button>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-7 text-sm text-slate-600">
              {[
                "Daily Attendance / हाज़िरी",
                "Advances & Salary / पेशगी व वेतन",
                "Voice Notes & Hindi UI",
                "Works without Worker Smartphone",
              ].map((x) => (
                <span key={x} className="inline-flex items-center gap-1.5 font-medium">
                  <Check className="h-4 w-4 text-teal-700 shrink-0" />
                  {x}
                </span>
              ))}
            </div>
          </div>

          <div className="relative lg:pl-6" aria-hidden="true">
            <div className="absolute -inset-16 bg-amber-200/40 rounded-full blur-3xl" />
            <div className="relative bg-[#102f2c] text-white rounded-[2rem] p-6 sm:p-8 shadow-2xl shadow-teal-950/25 rotate-[1deg]">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <p className="text-teal-200 text-xs font-semibold uppercase tracking-wider">आज का हिसाब / Today</p>
                  <p className="font-display text-2xl font-bold">Workspace Overview</p>
                </div>
                <span className="rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 px-3 py-1 text-xs font-bold">
                  Live Asia/Kolkata
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  ["28", "Workers / कुल"],
                  ["24", "Present / हाज़िर"],
                  ["4", "Away / छुट्टी"],
                ].map(([n, l], i) => (
                  <div
                    key={l}
                    className={`${
                      i === 1 ? "bg-amber-300 text-slate-950" : "bg-white/10 text-white"
                    } rounded-2xl p-4`}
                  >
                    <p className="font-display text-3xl font-extrabold">{n}</p>
                    <p className={`text-xs mt-1 font-medium ${i === 1 ? "text-slate-800" : "text-teal-100"}`}>{l}</p>
                  </div>
                ))}
              </div>

              <div className="bg-white text-slate-900 rounded-2xl p-5 mt-4 shadow-md">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs text-slate-500 font-medium">इस महीने की कमाई / Monthly Earned</p>
                    <p className="font-display text-2xl font-extrabold text-teal-900 mt-0.5">₹3,48,500</p>
                  </div>
                  <div className="h-11 w-11 rounded-xl bg-teal-50 text-teal-800 flex items-center justify-center">
                    <IndianRupee className="h-5 w-5" />
                  </div>
                </div>
                <div className="h-2 bg-slate-100 rounded-full mt-4 overflow-hidden">
                  <div className="h-full w-[72%] bg-teal-700 rounded-full" />
                </div>
                <div className="flex justify-between text-xs text-slate-600 mt-2 font-medium">
                  <span>₹2,50,000 Paid (वेतन+पेशगी)</span>
                  <span className="text-amber-800 font-bold">₹98,500 Remaining (बाकी)</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white border-y border-stone-200">
          <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16">
            <p className="text-xs font-bold text-teal-800 uppercase tracking-[.18em]">
              Made for Owners and Workers / सरल व भरोसेमंद
            </p>
            <div className="grid lg:grid-cols-3 gap-6 mt-6">
              {features.map(({ icon: Icon, title, copy }, i) => (
                <article key={title} className="border-t-2 border-slate-900 pt-6">
                  <span className="text-xs font-mono font-bold text-slate-400">0{i + 1}</span>
                  <Icon className="h-7 w-7 text-teal-800 mt-6" />
                  <h2 className="font-display text-lg font-bold mt-4 text-slate-900">{title}</h2>
                  <p className="text-slate-600 mt-2 text-sm leading-relaxed">{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="max-w-7xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-slate-500">
        <span>© {new Date().getFullYear()} WorkForce Management</span>
        <span className="text-xs">कर्मचारियों और काम का पूरा हिसाब।</span>
      </footer>
    </div>
  );
}
