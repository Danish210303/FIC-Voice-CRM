import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import {
  Radio,
  Headphones,
  Volume2,
  Mic,
  PhoneForwarded,
  Clock,
  Search,
  PhoneOff,
  Phone,
  Sparkles,
  Brain,
  FileText,
  BookOpen,
  CheckCircle2,
  MicOff,
  ChevronLeft,
  ChevronRight,
  X,
  Bot,
  Megaphone,
  Layers,
  Pause,
  MapPin,
  RotateCcw,
  Activity,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
export type LiveCall = {
  id: string;
  lead_id: string;
  formatted_lead_id: string;
  customer_name: string;
  phone_number: string;
  location?: string;
  language: string;
  priority?: "urgent" | "high" | "medium" | "low";
  is_vip?: boolean;
  agent_id: string;
  agent_name: string;
  agent_role?: string;
  supervisor_name?: string;
  agent_status?: "speaking" | "listening" | "on_hold";
  speaker_active?: "customer" | "agent" | "ai";
  pool_id: string;
  pool_name: string;
  queue_name: string;
  campaign_name: string;
  direction: "inbound" | "outbound" | "transferred";
  timer_seconds: number;
  sentiment: "Positive" | "Neutral" | "Negative" | "High Intent";
  sentiment_score: number;
  emotion?: string;
  mos_score?: string;
  latency_ms?: string;
  queue_position?: string;
  wait_time?: string;
  ai_confidence?: string;
  win_probability?: string;
  compliance_score?: number;
  intent?: string;
  risk_level?: "Low" | "Medium" | "High";
  ai_suggestions?: string[];
  knowledge_base?: string[];
  transcript?: { speaker: string; text: string; time: string }[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${s}`;
  return `${String(m).padStart(2, "0")}:${s}`;
}

function getInitials(name: string): string {
  const parts = (name || "").trim().split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (name?.[0] || "?").toUpperCase();
}

// ─── Ripple Button ────────────────────────────────────────────────────────────
function RippleButton({
  onClick,
  className,
  style,
  children,
}: {
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = btnRef.current;
    if (!btn) return;
    const ripple = document.createElement("span");
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    ripple.style.cssText = `
      position:absolute;width:${size}px;height:${size}px;
      left:${e.clientX - rect.left - size / 2}px;
      top:${e.clientY - rect.top - size / 2}px;
      border-radius:50%;background:rgba(255,255,255,0.35);
      transform:scale(0);animation:lc-ripple 0.55s linear;pointer-events:none;
    `;
    btn.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
    onClick?.();
  };

  return (
    <button
      ref={btnRef}
      onClick={handleClick}
      style={style}
      className={`relative overflow-hidden ${className ?? ""}`}
    >

      {children}
    </button>
  );
}

// ─── Circular Sentiment Gauge ─────────────────────────────────────────────────
function SentimentGauge({ score }: { score: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(score, 100) / 100) * circ;
  const color =
    score >= 80 ? "#10B981" : score >= 60 ? "#F59E0B" : "#EF4444";

  return (
    <div className="relative flex items-center justify-center" style={{ width: 72, height: 72 }}>
      <svg
        width="72"
        height="72"
        viewBox="0 0 72 72"
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle cx="36" cy="36" r={r} fill="none" stroke="#E2E8F0" strokeWidth="5" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.7s ease" }}
        />
      </svg>
      <span
        className="absolute font-black text-[13px] font-mono"
        style={{ color }}
      >
        {score}%
      </span>
    </div>
  );
}

// ─── Animated Voice Waveform ──────────────────────────────────────────────────
function VoiceWaveform({ speaker = "customer" }: { speaker?: string }) {
  const bars = [3, 7, 5, 9, 4, 8, 3, 6, 4, 7];
  const color =
    speaker === "agent"
      ? "#2563EB"
      : speaker === "ai"
      ? "#0D9488"
      : "#10B981";

  return (
    <div
      className="flex items-center gap-[2px]"
      style={{ height: 32 }}
      aria-label="Live voice waveform"
    >
      {bars.map((h, i) => (
        <span
          key={i}
          style={{
            display: "block",
            width: 3,
            backgroundColor: color,
            borderRadius: 99,
            height: h,
            animationName: "lc-wave",
            animationDuration: `${0.7 + (i % 4) * 0.18}s`,
            animationDelay: `${i * 0.07}s`,
            animationTimingFunction: "ease-in-out",
            animationIterationCount: "infinite",
            animationDirection: "alternate",
          }}
        />
      ))}
    </div>
  );
}

// ─── Circular Timer ───────────────────────────────────────────────────────────
function CircularTimer({ seconds }: { seconds: number }) {
  return (
    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl shadow-sm">
      <Clock className="h-3.5 w-3.5 text-[#2563EB] shrink-0" />
      <span className="font-mono font-black text-slate-900 text-sm tracking-tight">
        {formatTime(seconds)}
      </span>
    </div>
  );
}

// ─── Stat Pill Component ───
function StatPill({
  label,
  value,
  valueClass = "text-slate-900 dark:text-[#F8FAFC]",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center bg-slate-50/90 dark:bg-[#172033]/80 border border-slate-100 dark:border-white/10 rounded-xl px-2.5 py-2 min-w-0 transition hover:border-blue-500/30">
      <span className="text-[9px] font-extrabold text-slate-400 dark:text-[#64748B] uppercase tracking-wider leading-none mb-1">
        {label}
      </span>
      <span className={`text-xs sm:text-sm font-black leading-none font-mono ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function LiveCallsSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 live-calls-grid">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="bg-white dark:bg-[#111827] rounded-[18px] border border-slate-200 dark:border-white/10 p-5 animate-pulse space-y-4 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="h-[56px] w-[56px] rounded-2xl bg-slate-200 dark:bg-[#172033]" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-slate-200 dark:bg-[#172033] rounded-lg w-3/4" />
              <div className="h-3 bg-slate-100 dark:bg-[#172033] rounded-lg w-1/2" />
            </div>
            <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-[#172033] shrink-0" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="h-10 bg-slate-100 dark:bg-[#172033] rounded-xl" />
            <div className="h-10 bg-slate-100 dark:bg-[#172033] rounded-xl" />
            <div className="h-10 bg-slate-100 dark:bg-[#172033] rounded-xl" />
          </div>
          <div className="h-14 bg-slate-50 dark:bg-[#172033] rounded-2xl" />
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((j) => (
              <div key={j} className="h-10 bg-slate-100 dark:bg-[#172033] rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function LiveCallsEmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="bg-white dark:bg-[#111827] backdrop-blur-md rounded-[12px] border border-slate-200/80 dark:border-white/10 p-8 sm:p-10 text-center space-y-3.5 shadow-2xs my-2 col-span-2">
      <div className="h-12 w-12 rounded-[12px] bg-blue-50 dark:bg-blue-500/15 text-[#2563EB] dark:text-[#60A5FA] flex items-center justify-center mx-auto border border-blue-100 dark:border-blue-500/30 shadow-2xs">
        <Radio className="h-6 w-6 text-[#2563EB] dark:text-[#60A5FA] animate-pulse" />
      </div>
      <div>
        <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-[#F8FAFC] tracking-tight">No Active Live Calls</h3>
        <p className="text-xs text-slate-500 dark:text-[#94A3B8] font-medium mt-1 max-w-xs mx-auto">
          No live channels match your search query or filter criteria.
        </p>
      </div>
      <button
        onClick={onReset}
        className="h-[40px] px-4 bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] text-white rounded-[10px] text-xs font-semibold transition shadow-2xs active:scale-95 cursor-pointer inline-flex items-center gap-1.5"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        <span>Reset Filters</span>
      </button>
    </div>
  );
}

// ─── Live Call Card ────────────────────────────────────────────────────────────
function LiveCallCard({
  call,
  onAction,
}: {
  call: LiveCall;
  onAction: (
    id: string,
    action: "listen" | "whisper" | "barge" | "transfer" | "hold" | "mute" | "end" | "crm"
  ) => void;
}) {
  const customerInitials = getInitials(call.customer_name);
  const agentInitials = getInitials(call.agent_name);

  const isUrgent = call.priority === "urgent";
  const isHigh = call.priority === "high";

  const priorityColors = isUrgent
    ? { bg: "bg-amber-50 dark:bg-amber-500/15", text: "text-amber-700 dark:text-[#FCD34D]", border: "border-amber-200 dark:border-amber-500/30" }
    : isHigh
    ? { bg: "bg-amber-50 dark:bg-amber-500/15", text: "text-amber-700 dark:text-[#FCD34D]", border: "border-amber-200 dark:border-amber-500/30" }
    : { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-600 dark:text-[#94A3B8]", border: "border-slate-200 dark:border-slate-700" };

  const directionColors =
    call.direction === "inbound"
      ? { bg: "bg-[#2563EB]", text: "text-white" }
      : call.direction === "outbound"
      ? { bg: "bg-purple-600", text: "text-white" }
      : { bg: "bg-teal-600", text: "text-white" };

  const sentimentColor =
    call.sentiment === "Positive" || call.sentiment === "High Intent"
      ? "#10B981"
      : call.sentiment === "Negative"
      ? "#EF4444"
      : "#F59E0B";

  const avatarBg =
    call.direction === "inbound"
      ? "linear-gradient(135deg,#2563EB 0%,#3B82F6 100%)"
      : "linear-gradient(135deg,#7C3AED 0%,#A78BFA 100%)";

  const actions: {
    key: "listen" | "whisper" | "barge" | "transfer" | "hold" | "mute" | "crm" | "end";
    label: string;
    icon: React.ReactNode;
    style: React.CSSProperties;
    hoverClass: string;
  }[] = [
    {
      key: "listen",
      label: "Listen",
      icon: <Headphones size={14} />,
      style: { background: "#EFF6FF", color: "#2563EB", border: "1px solid #BFDBFE" },
      hoverClass: "lc-btn-listen",
    },
    {
      key: "whisper",
      label: "Whisper",
      icon: <Volume2 size={14} />,
      style: { background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0" },
      hoverClass: "lc-btn-whisper",
    },
    {
      key: "barge",
      label: "Barge",
      icon: <Mic size={14} />,
      style: { background: "#FFFBEB", color: "#D97706", border: "1px solid #FDE68A" },
      hoverClass: "lc-btn-barge",
    },
    {
      key: "transfer",
      label: "Transfer",
      icon: <PhoneForwarded size={14} />,
      style: { background: "#F5F3FF", color: "#7C3AED", border: "1px solid #DDD6FE" },
      hoverClass: "lc-btn-transfer",
    },
    {
      key: "hold",
      label: "Hold",
      icon: <Pause size={14} />,
      style: { background: "#F8FAFC", color: "#475569", border: "1px solid #CBD5E1" },
      hoverClass: "lc-btn-hold",
    },
    {
      key: "mute",
      label: "Mute",
      icon: <MicOff size={14} />,
      style: { background: "#F8FAFC", color: "#475569", border: "1px solid #CBD5E1" },
      hoverClass: "lc-btn-mute",
    },
    {
      key: "crm",
      label: "AI Insights",
      icon: <Brain size={14} />,
      style: { background: "#0F172A", color: "#FACC15", border: "1px solid #334155" },
      hoverClass: "lc-btn-ai",
    },
    {
      key: "end",
      label: "End Call",
      icon: <PhoneOff size={14} />,
      style: { background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA" },
      hoverClass: "lc-btn-end",
    },
  ];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      whileHover={{ y: -4, boxShadow: "0 24px 48px rgba(37,99,235,0.12)" }}
      className="lc-card bg-white dark:bg-[#111827] rounded-[18px] border border-slate-200/80 dark:border-white/10 p-5 flex flex-col justify-between shadow-md hover:border-blue-500/40 dark:hover:border-blue-500/40 transition-all duration-250 overflow-hidden relative"
      style={{
        borderLeft: `5px solid ${call.direction === "inbound" ? "#2563EB" : call.direction === "outbound" ? "#7C3AED" : "#0D9488"}`,
      }}
    >
      {/* ── TOP SECTION ── */}
      <div className="flex items-start gap-3.5">
        {/* Customer Avatar (56px) */}
        <div className="relative shrink-0">
          <div
            className="h-[56px] w-[56px] rounded-2xl flex items-center justify-center font-black text-white text-base shadow-lg shadow-blue-500/20 border border-blue-400/30"
            style={{ background: avatarBg }}
          >
            {customerInitials}
          </div>
          {/* Online pulse dot */}
          <span
            className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-white dark:border-[#111827]"
            style={{ background: "#10B981" }}
          >
            <span
              className="absolute inset-0 rounded-full animate-ping"
              style={{ background: "#10B981", opacity: 0.6 }}
            />
          </span>
        </div>

        {/* Customer Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-black text-slate-900 dark:text-[#F8FAFC] text-base leading-tight truncate">
                {call.customer_name}
              </h3>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8] font-semibold flex items-center gap-1.5 mt-1">
                <Phone size={12} className="text-[#2563EB] dark:text-[#60A5FA] shrink-0" />
                <span className="truncate">{call.phone_number}</span>
                {call.location && (
                  <>
                    <MapPin size={11} className="text-[#2563EB] dark:text-[#60A5FA] shrink-0 ml-1" />
                    <span className="text-slate-400 dark:text-[#64748B] truncate">{call.location}</span>
                  </>
                )}
              </p>
            </div>
            {/* Lead ID */}
            <span className="font-mono text-[11px] font-extrabold text-slate-600 dark:text-[#94A3B8] bg-slate-100 dark:bg-[#172033] border border-slate-200 dark:border-white/10 px-2 py-0.5 rounded-md shrink-0 whitespace-nowrap">
              {call.formatted_lead_id}
            </span>
          </div>

          {/* Badges Row */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span
              className={`text-[10px] font-extrabold uppercase px-3 py-1 rounded-full ${directionColors.bg} ${directionColors.text}`}
            >
              {call.direction === "inbound" ? "Inbound" : call.direction === "outbound" ? "Outbound" : "Transferred"}
            </span>
            <span className="bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-[#FCD34D] border border-amber-200 dark:border-amber-500/30 text-[10px] font-extrabold px-3 py-1 rounded-full capitalize">
              {call.language}
            </span>
            <span
              className={`text-[10px] font-extrabold uppercase px-3 py-1 rounded-full border ${priorityColors.bg} ${priorityColors.text} ${priorityColors.border}`}
            >
              {isUrgent ? "Urgent" : isHigh ? "High" : call.priority || "Medium"}
            </span>
            {call.is_vip && (
              <span className="text-[10px] font-black bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-[#FCD34D] border border-amber-300 dark:border-amber-500/40 px-2.5 py-0.5 rounded-full uppercase">
                ★ VIP
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── DIVIDER ── */}
      <div className="h-px bg-slate-100 dark:bg-white/10 my-4" />

      {/* ── MIDDLE: Agent + Analytics ── */}
      <div className="flex items-stretch gap-4">
        {/* Agent Panel (left ~55%) */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Agent Row */}
          <div className="flex items-center gap-3 bg-slate-50/80 dark:bg-[#172033]/80 border border-slate-100 dark:border-white/10 rounded-2xl p-3">
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center font-black text-[#FACC15] text-sm shrink-0 shadow-sm border border-slate-700 bg-slate-900"
            >
              {agentInitials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-extrabold text-slate-900 dark:text-[#F8FAFC] text-sm truncate">
                {call.agent_name}
              </div>
              <div className="text-[11px] text-slate-400 dark:text-[#64748B] font-semibold">
                {call.agent_role || "Voice Specialist"}
              </div>
            </div>
            <VoiceWaveform speaker={call.speaker_active} />
          </div>

          {/* Queue + Timer */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-[#A78BFA] border border-purple-200 dark:border-purple-500/30 text-[10px] font-extrabold px-2.5 py-1 rounded-lg flex items-center gap-1">
                <Megaphone size={10} /> {call.pool_name}
              </span>
              <span className="bg-blue-50 dark:bg-blue-500/15 text-[#2563EB] dark:text-[#60A5FA] border border-blue-200 dark:border-blue-500/30 text-[10px] font-extrabold px-2.5 py-1 rounded-lg flex items-center gap-1">
                <Layers size={10} /> {call.queue_name}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <CircularTimer seconds={call.timer_seconds} />
              <span className="px-2 py-1 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-[#F87171] text-[10px] font-extrabold rounded-lg flex items-center gap-1 animate-pulse">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> REC
              </span>
            </div>
          </div>
        </div>

        {/* Analytics Panel (right ~40%) */}
        <div
          className="flex flex-col items-center justify-between gap-2 shrink-0 pl-4 border-l border-slate-100 dark:border-white/10"
          style={{ minWidth: 130 }}
        >
          {/* Sentiment Gauge */}
          <div className="flex flex-col items-center gap-1">
            <span className="text-[9px] font-extrabold text-slate-400 dark:text-[#64748B] uppercase tracking-widest">
              AI Sentiment
            </span>
            <SentimentGauge score={call.sentiment_score} />
            <span
              className="text-xs font-black capitalize"
              style={{ color: sentimentColor }}
            >
              {call.sentiment}
            </span>
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-2 gap-1.5 w-full">
            <StatPill
              label="AI Conf"
              value={call.ai_confidence || "98.5%"}
              valueClass="text-emerald-600 dark:text-[#34D399]"
            />
            <StatPill
              label="Win Prob"
              value={call.win_probability || "92%"}
              valueClass="text-[#2563EB] dark:text-[#60A5FA]"
            />
          </div>

          {/* MOS + Latency */}
          <div className="flex items-center gap-1.5 text-[10px] font-bold font-mono w-full justify-center">
            <span className="text-emerald-700 dark:text-[#34D399] bg-emerald-50 dark:bg-emerald-500/15 px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-500/30">
              {call.mos_score || "MOS 4.6"}
            </span>
            <span className="text-slate-600 dark:text-[#94A3B8] bg-slate-100 dark:bg-[#172033] px-2 py-1 rounded-lg border border-slate-200 dark:border-white/10">
              {call.latency_ms || "18ms"}
            </span>
          </div>
        </div>
      </div>

      {/* ── DIVIDER ── */}
      <div className="h-px bg-slate-100 dark:bg-white/10 my-4" />

      {/* ── ACTION BAR (8 Equal-Height Buttons - 44px) ── */}
      <div className="grid grid-cols-4 gap-2">
        {actions.map((action) => (
          <RippleButton
            key={action.key}
            onClick={() => onAction(call.id, action.key)}
            className={`h-[44px] flex items-center justify-center gap-1.5 text-[11px] font-extrabold rounded-[12px] transition-all duration-200 cursor-pointer shadow-xs hover:shadow-md hover:-translate-y-0.5 active:scale-95 ${action.hoverClass}`}
            style={action.style}
          >
            {action.icon}
            <span className="hidden sm:inline leading-none">{action.label}</span>
          </RippleButton>
        ))}
      </div>
    </motion.div>
  );
}

// ─── AI Insights Drawer ────────────────────────────────────────────────────────
function AIInsightsDrawer({
  call,
  onClose,
}: {
  call: LiveCall;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="bg-white dark:bg-[#111827] rounded-[20px] p-5 shadow-2xl border border-slate-200 dark:border-white/10 space-y-4 font-sans self-start sticky top-5"
    >
      <div className="flex justify-between items-start border-b border-slate-100 dark:border-white/10 pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-900 dark:bg-[#172033] text-[#FACC15] rounded-xl border border-amber-400/30 lc-ai-glow">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-black text-slate-900 dark:text-[#F8FAFC] text-base leading-tight">
              {call.customer_name}
            </h3>
            <span className="text-xs font-mono font-bold text-slate-400 dark:text-[#64748B]">
              {call.formatted_lead_id}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-[#172033] cursor-pointer transition"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Intent */}
      <div className="p-3 bg-blue-50/80 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30 rounded-xl space-y-1">
        <div className="text-[11px] font-extrabold text-[#2563EB] dark:text-[#60A5FA] uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" /> Customer Intent Detected
        </div>
        <p className="text-xs font-bold text-slate-900 dark:text-[#F8FAFC]">
          {call.intent || "Product limit inquiry & rate negotiation"}
        </p>
      </div>

      {/* AI Suggestions */}
      <div className="space-y-2">
        <div className="text-xs font-black text-slate-800 dark:text-[#F8FAFC] uppercase tracking-wider flex items-center gap-1.5">
          <Bot className="h-4 w-4 text-emerald-600 dark:text-[#34D399]" />
          Next Best Action Prompts
        </div>
        <div className="space-y-1.5">
          {(
            call.ai_suggestions || [
              "Offer first-year annual fee waiver",
              "Mention 100% digital e-KYC approval link",
            ]
          ).map((sug, i) => (
            <div
              key={i}
              className="p-2.5 bg-slate-50 dark:bg-[#172033] border border-slate-200 dark:border-white/10 rounded-xl text-xs font-semibold text-slate-700 dark:text-[#CBD5E1] flex items-start gap-2"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              {sug}
            </div>
          ))}
        </div>
      </div>

      {/* Knowledge Base */}
      {call.knowledge_base && call.knowledge_base.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-black text-slate-800 dark:text-[#F8FAFC] uppercase tracking-wider flex items-center gap-1.5">
            <BookOpen className="h-4 w-4 text-purple-600 dark:text-[#A78BFA]" />
            Knowledge Base Solutions
          </div>
          <div className="space-y-1">
            {call.knowledge_base.map((kb, idx) => (
              <div
                key={idx}
                className="p-2.5 bg-purple-50 dark:bg-purple-500/15 border border-purple-200 dark:border-purple-500/30 rounded-xl text-xs font-bold text-purple-800 dark:text-[#D8B4FE]"
              >
                {kb}
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────
const PAGE_SIZE = 4;

function Pagination({
  total,
  page,
  onPage,
}: {
  total: number;
  page: number;
  onPage: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between mt-6 bg-white dark:bg-[#111827] border border-slate-200/80 dark:border-white/10 rounded-[18px] p-4 shadow-sm text-xs font-semibold text-slate-600 dark:text-[#94A3B8]">
      <span>
        Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} Live Channels
      </span>

      <div className="flex items-center gap-2 font-bold">
        <button
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
          className="h-9 px-3 border border-slate-200 dark:border-white/10 rounded-xl bg-white dark:bg-[#172033] text-slate-700 dark:text-[#F8FAFC] disabled:opacity-40 cursor-pointer hover:bg-slate-100 dark:hover:bg-[#1F2B45] transition flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Prev
        </button>

        <span className="px-2 font-mono text-slate-900 dark:text-[#F8FAFC]">
          {page} / {totalPages}
        </span>

        <button
          disabled={page === totalPages}
          onClick={() => onPage(page + 1)}
          className="h-9 px-3 border border-slate-200 dark:border-white/10 rounded-xl bg-white dark:bg-[#172033] text-slate-700 dark:text-[#F8FAFC] disabled:opacity-40 cursor-pointer hover:bg-slate-100 dark:hover:bg-[#1F2B45] transition flex items-center gap-1"
        >
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function LiveCalls() {
  const { showToast } = useToast();

  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [chipFilter, setChipFilter] = useState("all");
  const [selectedDrawerCall, setSelectedDrawerCall] = useState<LiveCall | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const tabsRef = useRef<HTMLDivElement>(null);
  const [showScrollLeft, setShowScrollLeft] = useState(false);
  const [showScrollRight, setShowScrollRight] = useState(false);

  const checkScrollability = useCallback(() => {
    if (tabsRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabsRef.current;
      setShowScrollLeft(scrollLeft > 5);
      setShowScrollRight(scrollLeft < scrollWidth - clientWidth - 5);
    }
  }, []);

  const handleScrollTabs = (direction: "left" | "right") => {
    if (tabsRef.current) {
      const scrollAmount = direction === "left" ? -260 : 260;
      tabsRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
      setTimeout(checkScrollability, 300);
    }
  };

  const handleWheelTabs = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0 && tabsRef.current) {
      tabsRef.current.scrollBy({ left: e.deltaY > 0 ? 180 : -180, behavior: "smooth" });
      checkScrollability();
    }
  };

  const fetchLiveCalls = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get("/api/calls/live");
      setCalls(data);
    } catch (err: any) {
      showToast(err.message || "Failed to fetch live calls", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchLiveCalls();
  }, [fetchLiveCalls]);

  // Live timer tick
  useEffect(() => {
    const timer = setInterval(() => {
      setCalls((prev) =>
        prev.map((c) => ({
          ...c,
          timer_seconds: c.timer_seconds + 1,
        }))
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleControlAction = (
    id: string,
    action: "listen" | "whisper" | "barge" | "transfer" | "hold" | "mute" | "end" | "crm"
  ) => {
    const targetCall = calls.find((c) => c.id === id);
    if (!targetCall) return;

    if (action === "crm") {
      setSelectedDrawerCall(selectedDrawerCall?.id === id ? null : targetCall);
      showToast(`Loading AI Insights telemetry for ${targetCall.customer_name}...`, "info");
      return;
    }

    const actionLabels: Record<string, string> = {
      listen: "Silent Monitoring initiated",
      whisper: "Supervisor Whisper activated",
      barge: "Barging into active call",
      transfer: "Call Transfer console opened",
      hold: "Call placed on hold",
      mute: "Channel muted",
      end: "Terminating live call session",
    };

    showToast(`${actionLabels[action]} for Call ${targetCall.formatted_lead_id}`, "success");

    if (action === "end") {
      api.post(`/api/calls/${id}/force-end`)
        .then(() => {
          setCalls((prev) => prev.filter((c) => c.id !== id));
        })
        .catch((err: any) => {
          showToast(err.response?.data?.detail || err.message || "Failed to force end call", "error");
        });
    }
  };

  const filteredCalls = useMemo(() => {
    return calls.filter((call) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        call.customer_name.toLowerCase().includes(q) ||
        call.phone_number.includes(q) ||
        call.agent_name.toLowerCase().includes(q) ||
        call.formatted_lead_id.toLowerCase().includes(q) ||
        call.pool_name.toLowerCase().includes(q);

      let matchesChip = true;
      if (chipFilter === "inbound") matchesChip = call.direction === "inbound";
      if (chipFilter === "outbound") matchesChip = call.direction === "outbound";
      if (chipFilter === "high") matchesChip = call.priority === "high";
      if (chipFilter === "urgent") matchesChip = call.priority === "urgent";
      if (chipFilter === "active")
        matchesChip = (call as any).agent_status !== "on_hold";

      return matchesSearch && matchesChip;
    });
  }, [calls, searchQuery, chipFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, chipFilter]);

  const paginatedCalls = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredCalls.slice(start, start + PAGE_SIZE);
  }, [filteredCalls, currentPage]);

  const chipOptions = [
    { id: "all",      label: "All Calls",     activeClass: "bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white shadow-md shadow-blue-500/25" },
    { id: "inbound",  label: "Inbound",        activeClass: "bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white shadow-md shadow-blue-500/25" },
    { id: "outbound", label: "Outbound",       activeClass: "bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white shadow-md shadow-blue-500/25" },
    { id: "high",     label: "High Priority",  activeClass: "bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white shadow-md shadow-blue-500/25" },
    { id: "urgent",   label: "Urgent",         activeClass: "bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white shadow-md shadow-blue-500/25" },
    { id: "active",   label: "Active",         activeClass: "bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white shadow-md shadow-blue-500/25" },
  ];

  return (
    <>
      <style>{`
        @keyframes lc-ripple {
          to { transform: scale(1); opacity: 0; }
        }
        @keyframes lc-wave {
          from { transform: scaleY(0.3); }
          to   { transform: scaleY(1.4); }
        }

        /* Button hover overrides */
        .lc-btn-listen:hover  { background:#2563EB !important; color:#fff !important; border-color:#2563EB !important; }
        .lc-btn-whisper:hover { background:#059669 !important; color:#fff !important; border-color:#059669 !important; }
        .lc-btn-barge:hover   { background:#D97706 !important; color:#fff !important; border-color:#D97706 !important; }
        .lc-btn-transfer:hover{ background:#7C3AED !important; color:#fff !important; border-color:#7C3AED !important; }
        .lc-btn-hold:hover    { background:#334155 !important; color:#fff !important; border-color:#334155 !important; }
        .lc-btn-mute:hover    { background:#334155 !important; color:#fff !important; border-color:#334155 !important; }
        .lc-btn-ai:hover      { background:#1E293B !important; color:#FACC15 !important; box-shadow:0 0 16px rgba(250,204,21,0.35); }
        .lc-btn-end:hover     { background:#DC2626 !important; color:#fff !important; border-color:#DC2626 !important; }

        /* AI Insights glow pulse */
        .lc-ai-glow {
          animation: lc-ai-pulse 2.4s ease-in-out infinite;
        }
        @keyframes lc-ai-pulse {
          0%,100% { box-shadow:0 0 0 0 rgba(250,204,21,0); }
          50%      { box-shadow:0 0 0 6px rgba(250,204,21,0.25); }
        }

        /* Responsive 2-col grid */
        .live-calls-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 24px;
        }
        @media (max-width: 900px) {
          .live-calls-grid {
            grid-template-columns: 1fr;
          }
        }

        .lc-card {
          height: 100%;
          box-sizing: border-box;
        }
      `}</style>

      <div className="space-y-5 max-w-[1600px] mx-auto w-full font-sans pb-16">

        {/* ─── 1. HEADER (60px Min Height, 12px Radius) ─── */}
        <div className="bg-gradient-to-r from-white via-slate-50 to-blue-50/20 dark:from-[#131C2F] dark:to-[#18243A] backdrop-blur-xl rounded-[12px] p-3.5 sm:p-4 min-h-[60px] border border-slate-200/80 dark:border-white/10 shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-3 relative overflow-hidden">
          <div className="flex items-center gap-3.5 relative z-10">
            {/* Rounded Square Icon Container */}
            <div className="h-9 w-9 rounded-lg bg-gradient-to-tr from-[#2563EB] to-[#3B82F6] text-white flex items-center justify-center shrink-0 shadow-sm border border-blue-400/30 relative">
              <Radio className="h-4.5 w-4.5 animate-pulse text-white drop-shadow-xs" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                <div className="flex flex-col items-start">
                  <h1 className="text-lg sm:text-xl font-extrabold tracking-tight leading-tight flex items-center gap-1.5">
                    <span className="text-[#1D4ED8] dark:text-[#3B82F6] font-extrabold">Live Call</span>
                    <span className="text-[#F4B400] font-extrabold">Console</span>
                  </h1>
                </div>
                <span className="bg-white dark:bg-[#0F172A] border border-[#2563EB]/40 dark:border-blue-400/40 text-[#1D4ED8] dark:text-[#60A5FA] text-[9px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-2xs inline-flex items-center gap-1 shrink-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#F4B400] animate-pulse"></span>
                  LIVE TELEMETRY
                </span>
              </div>
              <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8] font-medium">
                Real-time contact center channels &amp; AI telemetry
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full md:w-auto justify-end relative z-10">
            <span className="text-xs font-bold text-slate-600 dark:text-[#94A3B8] bg-slate-100 dark:bg-[#18243A] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 shadow-2xs">
              Showing <strong className="text-slate-900 dark:text-[#F8FAFC] font-mono">{filteredCalls.length}</strong> of {calls.length} Active Calls
            </span>
            <button
              onClick={fetchLiveCalls}
              className="h-8 px-3 bg-slate-100 dark:bg-[#18243A] hover:bg-slate-200 dark:hover:bg-[#202F4B] text-slate-700 dark:text-[#F8FAFC] rounded-lg text-xs font-extrabold transition flex items-center gap-1.5 border border-slate-200 dark:border-white/10 shadow-xs active:scale-95 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5 text-[#2563EB] dark:text-[#60A5FA] active:rotate-180 transition-transform duration-300" />
              <span>Sync</span>
            </button>
          </div>
        </div>

        {/* ─── 2. COMPACT FILTER TOOLBAR (Search 44px & Filter Buttons 44px with 12px Radius) ────────────────────────────────────── */}
        <div className="bg-white dark:bg-[#131C2F] backdrop-blur-xl rounded-[12px] p-3 sm:p-3.5 border border-slate-200/80 dark:border-white/10 shadow-2xs flex flex-col lg:flex-row items-center justify-between gap-3">
          {/* Search Bar (44px Height & 12px Radius) */}
          <div className="relative w-full lg:w-[380px] shrink-0">
            <Search className="h-3.5 w-3.5 text-slate-400 dark:text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search leads, calls, phone, agent..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-[44px] pl-9 pr-9 border border-slate-200 dark:border-white/10 rounded-[12px] text-xs font-semibold bg-slate-50/80 dark:bg-[#18243A] focus:bg-white dark:focus:bg-[#18243A] focus:outline-none focus:border-[#2563EB] text-slate-900 dark:text-[#F8FAFC] placeholder-slate-400 dark:placeholder-[#64748B]/60 transition-all duration-200"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Filter Chips (44px Height Controls & 12px Radius) */}
          <div className="relative flex-1 min-w-0 flex items-center gap-2 w-full lg:w-auto">
            {showScrollLeft && (
              <button
                onClick={() => handleScrollTabs("left")}
                className="h-[44px] w-[44px] rounded-[12px] bg-white dark:bg-[#18243A] hover:bg-[#2563EB] hover:text-white text-slate-700 dark:text-[#F8FAFC] transition-all flex items-center justify-center shrink-0 cursor-pointer shadow-2xs border border-slate-200 dark:border-white/10 active:scale-95 z-20"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            )}

            <div
              ref={tabsRef}
              onWheel={handleWheelTabs}
              onScroll={checkScrollability}
              className="flex items-center gap-2 overflow-x-auto scroll-smooth w-full py-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex-nowrap"
            >
              {chipOptions.map((chip) => {
                const count = chip.id === "all" 
                  ? calls.length 
                  : calls.filter(c => c.direction === chip.id || c.priority === chip.id).length;

                return (
                  <button
                    key={chip.id}
                    onClick={() => setChipFilter(chip.id)}
                    className={`h-[44px] px-4 rounded-[12px] text-xs font-semibold whitespace-nowrap transition-all duration-200 ease-in-out cursor-pointer shrink-0 flex items-center justify-center gap-2 active:scale-95 ${
                      chipFilter === chip.id
                        ? "bg-gradient-to-r from-[#FACC15] to-[#EAB308] text-slate-950 font-bold shadow-xs border border-amber-300/40"
                        : "bg-white dark:bg-[#182233] text-slate-700 dark:text-[#F8FAFC] border border-amber-200/80 dark:border-amber-500/20 hover:bg-amber-50/70 dark:hover:bg-amber-500/10 hover:border-amber-300 dark:hover:border-amber-500/40 shadow-2xs"
                    }`}
                  >
                    <span>{chip.label}</span>
                    {count > 0 && (
                      <span
                        className={`h-5 min-w-[20px] px-1.5 rounded-full font-bold text-[10px] flex items-center justify-center ${
                          chipFilter === chip.id
                            ? "bg-amber-700/20 text-slate-950 shadow-2xs"
                            : "bg-amber-100/90 dark:bg-amber-500/15 text-amber-900 dark:text-[#FDE047]"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {showScrollRight && (
              <button
                onClick={() => handleScrollTabs("right")}
                className="h-[44px] w-[44px] rounded-[12px] bg-white dark:bg-[#18243A] hover:bg-[#2563EB] hover:text-white text-slate-700 dark:text-[#F8FAFC] transition-all flex items-center justify-center shrink-0 cursor-pointer shadow-2xs border border-slate-200 dark:border-white/10 active:scale-95 z-20"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}

            {(searchQuery || chipFilter !== "all") && (
              <button
                onClick={() => { setSearchQuery(""); setChipFilter("all"); }}
                className="h-[44px] px-3.5 bg-rose-50 dark:bg-rose-500/10 text-rose-600 border border-rose-200 dark:border-rose-500/20 rounded-[12px] text-xs font-bold transition hover:bg-rose-100 shrink-0 cursor-pointer flex items-center justify-center gap-1 active:scale-95"
              >
                <X className="h-3.5 w-3.5" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>

        {/* ─── 3. MAIN CONTENT ──────────────────────────────────────── */}
        <div className={`grid gap-5 ${selectedDrawerCall ? "grid-cols-1 xl:grid-cols-[1fr_380px]" : "grid-cols-1"}`}>

          {/* Cards Container */}
          <div className="min-w-0">
            {loading ? (
              <LiveCallsSkeleton />
            ) : filteredCalls.length === 0 ? (
              <div className="live-calls-grid">
                <LiveCallsEmptyState
                  onReset={() => { setSearchQuery(""); setChipFilter("all"); }}
                />
              </div>
            ) : (
              <>
                <AnimatePresence mode="popLayout">
                  <div className="live-calls-grid">
                    {paginatedCalls.map((call) => (
                      <LiveCallCard
                        key={call.id}
                        call={call}
                        onAction={handleControlAction}
                      />
                    ))}
                  </div>
                </AnimatePresence>

                <Pagination
                  total={filteredCalls.length}
                  page={currentPage}
                  onPage={setCurrentPage}
                />
              </>
            )}
          </div>

          {/* AI Insights Drawer */}
          <AnimatePresence>
            {selectedDrawerCall && (
              <AIInsightsDrawer
                call={selectedDrawerCall}
                onClose={() => setSelectedDrawerCall(null)}
              />
            )}
          </AnimatePresence>
        </div>

      </div>
    </>
  );
}
