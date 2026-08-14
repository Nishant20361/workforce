import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { workerApi, apiError, money } from "@/lib/api";
import { useWorkerAuth } from "@/context/WorkerAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import AudioPlayer from "@/components/chat/AudioPlayer";
import VoiceRecorder from "@/components/chat/VoiceRecorder";
import SpeechTyping from "@/components/chat/SpeechTyping";
import UnreadBadge from "@/components/chat/UnreadBadge";
import useSmartChatScroll from "@/components/chat/useSmartChatScroll";
import { clearConversationNotifications, enablePushNotifications, pushSupported, updateAppBadge } from "@/lib/notifications";
import {
  Loader2,
  LogOut,
  HardHat,
  CalendarCheck,
  Wallet,
  Sparkles,
  MessageSquare,
  Send,
  Mic,
  Home,
  IndianRupee,
  TrendingUp,
  Lock,
  Eye,
  EyeOff,
  X,
} from "lucide-react";

const statusStyle = {
  Present: "bg-emerald-100 text-emerald-800 border-emerald-300 font-bold",
  Absent: "bg-rose-100 text-rose-800 border-rose-300 font-bold",
  "Half Day": "bg-amber-100 text-amber-800 border-amber-300 font-bold",
};

const statusHindi = {
  Present: "हाज़िर (पूरा दिन)",
  Absent: "गैरहाज़िर",
  "Half Day": "आधा दिन",
};

export default function WorkerDashboard() {
  const navigate = useNavigate();
  const { user, loading: authLoading, logout, changePassword } = useWorkerAuth();
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [changePwdForm, setChangePwdForm] = useState({ current: "", next: "", confirm: "" });
  const [changePwdLoading, setChangePwdLoading] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).has("conversation") ? "messages" : "home"); // home, attendance, money, messages

  // Chat State
  const [chatConv, setChatConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [firstUnreadId, setFirstUnreadId] = useState(null);
  const [msgText, setMsgText] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const chatRequestRef = useRef(0);
  const { listRef: messageListRef, onScroll: handleMessageScroll, scrollAfterSend } = useSmartChatScroll(messages, chatConv?.conversation_id);

  const loadData = useCallback(async () => {
    try {
      const res = await workerApi.get("/worker/me/data");
      setData(res.data);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChat = useCallback(async () => {
    const requestId = ++chatRequestRef.current;
    try {
      const { data: conv } = await workerApi.get("/chat/worker-conversation");
      if (requestId !== chatRequestRef.current) return;
      // Reading the thread is the deliberate action that clears read_at/unread count.
      if (tab === "messages") {
        const { data: readState } = await workerApi.post(`/chat/conversations/${conv.conversation_id}/read`);
        if (requestId !== chatRequestRef.current) return;
        setChatConv({ ...conv, unread_count: readState.unread_count });
        setFirstUnreadId((current) => current || readState.first_unread_message_id);
        updateAppBadge(readState.total_unread_count);
        clearConversationNotifications(conv.conversation_id, readState.total_unread_count);
        const { data: msgs } = await workerApi.get(`/chat/conversations/${conv.conversation_id}/messages`);
        if (requestId !== chatRequestRef.current) return;
        setMessages(msgs);
      } else {
        setChatConv(conv);
        updateAppBadge(conv.unread_count);
      }
    } catch (e) {
      console.error(e);
    }
  }, [tab]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/worker/login");
      return;
    }
    loadData();
    loadChat();
  }, [user, authLoading, navigate, loadData, loadChat]);

  useEffect(() => {
    if (!user || !pushSupported()) return;
    enablePushNotifications(false).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (tab === "messages") {
      const interval = setInterval(loadChat, 3500);
      return () => clearInterval(interval);
    }
  }, [tab, loadChat]);

  const handleSendText = async (e) => {
    e?.preventDefault();
    if (!msgText.trim() || !chatConv) return;
    setSendingMsg(true);
    try {
      await workerApi.post("/chat/messages", {
        conversation_id: chatConv.conversation_id,
        worker_id: data?.worker?.id,
        message_type: "text",
        text: msgText.trim(),
      });
      setMsgText("");
      scrollAfterSend();
      loadChat();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSendingMsg(false);
    }
  };

  const handleSendAudio = async ({ audioAssetId, duration }) => {
    if (!chatConv) return;
    try {
      await workerApi.post("/chat/messages", {
        conversation_id: chatConv.conversation_id,
        worker_id: data?.worker?.id,
        message_type: "audio",
        audio_asset_id: audioAssetId,
        duration,
      });
      setShowRecorder(false);
      scrollAfterSend();
      loadChat();
      toast.success("आवाज़ संदेश भेजा गया / Voice message sent");
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const doLogout = async () => {
    await logout();
    updateAppBadge(0);
    navigate("/worker/login");
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#f8f7f2] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-800" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f7f2] flex flex-col">
      {/* Top Navbar */}
      <nav className="bg-[#102f2c] text-white sticky top-0 z-20 shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-md">
              <HardHat className="h-5 w-5" />
            </div>
            <div>
              <span className="font-display font-bold text-lg leading-tight block">
                {data?.worker ? data.worker.name : "My Portal"}
              </span>
              <span className="text-[11px] text-teal-300 font-semibold block">
                {data?.business?.name || "WorkForce"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              data-testid="worker-change-pwd-btn"
              variant="outline"
              size="sm"
              onClick={() => { setChangePwdForm({ current: "", next: "", confirm: "" }); setChangePwdOpen(true); }}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 rounded-xl text-xs"
            >
              <Lock className="h-3.5 w-3.5 mr-1" /> पासवर्ड
            </Button>
            <Button
              data-testid="worker-logout-btn"
              variant="outline"
              size="sm"
              onClick={doLogout}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 rounded-xl text-xs"
            >
              <LogOut className="h-3.5 w-3.5 mr-1" /> लॉगआउट
            </Button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="max-w-5xl mx-auto px-4 flex gap-1 border-t border-teal-900/70 overflow-x-auto">
          {[
            { key: "home", label: "Home / घर", icon: Home },
            { key: "attendance", label: "Attendance / हाज़िरी", icon: CalendarCheck },
            { key: "money", label: "Money / पैसा", icon: Wallet },
            { key: "messages", label: "Messages / संदेश", icon: MessageSquare },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold whitespace-nowrap border-b-2 transition-all ${
                tab === t.key
                  ? "border-amber-400 text-amber-300 bg-white/5"
                  : "border-transparent text-teal-200 hover:text-white"
              }`}
            >
              <t.icon className="h-4 w-4" />
              <span>{t.label}</span>
              {t.key === "messages" && <UnreadBadge count={chatConv?.unread_count} className="bg-rose-500 text-white" />}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 pb-20">
        {error ? (
          <div
            data-testid="worker-error"
            className="bg-white border border-stone-200 rounded-3xl p-8 text-center max-w-lg mx-auto mt-8 shadow-sm"
          >
            <HardHat className="h-12 w-12 text-amber-500 mx-auto mb-3" />
            <h2 className="font-display text-xl font-bold text-slate-900">पोर्टल उपलब्ध नहीं / Not Available</h2>
            <p className="text-slate-600 text-sm mt-2">{error}</p>
            <p className="text-xs text-slate-400 mt-4 leading-relaxed">
              अपने मालिक से संपर्क करें और कहें कि वे आपका पोर्टल एक्सेस चालू करें।
              <br />Contact your employer to enable your portal access.
            </p>
          </div>
        ) : (
          <>
            {/* 1. HOME TAB */}
            {tab === "home" && (
              <div className="space-y-6">
                {/* Greeting banner */}
                <div className="bg-gradient-to-r from-teal-900 to-[#102f2c] text-white rounded-3xl p-6 shadow-md flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <span className="text-xs font-bold text-teal-300 uppercase tracking-widest block">
                      नमस्ते / Welcome
                    </span>
                    <h1 className="font-display text-2xl sm:text-3xl font-extrabold mt-1">
                      {data.worker.name} 👋
                    </h1>
                    <p className="text-teal-200 text-xs mt-1 font-medium">
                      काम: <strong>{data.worker.work_type}</strong> · शामिल: {data.worker.joining_date}
                    </p>
                  </div>
                  <div className="bg-white/10 px-4 py-2.5 rounded-2xl border border-white/10 text-right">
                    <span className="text-[11px] text-teal-200 block">महीने का वेतन</span>
                    <span className="font-display text-xl font-extrabold text-amber-300">
                      {money(data.summary.monthly_salary)}
                    </span>
                  </div>
                </div>

                {/* Primary Financial Metric Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                  <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                    <span className="text-xs text-slate-500 font-medium">इस महीने की कमाई</span>
                    <p className="font-display text-2xl font-extrabold text-teal-800 mt-1">
                      {money(data.summary.earned_salary)}
                    </p>
                    <span className="text-[11px] text-slate-400 mt-0.5 block font-mono">
                      {data.summary.present_days} दिन हाज़िर · {data.summary.half_days} आधा दिन
                    </span>
                  </div>

                  <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                    <span className="text-xs text-slate-500 font-medium">अब तक मिला</span>
                    <p className="font-display text-2xl font-extrabold text-teal-600 mt-1">
                      {money(data.summary.paid_this_month)}
                    </p>
                    <span className="text-[11px] text-slate-400 mt-0.5 block">वेतन भुगतान</span>
                  </div>

                  <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                    <span className="text-xs text-slate-500 font-medium">पेशगी (Advance)</span>
                    <p className="font-display text-2xl font-extrabold text-amber-700 mt-1">
                      {money(data.summary.advance_taken)}
                    </p>
                    <span className="text-[11px] text-slate-400 mt-0.5 block">अग्रिम राशि</span>
                  </div>

                  <div className="bg-[#102f2c] text-white rounded-2xl p-4 sm:p-5 shadow-md">
                    <span className="text-xs text-amber-300 font-bold uppercase tracking-wider block">बाकी पैसा</span>
                    <p className="font-display text-2xl sm:text-3xl font-extrabold text-amber-300 mt-1">
                      {money(data.summary.remaining_payable)}
                    </p>
                    <span className="text-[11px] text-teal-200 mt-0.5 block">कुल बकाया</span>
                  </div>
                </div>

                {/* Quick actions & Recent updates */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div
                    onClick={() => setTab("messages")}
                    className="cursor-pointer bg-amber-100 hover:bg-amber-200/80 border border-amber-300 text-slate-900 rounded-3xl p-5 shadow-sm transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold shadow-sm">
                        <MessageSquare className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-display font-bold text-base">मालिक से बात करें / Message Owner</h3>
                        <p className="text-xs text-slate-700 mt-0.5">आवाज़ या लिख कर संदेश भेजें</p>
                      </div>
                    </div>
                  </div>

                  <div
                    onClick={() => setTab("attendance")}
                    className="cursor-pointer bg-white hover:bg-stone-50 border border-stone-200 text-slate-900 rounded-3xl p-5 shadow-sm transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-2xl bg-teal-800 text-white flex items-center justify-center font-bold shadow-sm">
                        <CalendarCheck className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-display font-bold text-base">हाज़िरी का रिकॉर्ड / Attendance</h3>
                        <p className="text-xs text-slate-500 mt-0.5">तारीख अनुसार अपनी हाज़िरी देखें</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. ATTENDANCE TAB */}
            {tab === "attendance" && (
              <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="font-display text-xl font-bold text-slate-900">
                      हाज़िरी का हिसाब / Attendance History
                    </h2>
                    <p className="text-xs text-slate-500">आपके काम के दिनों का विवरण</p>
                  </div>
                  <Badge className="bg-teal-50 text-teal-900 border-teal-200 text-xs font-bold px-3 py-1 rounded-xl">
                    ₹{data.summary.daily_rate} / दिन
                  </Badge>
                </div>

                <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1" data-testid="worker-attendance-list">
                  {data.attendance.length === 0 && (
                    <p className="text-sm text-slate-400 py-12 text-center">अभी कोई हाज़िरी दर्ज नहीं है।</p>
                  )}
                  {data.attendance.map((a) => (
                    <div
                      key={a.date}
                      className="flex items-center justify-between p-3.5 rounded-2xl bg-stone-50 border border-stone-100 hover:bg-stone-100/60 transition-colors"
                    >
                      <span className="font-mono text-sm font-semibold text-slate-800">{a.date}</span>
                      <span className={`text-xs px-3 py-1 rounded-full border ${statusStyle[a.status]}`}>
                        {statusHindi[a.status] || a.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. MONEY TAB */}
            {tab === "money" && (
              <div className="space-y-6">
                {/* Financial Overview Card */}
                <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm">
                  <h2 className="font-display text-xl font-bold text-slate-900 mb-4">
                    पैसा और हिसाब / Financial Summary
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-4 rounded-2xl bg-stone-50 border border-stone-100">
                      <span className="text-xs text-slate-500">मासिक वेतन</span>
                      <p className="font-bold text-lg text-slate-900 mt-1">{money(data.summary.monthly_salary)}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-teal-50 border border-teal-100">
                      <span className="text-xs text-teal-800 font-semibold">कमाई (Earned)</span>
                      <p className="font-bold text-lg text-teal-900 mt-1">{money(data.summary.earned_salary)}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100">
                      <span className="text-xs text-amber-900 font-semibold">पेशगी (Advance)</span>
                      <p className="font-bold text-lg text-amber-900 mt-1">{money(data.summary.advance_taken)}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-[#102f2c] text-white">
                      <span className="text-xs text-amber-300 font-bold">बाकी पैसा</span>
                      <p className="font-bold text-xl text-amber-300 mt-1">{money(data.summary.remaining_payable)}</p>
                    </div>
                  </div>
                </div>

                {/* Payments & Advances List */}
                <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm">
                  <h3 className="font-display font-bold text-lg text-slate-900 mb-4">
                    भुगतान विवरण / Payments & Advances
                  </h3>
                  <div className="space-y-2 max-h-[50vh] overflow-y-auto" data-testid="worker-payments-list">
                    {data.payments.length === 0 && (
                      <p className="text-sm text-slate-400 py-8 text-center">कोई भुगतान रिकॉर्ड नहीं मिला।</p>
                    )}
                    {data.payments.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between p-3.5 rounded-2xl bg-stone-50 border border-stone-100"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                                p.type === "ADVANCE"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-teal-100 text-teal-800"
                              }`}
                            >
                              {p.type === "ADVANCE" ? "पेशगी (Advance)" : "वेतन (Salary)"}
                            </span>
                            <span className="font-mono text-xs text-slate-500">{p.date}</span>
                          </div>
                          {p.note && <p className="text-xs text-slate-500 mt-1">{p.note}</p>}
                        </div>
                        <span
                          className={`font-display font-bold text-base ${
                            p.type === "ADVANCE" ? "text-amber-800" : "text-teal-800"
                          }`}
                        >
                          {money(p.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Extra Work List */}
                <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm">
                  <h3 className="font-display font-bold text-lg text-slate-900 mb-4">
                    अतिरिक्त काम / Extra Work
                  </h3>
                  <div className="space-y-2 max-h-[40vh] overflow-y-auto" data-testid="worker-extra-list">
                    {data.extra_work.length === 0 && (
                      <p className="text-sm text-slate-400 py-6 text-center">कोई अतिरिक्त काम नहीं है।</p>
                    )}
                    {data.extra_work.map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center justify-between p-3.5 rounded-2xl bg-stone-50 border border-stone-100"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{e.description}</p>
                          <p className="text-xs text-slate-500 font-mono mt-0.5">{e.date}</p>
                        </div>
                        <span className="font-display font-bold text-indigo-700">{money(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 4. MESSAGES / CHAT TAB */}
            {tab === "messages" && (
              <div className="chat-shell bg-white border border-stone-200 rounded-3xl shadow-md overflow-hidden flex flex-col">
                {/* Chat Header */}
                    <div className="p-3 sm:p-4 border-b border-stone-200 bg-[#102f2c] text-white flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold">
                      <HardHat className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-display font-bold text-sm sm:text-base text-white truncate">
                        मालिक से बातचीत / Chat with Owner
                      </h2>
                      <p className="text-xs text-teal-300">
                        {data?.business?.name || "ठेकेदार / मालिक"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Message Log */}
                <div ref={messageListRef} onScroll={handleMessageScroll} className="chat-thread flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 bg-[#fcfbfa]">
                  {messages.length === 0 && (
                    <div className="h-full flex items-center justify-center text-center text-slate-400 text-sm">
                      <div>
                        <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40 text-teal-800" />
                        <p>मालिक को संदेश या आवाज़ नोट भेजें।</p>
                      </div>
                    </div>
                  )}

                  {messages.map((m, index) => {
                    const isWorker = m.sender_type === "worker";
                    const showSender = index === 0 || messages[index - 1].sender_type !== m.sender_type;
                    return (
                      <div key={m.id}>
                        {m.id === firstUnreadId && <div className="chat-new-divider" role="separator"><span>New Messages</span></div>}
                        <div className={`flex flex-col ${isWorker ? "items-end" : "items-start"}`}>
                          {showSender && <span className="text-[10px] text-slate-400 mb-1 px-1">
                            {isWorker ? "आप (You)" : "मालिक (Owner)"}
                          </span>}

                          {m.message_type === "audio" ? (
                            <AudioPlayer audioUrl={m.audio_url} duration={m.duration} />
                          ) : (
                            <div className={`chat-bubble rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                                isWorker ? "bg-teal-800 text-white rounded-br-none" : "bg-white text-slate-900 border border-stone-200 rounded-bl-none"
                              }`}>
                              {m.text}
                            </div>
                          )}
                          <span className="min-h-[14px] text-[10px] leading-[14px] text-slate-400 mt-0.5 px-1 tabular-nums">
                            {m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}
                            {isWorker ? ` · ${m.read_at ? "Seen" : "Sent"}` : ""}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Chat Action Area */}
                <div className="chat-composer p-3 bg-white border-t border-stone-200 space-y-2 shrink-0">
                  {showRecorder ? (
                    <VoiceRecorder
                      conversationId={chatConv.conversation_id}
                      isAdmin={false}
                      onSend={handleSendAudio}
                      onCancel={() => setShowRecorder(false)}
                    />
                  ) : (
                    <form onSubmit={handleSendText} className="chat-composer-form flex items-center gap-2 min-w-0">
                      {/* Voice Note Record */}
                      <button
                        type="button"
                        onClick={() => setShowRecorder(true)}
                        title="आवाज़ भेजें / Send audio note"
                        className="p-2.5 rounded-xl border border-stone-200 bg-amber-50 text-amber-900 hover:bg-amber-100 flex items-center gap-1 text-xs font-bold shrink-0 transition-colors"
                      >
                        <Mic className="h-4 w-4 text-amber-700" />
                        <span className="hidden sm:inline">आवाज़ भेजें</span>
                      </button>

                      {/* Mic to text / Speech typing */}
                      <SpeechTyping
                        currentText={msgText}
                        onSpeechResult={(transcript) => setMsgText(transcript)}
                        disabled={showRecorder}
                      />

                      {/* Text Input */}
                      <Input
                        placeholder="संदेश लिखें / Type message..."
                        value={msgText}
                        onChange={(e) => setMsgText(e.target.value)}
                        className="rounded-xl h-10 text-sm min-w-0 flex-1"
                      />

                      <Button
                        type="submit"
                        disabled={sendingMsg || !msgText.trim()}
                        className="bg-teal-800 hover:bg-teal-900 rounded-xl h-10 px-4 font-bold shrink-0"
                      >
                        {sendingMsg ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Change Password Modal */}
      {changePwdOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 relative">
            <button
              onClick={() => setChangePwdOpen(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="h-11 w-11 rounded-2xl bg-teal-900 text-white flex items-center justify-center mb-4">
              <Lock className="h-5 w-5" />
            </div>

            <h2 className="font-display text-lg font-bold text-slate-900">
              पासवर्ड बदलें / Change Password
            </h2>
            <p className="text-xs text-slate-500 mt-1 mb-5">
              अपना नया पासवर्ड कम से कम 8 अक्षरों का रखें।
            </p>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (changePwdForm.next.length < 8) {
                  toast.error("New password must be at least 8 characters");
                  return;
                }
                if (changePwdForm.next !== changePwdForm.confirm) {
                  toast.error("Passwords do not match / पासवर्ड मेल नहीं खा रहे");
                  return;
                }
                setChangePwdLoading(true);
                try {
                  await changePassword(changePwdForm.current, changePwdForm.next);
                  toast.success("Password changed! / पासवर्ड बदल गया!");
                  setChangePwdOpen(false);
                } catch (err) {
                  toast.error(apiError(err));
                } finally {
                  setChangePwdLoading(false);
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  पुराना पासवर्ड / Current Password
                </label>
                <div className="relative">
                  <Input
                    type={showChangePwd ? "text" : "password"}
                    required
                    value={changePwdForm.current}
                    onChange={(e) => setChangePwdForm({ ...changePwdForm, current: e.target.value })}
                    className="pr-10 h-10 rounded-xl text-sm font-mono"
                    placeholder="••••••••"
                  />
                  <button type="button" onClick={() => setShowChangePwd(!showChangePwd)} className="absolute right-3 top-2.5 text-slate-400">
                    {showChangePwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  नया पासवर्ड / New Password
                </label>
                <Input
                  type={showChangePwd ? "text" : "password"}
                  required
                  value={changePwdForm.next}
                  onChange={(e) => setChangePwdForm({ ...changePwdForm, next: e.target.value })}
                  className="h-10 rounded-xl text-sm font-mono"
                  placeholder="Min 8 chars"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  दोबारा पासवर्ड / Confirm
                </label>
                <Input
                  type={showChangePwd ? "text" : "password"}
                  required
                  value={changePwdForm.confirm}
                  onChange={(e) => setChangePwdForm({ ...changePwdForm, confirm: e.target.value })}
                  className="h-10 rounded-xl text-sm font-mono"
                  placeholder="••••••••"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setChangePwdOpen(false)} className="flex-1 rounded-xl text-xs">
                  रद्द करें
                </Button>
                <Button type="submit" disabled={changePwdLoading} className="flex-1 bg-teal-800 hover:bg-teal-900 text-white rounded-xl text-xs font-bold">
                  {changePwdLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  सेट करें
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
