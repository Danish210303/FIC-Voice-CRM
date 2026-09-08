import React, { useState, useEffect, useRef } from "react";
import { CustomSelect } from "./CustomSelect";
import { CustomPauseIcon } from "./CustomPauseIcon";
import {
  Mic,
  MicOff,
  Pause,
  Play,
  Phone,
  PhoneOff,
  Users,
  Volume2,
  Share2,
  Sparkles,
  Clock,
  Activity,
  FileText,
  Tag,
  ShieldAlert,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Send,
  TrendingUp,
  User,
  Mail,
  MapPin,
  Building2,
  Globe,
  Radio,
  Wifi,
  Terminal,
  Zap,
  HelpCircle,
  X
} from "lucide-react";

interface LiveCallModalProps {
  activeCall: any;
  activeCallTimer: number;
  activeCallMuted: boolean;
  activeCallHold: boolean;
  activeCallTranscript: any[];
  activeCallSuggestions: string[];
  activeCallSentiment: string;
  activeCallSIPLogs: string[];
  activeCallRecordingStatus: string;
  isLiveKeypadOpen: boolean;
  setIsLiveKeypadOpen: (val: boolean) => void;
  isSpeakerActive: boolean;
  setIsSpeakerActive: (val: boolean) => void;
  manualName: string;
  manualPhone: string;
  onMuteToggle: () => void;
  onHoldToggle: () => void;
  onSendDTMF: (digit: string) => void;
  onToggleRecording: () => void;
  onOpenTransfer: () => void;
  onOpenConference: () => void;
  onEndCall: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

const LEAD_STATUS_TAG_OPTIONS = [
  { value: "Qualified", label: "Qualified" },
  { value: "Warm Lead", label: "Warm Lead" },
  { value: "VIP Client", label: "VIP Client" },
  { value: "Contacted", label: "Contacted" },
  { value: "Follow-up", label: "Follow-up" }
];

export default function LiveCallModal({
  activeCall,
  activeCallTimer,
  activeCallMuted,
  activeCallHold,
  activeCallTranscript,
  activeCallSuggestions,
  activeCallSentiment,
  activeCallSIPLogs,
  activeCallRecordingStatus,
  isLiveKeypadOpen,
  setIsLiveKeypadOpen,
  isSpeakerActive,
  setIsSpeakerActive,
  manualName,
  manualPhone,
  onMuteToggle,
  onHoldToggle,
  onSendDTMF,
  onToggleRecording,
  onOpenTransfer,
  onOpenConference,
  onEndCall,
  showToast
}: LiveCallModalProps) {
  // Local states
  const [isSIPLogsOpen, setIsSIPLogsOpen] = useState(true);
  const [leadStatus, setLeadStatus] = useState("Qualified");
  const [customerNote, setCustomerNote] = useState(activeCall?.notes || "");
  const [isNoteSaved, setIsNoteSaved] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll transcript to bottom on new messages
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeCallTranscript]);

  const customerName = activeCall?.name || manualName || "Customer Lead";
  const customerPhone = activeCall?.phone || manualPhone || "+1 (555) 019-2834";
  const customerEmail = activeCall?.email || `${customerName.toLowerCase().replace(/\s+/g, ".")}@example.com`;
  const crmId = activeCall?.lead_id ? `#CRM-${activeCall.lead_id.slice(-6).toUpperCase()}` : "#CRM-884920";
  const poolName = activeCall?.pool_id ? activeCall.pool_id.replace(/_/g, " ") : "Customer Support";
  const language = activeCall?.language || "ENGLISH";
  const priority = activeCall?.priority || "medium";

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainderSecs = secs % 60;
    return `${String(mins).padStart(2, "0")}:${String(remainderSecs).padStart(2, "0")}`;
  };

  const handleSaveNote = () => {
    if (!customerNote.trim()) return;
    setIsNoteSaved(true);
    showToast("Customer note saved to CRM profile", "success");
    setTimeout(() => setIsNoteSaved(false), 2000);
  };

  const handleCopyText = (text: string, idx: number) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedIdx(idx);
    showToast("Text copied to clipboard", "info");
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  // Sentiment colors and gauge percentage
  const getSentimentInfo = () => {
    switch (activeCallSentiment?.toLowerCase()) {
      case "positive":
        return { label: "Positive", color: "bg-emerald-500", text: "text-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-500/10", percent: 85 };
      case "negative":
        return { label: "Negative", color: "bg-rose-500", text: "text-rose-400", border: "border-rose-500/30", bg: "bg-rose-500/10", percent: 25 };
      default:
        return { label: "Neutral", color: "bg-blue-500", text: "text-blue-400", border: "border-blue-500/30", bg: "bg-blue-500/10", percent: 60 };
    }
  };

  const sentiment = getSentimentInfo();

  return (
    <div className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
      <div className="bg-slate-950 border border-slate-800 text-slate-100 rounded-3xl w-full max-w-[1440px] h-[92vh] flex flex-col overflow-hidden shadow-2xl shadow-blue-950/40">
        
        {/* --- STICKY COMPACT HEADER BAR --- */}
        <div className="bg-slate-900/90 border-b border-slate-800 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 backdrop-blur-md flex-shrink-0">
          {/* Left: Call Status & Signal Health */}
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-xs text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <span>SIP Softphone Session</span>
              </h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider flex items-center gap-1 border ${
                activeCallRecordingStatus === "recording"
                  ? "bg-rose-500/20 text-rose-400 border-rose-500/30 animate-pulse"
                  : "bg-amber-500/20 text-amber-400 border-amber-500/30"
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${activeCallRecordingStatus === "recording" ? "bg-rose-500" : "bg-amber-500"}`} />
                {activeCallRecordingStatus}
              </span>
            </div>

            <div className="hidden md:flex items-center gap-1.5 ml-2 text-[11px] bg-slate-800/80 border border-slate-700/80 px-2.5 py-1 rounded-full text-slate-300 font-semibold">
              <Wifi className="h-3 w-3 text-emerald-400" />
              <span>HD Audio (Opus 24kHz)</span>
              <span className="text-slate-500">|</span>
              <span className="text-emerald-400 font-mono font-bold">MOS: 4.8</span>
            </div>
          </div>

          {/* Center: Caller Pill & Parameters */}
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700/90 px-3 py-1 rounded-xl">
              <User className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-xs font-black text-white">{customerName}</span>
              <span className="text-xs text-slate-400 font-medium">({customerPhone})</span>
            </div>

            <span className="text-[11px] bg-slate-800/80 border border-slate-700 px-2.5 py-1 rounded-xl font-bold text-slate-300 capitalize">
              Pool: {poolName}
            </span>

            <span className="text-[11px] bg-slate-800/80 border border-slate-700 px-2.5 py-1 rounded-xl font-bold text-slate-300 uppercase">
              Lang: {language}
            </span>

            <span className={`text-[11px] border px-2.5 py-1 rounded-xl font-black uppercase ${
              priority === "critical"
                ? "bg-rose-500/20 border-rose-500/30 text-rose-400"
                : priority === "high"
                ? "bg-amber-500/20 border-amber-500/30 text-amber-400"
                : "bg-blue-500/20 border-blue-500/30 text-blue-400"
            }`}>
              {priority}
            </span>
          </div>

          {/* Right: Duration Clock & Active Indicators */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3.5 py-1 rounded-xl">
              <Clock className="h-3.5 w-3.5 text-emerald-400 animate-spin" />
              <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Duration:</span>
              <span className="text-sm font-black font-mono text-emerald-400">{formatTimer(activeCallTimer)}</span>
            </div>

            {activeCallMuted && (
              <span className="text-[10px] bg-rose-500/20 text-rose-400 border border-rose-500/30 px-2 py-1 rounded-lg font-black uppercase tracking-wider animate-pulse">
                MUTED
              </span>
            )}
            {activeCallHold && (
              <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-1 rounded-lg font-black uppercase tracking-wider">
                ON HOLD
              </span>
            )}
          </div>
        </div>

        {/* --- MAIN CORE WORK AREA (THREE COLUMNS) --- */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          
          {/* ================= LEFT COLUMN: CUSTOMER & CRM DETAILS (3 cols) ================= */}
          <div className="lg:col-span-3 flex flex-col h-full overflow-y-auto p-4 space-y-4 bg-slate-900/30 border-r border-slate-800/80 softphone-scrollbar">
            
            {/* Customer Profile Header Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center font-black text-lg text-white shadow-md flex-shrink-0">
                  {customerName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-extrabold text-sm text-white truncate">{customerName}</h4>
                  <p className="text-xs text-slate-400 font-medium font-mono">{customerPhone}</p>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">{customerEmail}</p>
                </div>
              </div>

              {/* Lead Status Tag Selector */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Lead Status</span>
                <CustomSelect
                  value={leadStatus}
                  onChange={setLeadStatus}
                  options={LEAD_STATUS_TAG_OPTIONS}
                  placeholder="Select Status"
                  className="w-32"
                />
              </div>
            </div>

            {/* CRM Metadata Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2.5">
              <h5 className="text-[11px] font-black text-slate-300 uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-slate-800">
                <Building2 className="h-3.5 w-3.5 text-blue-400" />
                <span>CRM & Account Metadata</span>
              </h5>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                  <span className="text-[9px] text-slate-500 font-bold uppercase block">CRM Reference</span>
                  <span className="font-mono font-bold text-slate-200">{crmId}</span>
                </div>
                <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                  <span className="text-[9px] text-slate-500 font-bold uppercase block">Account Tier</span>
                  <span className="font-bold text-emerald-400">Enterprise Pro</span>
                </div>
                <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                  <span className="text-[9px] text-slate-500 font-bold uppercase block">Location</span>
                  <span className="font-semibold text-slate-300 flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-slate-500" />
                    <span>Mumbai, IN</span>
                  </span>
                </div>
                <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                  <span className="text-[9px] text-slate-500 font-bold uppercase block">Timezone</span>
                  <span className="font-semibold text-slate-300">IST (UTC+5:30)</span>
                </div>
              </div>
            </div>

            {/* Previous Touchpoints / History Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2.5">
              <h5 className="text-[11px] font-black text-slate-300 uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-slate-800">
                <Activity className="h-3.5 w-3.5 text-blue-400" />
                <span>Touchpoints History</span>
              </h5>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center bg-slate-950/40 p-2 rounded-xl border border-slate-800/80">
                  <span className="text-slate-400 font-medium">Total Voice Calls</span>
                  <span className="font-black text-white">4 Calls</span>
                </div>
                <div className="flex justify-between items-center bg-slate-950/40 p-2 rounded-xl border border-slate-800/80">
                  <span className="text-slate-400 font-medium">Last Interaction</span>
                  <span className="font-bold text-slate-300">Yesterday, 16:30</span>
                </div>
                <div className="flex justify-between items-center bg-slate-950/40 p-2 rounded-xl border border-slate-800/80">
                  <span className="text-slate-400 font-medium">Lead Health Score</span>
                  <span className="font-black text-emerald-400">92 / 100</span>
                </div>
              </div>
            </div>

            {/* Editable Notes Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2 flex-1 flex flex-col">
              <div className="flex justify-between items-center pb-1 border-b border-slate-800">
                <h5 className="text-[11px] font-black text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-blue-400" />
                  <span>Agent Live Session Notes</span>
                </h5>
                {isNoteSaved && (
                  <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Saved
                  </span>
                )}
              </div>

              <textarea
                value={customerNote}
                onChange={(e) => setCustomerNote(e.target.value)}
                placeholder="Type real-time conversation notes, customer requirements, or key objections..."
                className="w-full flex-1 min-h-[90px] bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium resize-none softphone-scrollbar"
              />

              <button
                onClick={handleSaveNote}
                className="w-full py-1.5 bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/30 text-blue-300 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Save Session Note</span>
              </button>
            </div>

            {/* Customer Tags */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Customer Tags</span>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] bg-blue-500/10 border border-blue-500/30 text-blue-400 px-2 py-0.5 rounded-md font-bold">#HighPriority</span>
                <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-md font-bold">#InboundLead</span>
                <span className="text-[10px] bg-purple-500/10 border border-purple-500/30 text-purple-400 px-2 py-0.5 rounded-md font-bold">#ProductDemo</span>
              </div>
            </div>

          </div>

          {/* ================= CENTER COLUMN: LIVE CONVERSATION & SIGNALING (5 cols) ================= */}
          <div className="lg:col-span-5 flex flex-col h-full overflow-hidden p-4 space-y-3 bg-slate-950/60 border-r border-slate-800/80">
            
            {/* Live Audio Waveform & RTP Visualizer Bar */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <Radio className="h-4 w-4 animate-pulse" />
                </div>
                <div>
                  <span className="text-xs font-extrabold text-slate-200 block">RTP Voice Stream Visualizer</span>
                  <span className="text-[10px] text-slate-400 font-medium">Whisper-ASR Pipeline Active • 24kHz Audio</span>
                </div>
              </div>

              {/* Animated Equalizer Bars */}
              <div className="flex items-end gap-1 h-6 px-3 py-1 bg-slate-950 rounded-xl border border-slate-800">
                <div className="w-1 bg-blue-500 rounded-full animate-equalizer" style={{ animationDelay: "0.1s" }}></div>
                <div className="w-1 bg-blue-400 rounded-full animate-equalizer" style={{ animationDelay: "0.4s" }}></div>
                <div className="w-1 bg-emerald-400 rounded-full animate-equalizer" style={{ animationDelay: "0.2s" }}></div>
                <div className="w-1 bg-blue-500 rounded-full animate-equalizer" style={{ animationDelay: "0.5s" }}></div>
                <div className="w-1 bg-indigo-400 rounded-full animate-equalizer" style={{ animationDelay: "0.3s" }}></div>
                <div className="w-1 bg-blue-400 rounded-full animate-equalizer" style={{ animationDelay: "0.6s" }}></div>
              </div>
            </div>

            {/* Live Conversation Transcript Chat Box with Slide-Out DTMF Keypad */}
            <div className="flex-1 flex gap-3 overflow-hidden min-h-0 relative">
              
              {/* Transcript Bubble Container */}
              <div className="flex-1 overflow-y-auto space-y-3 p-3 bg-slate-900/50 rounded-2xl border border-slate-800/80 softphone-scrollbar flex flex-col justify-end">
                {activeCallTranscript.length === 0 ? (
                  <div className="text-center py-16 text-slate-500 space-y-3 my-auto">
                    <Activity className="h-10 w-10 mx-auto text-blue-500/50 animate-pulse" />
                    <div>
                      <p className="text-xs font-extrabold uppercase tracking-wider text-slate-300">Listening for Voice Packets...</p>
                      <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">
                        Speech stream is being processed in real-time through PBX trunk nodes via Whisper-ASR & Gemini LLM.
                      </p>
                    </div>
                  </div>
                ) : (
                  activeCallTranscript.map((t, idx) => {
                    const isCustomer = t.speaker === "customer";
                    return (
                      <div
                        key={idx}
                        className={`flex flex-col max-w-[85%] ${
                          isCustomer ? "self-start items-start" : "self-end items-end"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1 px-1">
                          <span className={`text-[10px] font-black uppercase tracking-wider ${
                            isCustomer ? "text-slate-400" : "text-blue-400"
                          }`}>
                            {isCustomer ? customerName : "AI Agent / You"}
                          </span>
                          <span className="text-[9px] text-slate-500 font-mono">
                            {t.time || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>

                        <div className={`p-3.5 rounded-2xl text-xs font-medium leading-relaxed relative group ${
                          isCustomer
                            ? "bg-slate-850 text-slate-100 rounded-tl-none border border-slate-750 shadow-sm"
                            : "bg-gradient-to-r from-blue-700 to-blue-600 text-white rounded-tr-none shadow-md"
                        }`}>
                          <p>{t.text}</p>

                          <button
                            onClick={() => handleCopyText(t.text, idx)}
                            className="absolute top-2 right-2 p-1 bg-slate-900/80 rounded opacity-0 group-hover:opacity-100 transition text-slate-400 hover:text-white"
                            title="Copy transcript text"
                          >
                            {copiedIdx === idx ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={transcriptEndRef} />
              </div>

              {/* Integrated DTMF Keypad Overlay Drawer */}
              {isLiveKeypadOpen && (
                <div className="w-56 bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col space-y-3 justify-between shadow-2xl animate-scale-in z-10 flex-shrink-0">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                    <span className="text-[10px] text-slate-300 font-extrabold uppercase tracking-wider flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-emerald-400" />
                      <span>DTMF Keypad</span>
                    </span>
                    <button
                      onClick={() => setIsLiveKeypadOpen(false)}
                      className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5 flex-1 items-center">
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((digit) => (
                      <button
                        key={digit}
                        onClick={() => onSendDTMF(digit)}
                        className="bg-slate-900 border-2 border-blue-500/30 hover:border-[#60A5FA] dark:hover:shadow-[0_0_14px_rgba(59,130,246,0.4)] active:scale-95 active:bg-gradient-to-br active:from-[#1D4ED8] active:via-[#2563EB] active:to-[#F4B400] text-white font-extrabold h-11 w-full rounded-full flex items-center justify-center transition-all duration-200 text-sm shadow-sm cursor-pointer"
                      >
                        {digit}
                      </button>
                    ))}
                  </div>

                  <p className="text-[9px] text-slate-500 text-center font-semibold pt-1">
                    Press keys to send SIP INFO tones
                  </p>
                </div>
              )}
            </div>

            {/* Collapsible Asterisk / SIP Signaling Console */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 flex flex-col flex-shrink-0">
              <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-[10px] font-black text-slate-300 uppercase tracking-wider">
                    Asterisk PBX / SIP Trunk Signaling Trace
                  </span>
                  <span className="text-[9px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono font-bold">
                    {activeCallSIPLogs.length} events
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                    Node: Active
                  </span>
                  <button
                    onClick={() => setIsSIPLogsOpen(!isSIPLogsOpen)}
                    className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                  >
                    {isSIPLogsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {isSIPLogsOpen && (
                <div className="h-28 overflow-y-auto text-[10px] font-mono text-emerald-400/90 space-y-1 pr-1 bg-slate-950 p-2 rounded-xl border border-slate-900 softphone-scrollbar selection:bg-emerald-500 selection:text-black">
                  {activeCallSIPLogs.length === 0 ? (
                    <div className="text-slate-600 text-center py-6 font-mono text-[10px]">
                      [SIP TRUNK] Initialized channel session... Awaiting signaling messages.
                    </div>
                  ) : (
                    activeCallSIPLogs.map((log, idx) => (
                      <div key={idx} className="leading-relaxed flex items-start gap-1.5">
                        <span className="text-slate-600 font-bold select-none">&gt;</span>
                        <span>{log}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

          </div>

          {/* ================= RIGHT COLUMN: AI COPILOT & SOFTPHONE CONTROLS (4 cols) ================= */}
          <div className="lg:col-span-4 flex flex-col h-full overflow-y-auto p-4 space-y-4 bg-slate-900/30 softphone-scrollbar">
            
            {/* Real-Time Sentiment Gauge Card */}
            <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl space-y-3">
              <div className="flex justify-between items-center">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Caller Real-Time Sentiment</span>
                  <span className="text-xs font-black text-white mt-0.5 block">Live Emotion Engine</span>
                </div>
                <span className={`px-3 py-1 rounded-xl font-black text-xs uppercase border ${sentiment.bg} ${sentiment.border} ${sentiment.text}`}>
                  {sentiment.label}
                </span>
              </div>

              {/* Visual Sentiment Progress Bar */}
              <div className="space-y-1">
                <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full ${sentiment.color} transition-all duration-500`}
                    style={{ width: `${sentiment.percent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-slate-500 font-bold uppercase">
                  <span>Negative</span>
                  <span>Neutral</span>
                  <span>Positive</span>
                </div>
              </div>
            </div>

            {/* AI Copilot & Next-Best Action Box */}
            <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col space-y-3 shadow-lg shadow-blue-950/20">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h4 className="font-extrabold text-xs text-white flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-400 animate-pulse" />
                  <span>AI Copilot Suggestions & Intent</span>
                </h4>
                <span className="text-[10px] bg-blue-500/20 border border-blue-500/30 text-blue-300 px-2 py-0.5 rounded font-black">
                  95% Confidence
                </span>
              </div>

              {/* Detected Intent Pill */}
              <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-xl flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium text-[11px]">Detected Intent:</span>
                <span className="font-black text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 rounded-lg">
                  Billing & Plan Upgrade
                </span>
              </div>

              {/* Suggestions List */}
              <div className="space-y-2 max-h-44 overflow-y-auto pr-1 softphone-scrollbar text-xs text-slate-300 font-medium">
                {activeCallSuggestions.length === 0 ? (
                  <p className="text-slate-500 text-center py-6 font-semibold">AI Copilot analysis pipeline syncing...</p>
                ) : (
                  activeCallSuggestions.map((sugg, idx) => (
                    <div key={idx} className="p-2.5 bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-xl space-y-1.5 transition">
                      <div className="flex items-start gap-2">
                        <span className="text-amber-400 font-black font-mono">{idx + 1}.</span>
                        <p className="flex-1 leading-relaxed text-[11px] text-slate-200">{sugg}</p>
                      </div>
                      <button
                        onClick={() => handleCopyText(sugg, 100 + idx)}
                        className="text-[10px] text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1 ml-5 pt-1"
                      >
                        <Copy className="h-3 w-3" />
                        <span>Copy Suggestion</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Enterprise Softphone Control Pad */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
              <h5 className="text-[11px] font-black text-slate-300 uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-slate-800">
                <Phone className="h-3.5 w-3.5 text-blue-400" />
                <span>Softphone Call Controls</span>
              </h5>

              {/* 2x3 Grid of Softphone Controls */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={onMuteToggle}
                  className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition flex items-center justify-center gap-2 ${
                    activeCallMuted
                      ? "bg-rose-600 text-white shadow-md shadow-rose-600/20 animate-pulse"
                      : "bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200"
                  }`}
                >
                  {activeCallMuted ? <MicOff className="h-4 w-4 text-white" /> : <Mic className="h-4 w-4 text-slate-400" />}
                  <span>{activeCallMuted ? "Unmute Call" : "Mute Call"}</span>
                </button>

                <button
                  onClick={onHoldToggle}
                  className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition flex items-center justify-center gap-2 ${
                    activeCallHold
                      ? "bg-amber-600 text-white shadow-md shadow-amber-600/20"
                      : "bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200"
                  }`}
                >
                  {activeCallHold ? <Play className="h-4 w-4 text-white" /> : <CustomPauseIcon size={20} />}
                  <span>{activeCallHold ? "Resume Call" : "Hold Call"}</span>
                </button>

                <button
                  onClick={() => setIsLiveKeypadOpen(!isLiveKeypadOpen)}
                  className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition flex items-center justify-center gap-2 ${
                    isLiveKeypadOpen
                      ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                      : "bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200"
                  }`}
                >
                  <Phone className="h-4 w-4 text-emerald-400" />
                  <span>Keypad (DTMF)</span>
                </button>

                <button
                  onClick={onOpenConference}
                  className="py-2.5 px-3 bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200 rounded-xl text-xs font-extrabold transition flex items-center justify-center gap-2"
                >
                  <Users className="h-4 w-4 text-indigo-400" />
                  <span>Conference</span>
                </button>

                <button
                  onClick={onToggleRecording}
                  className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition flex items-center justify-center gap-2 ${
                    activeCallRecordingStatus === "paused"
                      ? "bg-slate-800 border border-slate-700 text-slate-400"
                      : "bg-rose-500/20 border border-rose-500/30 text-rose-400"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${activeCallRecordingStatus === "paused" ? "bg-slate-500" : "bg-rose-500 animate-pulse"}`} />
                  <span>{activeCallRecordingStatus === "paused" ? "Resume Rec" : "Recording"}</span>
                </button>

                <button
                  onClick={() => {
                    setIsSpeakerActive(!isSpeakerActive);
                    showToast(`Speaker Audio: ${!isSpeakerActive ? "ON" : "OFF"}`, "info");
                  }}
                  className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition flex items-center justify-center gap-2 ${
                    isSpeakerActive
                      ? "bg-blue-600 text-white shadow-md shadow-blue-600/20"
                      : "bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200"
                  }`}
                >
                  <Volume2 className="h-4 w-4 text-blue-400" />
                  <span>Speaker: {isSpeakerActive ? "ON" : "OFF"}</span>
                </button>
              </div>

              {/* Primary Call Actions */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <button
                  onClick={onOpenTransfer}
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 rounded-xl text-xs font-extrabold transition flex items-center justify-center gap-2 shadow-sm"
                >
                  <Share2 className="h-4 w-4 text-blue-400" />
                  <span>Transfer Call / Escalate to TL</span>
                </button>

                <button
                  onClick={onEndCall}
                  className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black transition flex items-center justify-center gap-2 shadow-lg shadow-rose-600/25 active:scale-[0.99]"
                >
                  <PhoneOff className="h-4.5 w-4.5" />
                  <span>End Live Call Session</span>
                </button>
              </div>
            </div>

            {/* Quick Actions Shortcuts Bar */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 space-y-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Quick Agent Actions</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => showToast("Callback request logged in CRM", "info")}
                  className="py-1.5 px-2 bg-slate-800/80 hover:bg-slate-800 text-slate-300 rounded-lg text-[11px] font-bold transition text-center"
                >
                  Request Callback
                </button>
                <button
                  onClick={() => showToast("Escalation alert sent to Supervisor", "info")}
                  className="py-1.5 px-2 bg-slate-800/80 hover:bg-slate-800 text-slate-300 rounded-lg text-[11px] font-bold transition text-center"
                >
                  Flag Supervisor
                </button>
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
