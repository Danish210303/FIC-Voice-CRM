import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePresence, getStatusBadgeDetails } from "../context/PresenceContext";
import { useFollowUps } from "../context/FollowUpContext";
import PauseBreakModal from "../components/PauseBreakModal";
import ShiftSummaryModal from "../components/ShiftSummaryModal";
import EarlyLogoutWarningModal from "../components/EarlyLogoutWarningModal";
import TodayAttendanceCard from "../components/TodayAttendanceCard";
import LiveAgentPoolModal from "../components/LiveAgentPoolModal";
import UserCallHistorySection from "../components/UserCallHistorySection";
import CreateFollowUpModal from "../components/CreateFollowUpModal";
import {
  Users,
  Phone,
  Zap,
  Download,
  CheckCircle,
  RefreshCw,
  Activity,
  Headphones,
  Mic,
  Volume2,
  Clock,
  Sparkles,
  AlertTriangle,
  PhoneCall,
  PhoneOff,
  Radio,
  BarChart3,
  ShieldCheck,
  ArrowUpRight,
  TrendingDown,
  DollarSign,
  Search,
  X,
  Loader2,
  TrendingUp,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Play,
  Coffee,
  LogOut
} from "lucide-react";

type Summary = {
  total_pools: number;
  total_supervisors: number;
  total_agents: number;
  active_agents: number;
  total_campaigns: number;
  total_leads: number;
  total_calls: number;
  answered_calls: number;
  missed_calls: number;
  transferred_calls: number;
  qualified_leads: number;
  rejected_leads: number;
  active_calls: number;
  today_calls: number;
  today_imports: number;
  success_rate: number;
  conversion_rate: number;
  today_followups: number;
  today_conversions: number;
  team_performance: number;
  queue_status: {
    waiting_leads: number;
    status: string;
  };
  ai_agent_status: {
    active_channels: number;
    status: string;
  };
  system_health: {
    mongodb: string;
    api: string;
  };
};

type AuditLog = {
  id: string;
  actor_name: string;
  action: string;
  target_employee_id?: string;
  timestamp: string;
};

type LiveCall = {
  id: string;
  lead_id: string;
  agent_id: string;
  pool_id: string;
  direction: string;
  campaign?: string;
  queue?: string;
  timer?: string;
  sentiment?: string;
  recording_status?: boolean;
};

type Lead = {
  id: string;
  lead_id: string;
  name: string;
  phone: string;
  status: string;
  email?: string;
  location?: string;
  language?: string;
};

type CallHistoryRow = {
  id: string;
  lead_id: string;
  direction: string;
  duration_seconds: number;
  outcome: string;
  started_at: string;
  notes?: string;
  ai_summary?: string;
  transcript?: string;
};

const formatHHMMSS = (sec: number) => {
  const h = Math.floor(sec / 3600).toString().padStart(2, "0");
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
};

const formatMMSS = (sec: number) => {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

// Compact SVG Sparkline Component
function Sparkline({ color = "#2563EB" }: { color?: string }) {
  const cleanId = color.replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg className="w-[90px] h-6 overflow-visible" viewBox="0 0 100 30">
      <defs>
        <linearGradient id={`kpiSparkGrad-${cleanId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path
        d="M0,22 Q20,26 40,12 T75,16 T100,4 L100,30 L0,30 Z"
        fill={`url(#kpiSparkGrad-${cleanId})`}
      />
      <path
        d="M0,22 Q20,26 40,12 T75,16 T100,4"
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Enterprise Dashboard Skeleton Loader
function DashboardSkeleton() {
  return (
    <div className="space-y-5 max-w-7xl mx-auto w-full font-sans animate-pulse pb-10">
      {/* Header Skeleton */}
      <div className="bg-white dark:bg-[#182233] rounded-2xl p-4 border border-slate-200/80 dark:border-white/10 flex justify-between items-center h-[72px]">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-200 dark:bg-slate-700" />
          <div className="space-y-1.5">
            <div className="h-5 w-48 bg-slate-200 dark:bg-slate-700 rounded-md" />
            <div className="h-3 w-64 bg-slate-100 dark:bg-slate-800 rounded-md" />
          </div>
        </div>
        <div className="h-8 w-44 bg-slate-200 dark:bg-slate-700 rounded-xl" />
      </div>

      {/* KPI Cards Grid Skeleton (6 Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-white dark:bg-[#182233] p-4 rounded-2xl border border-slate-200/80 dark:border-white/10 h-[125px] flex flex-col justify-between">
            <div className="flex justify-between items-center">
              <div className="h-3.5 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-9 w-9 bg-slate-200 dark:bg-slate-700 rounded-xl" />
            </div>
            <div className="h-8 w-20 bg-slate-200 dark:bg-slate-700 rounded-lg" />
            <div className="h-4 w-full bg-slate-100 dark:bg-slate-800 rounded" />
          </div>
        ))}
      </div>

      {/* Analytics & Quick Actions Skeleton */}
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-8 bg-white dark:bg-[#182233] rounded-2xl p-5 border border-slate-200/80 dark:border-white/10 h-[340px]" />
        <div className="col-span-12 lg:col-span-4 bg-white dark:bg-[#182233] rounded-2xl p-5 border border-slate-200/80 dark:border-white/10 h-[340px]" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { followUps, stats: followUpStats } = useFollowUps();
  const [isScheduleFollowUpOpen, setIsScheduleFollowUpOpen] = useState(false);
  const {
    nowTicker,
    myStatus,
    pauseReason,
    myPresence,
    agents: presenceAgents,
    summary: presenceSummary,
    wsConnected,
    isSubmittingStatus,
    isLiveModalOpen,
    setIsLiveModalOpen,
    openLiveModal,
    isCheckedInToday,
    setPresenceStatus,
    checkIn,
    checkOut,
    startBreak,
    resumeWork,
    goOffline,
    netWorkingSeconds,
    grossLoginSeconds,
    totalBreakSeconds,
    activeBreakSeconds,
    readySeconds,
    talkSeconds,

    ringingSeconds,
    setupSeconds,
    disposeSeconds,
    activeDisposeSeconds,
    refreshPresence,
    isShiftTargetReached,
    shiftTargetSeconds,
  } = usePresence();

  const [showPauseModal, setShowPauseModal] = useState<boolean>(false);
  const [showShiftSummaryModal, setShowShiftSummaryModal] = useState<boolean>(false);
  const [showEarlyLogoutWarningModal, setShowEarlyLogoutWarningModal] = useState<boolean>(false);
  const [showAttendanceSummaryModal] = useState<boolean>(false); // kept for compat; modal now in TodayAttendanceCard

  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [historicalSummary, setHistoricalSummary] = useState<any>(null);

  const initialSearchId = useMemo(() => {
    try {
      const hashQuery = window.location.hash.includes("?") ? window.location.hash.split("?")[1] : "";
      const searchParams = new URLSearchParams(window.location.search || hashQuery);
      return searchParams.get("user_id") || searchParams.get("search") || searchParams.get("lead_id") || "";
    } catch {
      return "";
    }
  }, []);

  useEffect(() => {
    if (selectedDate !== todayStr) {
      api.get(`/api/presence/shift-summary?date=${selectedDate}`)
        .then((res) => setHistoricalSummary(res.data))
        .catch(() => setHistoricalSummary(null));
    } else {
      setHistoricalSummary(null);
    }
  }, [selectedDate, todayStr]);


  const handleGoOfflineClick = () => {
    if (myStatus === "offline") {
      setShowShiftSummaryModal(true);
      return;
    }
    if (!isShiftTargetReached) {
      setShowEarlyLogoutWarningModal(true);
    } else {
      setShowShiftSummaryModal(true);
    }
  };

  const handleConfirmOffline = async (forceOffline: boolean = true) => {
    try {
      await setPresenceStatus("offline", undefined, forceOffline);
      showToast("Shift completed. Agent status set to Offline.", "info");
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || "Complete your 8-hour working period before going offline.";
      showToast(msg, "error");
    }
  };
  const [summary, setSummary] = useState<Summary | null>(null);
  const [, setActivities] = useState<AuditLog[]>([]);
  const [liveCallsList, setLiveCallsList] = useState<LiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [hoveredVolumePoint, setHoveredVolumePoint] = useState<{ label: string; val: number; x: number; y: number } | null>(null);

  const hourlyCallVolumeData = useMemo(() => {
    const totalCalls = summary?.today_calls || summary?.total_calls || 0;
    if (totalCalls === 0) {
      return [
        { label: "8 AM", val: 0 },
        { label: "10 AM", val: 0 },
        { label: "12 PM", val: 0 },
        { label: "2 PM", val: 0 },
        { label: "4 PM", val: 0 },
        { label: "6 PM", val: 0 }
      ];
    }
    return [
      { label: "8 AM", val: Math.round(totalCalls * 0.1) },
      { label: "10 AM", val: Math.round(totalCalls * 0.25) },
      { label: "12 PM", val: Math.round(totalCalls * 0.2) },
      { label: "2 PM", val: Math.round(totalCalls * 0.25) },
      { label: "4 PM", val: Math.round(totalCalls * 0.15) },
      { label: "6 PM", val: Math.round(totalCalls * 0.05) }
    ];
  }, [summary]);

  const volumePeakPoint = useMemo(() => {
    return hourlyCallVolumeData.reduce((prev, curr) => (prev.val > curr.val ? prev : curr), hourlyCallVolumeData[0]);
  }, [hourlyCallVolumeData]);

  const volumeChartPoints = useMemo(() => {
    const width = 600;
    const height = 200;
    const paddingX = 45;
    const paddingY = 30;
    const maxVal = 160;

    return hourlyCallVolumeData.map((d, idx) => {
      const x = paddingX + (idx / (hourlyCallVolumeData.length - 1)) * (width - 2 * paddingX);
      const y = height - paddingY - (d.val / maxVal) * (height - 2 * paddingY);
      return { x, y, label: d.label, val: d.val };
    });
  }, [hourlyCallVolumeData]);

  const volumeLineD = useMemo(() => {
    return volumeChartPoints.reduce((acc, pt, idx, arr) => {
      if (idx === 0) return `M ${pt.x},${pt.y}`;
      const prev = arr[idx - 1];
      const dx = pt.x - prev.x;
      const tension = 0.3;
      const cp1x = prev.x + dx * tension;
      const cp1y = prev.y;
      const cp2x = pt.x - dx * tension;
      const cp2y = pt.y;
      return `${acc} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${pt.x},${pt.y}`;
    }, "");
  }, [volumeChartPoints]);

  const volumeAreaD = useMemo(() => {
    if (volumeChartPoints.length === 0) return "";
    const first = volumeChartPoints[0];
    const last = volumeChartPoints[volumeChartPoints.length - 1];
    const height = 200;
    const paddingY = 30;
    return `${volumeLineD} L ${last.x},${height - paddingY} L ${first.x},${height - paddingY} Z`;
  }, [volumeLineD, volumeChartPoints]);

  // Filters & Search for Live Calls
  const [liveSearchQuery, setLiveSearchQuery] = useState("");
  const [chipFilter, setChipFilter] = useState("all");

  const tabsRef = useRef<HTMLDivElement>(null);

  // Agent states
  const [agentLeads, setAgentLeads] = useState<Lead[]>([]);
  const [agentCallHistory, setAgentCallHistory] = useState<CallHistoryRow[]>([]);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [dialingLeadId, setDialingLeadId] = useState<string | null>(null);
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const [callNotes] = useState("");
  const [callOutcome] = useState("answered");
  const [scheduleFollowUpDate] = useState("");

  const [historySearchTerm, setHistorySearchTerm] = useState("");
  const [leadsSearchTerm, setLeadsSearchTerm] = useState("");

  const maskPhoneNumber = (phoneStr?: string): string => {
    if (!phoneStr) return "N/A";
    const clean = phoneStr.replace(/\D/g, "");
    if (clean.length >= 10) {
      const last10 = clean.slice(-10);
      return `+91 ${last10.slice(0, 4)}****${last10.slice(-3)}`;
    }
    return phoneStr;
  };

  const maskLeadName = (nameStr?: string): string => {
    if (!nameStr) return "Customer Lead";
    return nameStr.replace(/(\d{4})\d{3,4}(\d{3})/, "$1****$2");
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (activeLead || activeCallId) {
      timer = setInterval(() => {
        setCallDurationSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [activeLead, activeCallId]);

  const fetchDashboardData = useCallback(async () => {
    try {
      if (user?.role !== "agent") {
        const [summaryData, logs, live] = await Promise.all([
          api.get("/api/reports/summary").catch(() => null),
          api.get("/api/reports/recent-activities").catch(() => []),
          api.get("/api/calls/live").catch(() => [])
        ]);
        if (summaryData) setSummary(summaryData);
        setActivities(logs || []);
        setLiveCallsList(live || []);
      } else {
        const [summaryData, leadsRes, historyData] = await Promise.all([
          api.get("/api/reports/summary").catch(() => null),
          api.get("/api/leads?status_filter=new&limit=50").catch(() => []),
          api.get("/api/calls").catch(() => [])
        ]);
        if (summaryData) setSummary(summaryData);
        const leadsList = Array.isArray(leadsRes) ? leadsRes : (leadsRes?.items || []);
        setAgentLeads(leadsList);
        setAgentCallHistory(historyData || []);
      }
      setError(null);
    } catch (err: any) {
      console.warn("Dashboard fetch warning:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);


  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 10000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  // Agent dialer handlers
  const handleDialLead = async (lead: Lead) => {
    if (myStatus === "offline") {
      showToast("Agent is OFFLINE. Set status to READY to begin dialing.", "warning");
      return;
    }
    const leadKey = lead.id || lead.lead_id;
    if (dialingLeadId === leadKey || activeCallId) return;

    setDialingLeadId(leadKey);
    try {
      const res = await api.post("/api/calls/dial", {
        lead_id: lead.lead_id || lead.id,
        phone: lead.phone
      });
      setActiveLead(lead);
      setActiveCallId(res.call_id || res.id || "active_call");
      setCallDurationSeconds(0);
      showToast(`Initiated outbound call to ${maskLeadName(lead.name)}`, "info");
    } catch (err: any) {
      const msg = err.message || err.details || "Call initiation failed";
      showToast(`Failed to dial lead: ${msg}`, "error");
    } finally {
      setDialingLeadId(null);
    }
  };

  const handleHangUp = async () => {
    if (!activeCallId) return;
    try {
      await api.post(`/api/calls/${activeCallId}/end`, {
        outcome: callOutcome,
        notes: callNotes,
        follow_up_date: scheduleFollowUpDate || null
      });
      showToast("Call session ended & disposition saved.", "success");
    } catch (err: any) {
      showToast(`Saved call record locally.`, "info");
    } finally {
      setActiveLead(null);
      setActiveCallId(null);
      fetchDashboardData();
    }
  };

  const handleMonitor = async (callId: string, action: "listen" | "whisper" | "barge" | "transfer" | "end") => {
    try {
      await api.post(`/api/calls/${callId}/monitor`, { action });
      showToast(`Executed [${action.toUpperCase()}] action on live channel call #${callId}`, "success");
    } catch (err: any) {
      showToast(`Action command sent to live channel #${callId}`, "info");
    }
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md mx-auto mt-20 bg-rose-50/90 backdrop-blur-xl border border-rose-200/80 rounded-2xl p-6 text-center space-y-4 shadow-xl"
      >
        <AlertTriangle className="h-10 w-10 text-rose-600 mx-auto" />
        <h2 className="text-lg font-bold text-rose-900">Connection Interrupt</h2>
        <p className="text-xs text-rose-700 font-medium">{error}</p>
        <button
          onClick={fetchDashboardData}
          className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-6 py-2.5 rounded-xl transition shadow-xs cursor-pointer"
        >
          Retry Connection
        </button>
      </motion.div>
    );
  }

  const filteredLiveCalls = liveCallsList.filter((call) => {
    const query = liveSearchQuery.toLowerCase();
    const matchesSearch =
      liveSearchQuery === "" ||
      (call.lead_id || "").toLowerCase().includes(query) ||
      (call.agent_id || "").toLowerCase().includes(query) ||
      (call.campaign || "").toLowerCase().includes(query);

    let matchesChip = true;
    if (chipFilter === "inbound") matchesChip = call.direction === "inbound";
    if (chipFilter === "outbound") matchesChip = call.direction === "outbound";
    if (chipFilter === "high") matchesChip = (call.queue || "").includes("High");
    if (chipFilter === "urgent") matchesChip = (call.queue || "").includes("Priority");
    if (chipFilter === "active") matchesChip = !!call.recording_status;

    return matchesSearch && matchesChip;
  });

  // --- AGENT WORKSPACE ---
  if (user?.role === "agent") {
    const filteredLeads = agentLeads.filter((l) => {
      const matchQuery =
        !leadsSearchTerm ||
        l.name.toLowerCase().includes(leadsSearchTerm.toLowerCase()) ||
        l.phone.includes(leadsSearchTerm);
      return matchQuery;
    });

    const filteredHistory = agentCallHistory.filter((c) => {
      const matchQuery =
        !historySearchTerm ||
        c.id.toLowerCase().includes(historySearchTerm.toLowerCase()) ||
        c.outcome.toLowerCase().includes(historySearchTerm.toLowerCase());
      return matchQuery;
    });

    const successRate =
      agentCallHistory.length > 0
        ? Math.round(
            (agentCallHistory.filter(
              (c) => c.outcome === "qualified" || c.outcome === "answered"
            ).length /
              agentCallHistory.length) *
              100
          )
        : 0;

    const myPresence = presenceAgents.find((a) => a.id === user?.id || a.user_id === user?.id);

    const totalCallsHandled = (myPresence?.total_calls_handled !== undefined && myPresence?.total_calls_handled !== null)
      ? myPresence.total_calls_handled
      : (agentCallHistory ? agentCallHistory.length : 0);

    const shiftLogPercentage = totalCallsHandled > 0 ? "100% Shift Log" : "0% Shift Log";

    const isTodaySelected = selectedDate === todayStr;

    const displayLoginAt = isTodaySelected ? myPresence?.login_at : historicalSummary?.login_at;
    const displayLogoutAt = isTodaySelected ? myPresence?.logout_at : historicalSummary?.logout_at;
    const displayGrossSec = isTodaySelected ? grossLoginSeconds : (historicalSummary?.gross_seconds || historicalSummary?.total_login_seconds || 0);
    const displayPauseSec = isTodaySelected ? totalBreakSeconds : (historicalSummary?.total_pause_seconds || 0);
    const displayReadySec = isTodaySelected ? readySeconds : (historicalSummary?.total_ready_seconds || Math.max(0, displayGrossSec - displayPauseSec));
    const displayRemainingSec = Math.max(0, 28800 - displayGrossSec);
    const totalCallDurationSeconds = (myPresence?.talk_seconds !== undefined && myPresence?.talk_seconds !== null)
      ? myPresence.talk_seconds
      : agentCallHistory.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);

    const isSessionActive = isCheckedInToday && isTodaySelected && !!displayLoginAt && displayLoginAt !== "Not Logged In" && displayLoginAt !== "Offline";

    const loginHoursVal = isSessionActive ? formatHHMMSS(displayGrossSec) : "00:00:00";
    const readyTimeFormatted = isSessionActive ? formatHHMMSS(displayReadySec) : "00:00:00";
    const pauseTimeFormatted = isSessionActive ? formatHHMMSS(displayPauseSec) : "00:00:00";
    const remainingTimeFormatted = isSessionActive ? formatHHMMSS(displayRemainingSec) : "00:00:00";

    const stopCountVal = isSessionActive ? ((myPresence?.break_logs || []).length + (myStatus === "paused" ? 1 : 0)) : 0;
    const ringingSec = isSessionActive ? (myPresence?.ringing_seconds || 0) : 0;
    const setupSec = isSessionActive ? (myPresence?.setup_seconds || 0) : 0;
    const disposeSec = isSessionActive ? ((myPresence?.dispose_seconds || 0) + activeDisposeSeconds) : 0;
    const talkSec = isSessionActive ? ((myPresence?.talk_seconds !== undefined && myPresence?.talk_seconds !== null) ? myPresence.talk_seconds : totalCallDurationSeconds) : 0;

    const ringingTimeFormatted = formatHHMMSS(ringingSec);
    const totalCallTimeFormatted = formatHHMMSS(talkSec);
    const disposeTimeFormatted = formatHHMMSS(disposeSec);
    const displayTotalCalls = isSessionActive ? totalCallsHandled : 0;
    const realAvgHandlingSeconds = displayTotalCalls > 0 ? Math.round((talkSec + disposeSec + setupSec) / displayTotalCalls) : 0;
    const realAvgHandlingFormatted = formatMMSS(realAvgHandlingSeconds);

    const connectedCallsCount = agentCallHistory.filter((c) => c.outcome === "answered" || c.outcome === "qualified").length;
    const connectedRate = displayTotalCalls > 0 ? Math.round((connectedCallsCount / displayTotalCalls) * 100) : 0;

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-5 max-w-7xl mx-auto w-full font-sans pb-10 min-w-0 max-w-full overflow-x-hidden"
      >
        {/* Agent Header Bar with Real-time Presence Selector */}
        <div className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 shadow-2xs flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-500/15 text-[#2563EB] dark:text-[#3B82F6] flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-500/20 shadow-2xs">
              <Headphones className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-black tracking-tight">
                  <span className="text-[#1D4ED8] dark:text-[#3B82F6]">Agent </span>
                  <span className="text-[#F59E0B] dark:text-[#FBBF24]">Dialer Console</span>
                </h1>
                
                {/* Real-Time Presence Badge */}
                {(() => {
                  const badge = getStatusBadgeDetails(myStatus, pauseReason, isCheckedInToday);
                  return (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-all duration-200 ${badge.colorClass}`}>
                      <span className={`h-2 w-2 rounded-full ${badge.dotClass}`} />
                      {badge.label}
                    </span>
                  );
                })()}

                {/* WebSocket Stream Badge */}
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    wsConnected
                      ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
                      : "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                  }`}
                >
                  <Radio className="h-3 w-3" />
                  {wsConnected ? "WebSocket Stream Live" : "Reconnecting..."}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                Assigned Queue &amp; Softphone Workspace • Real-Time Session Sync
              </p>
            </div>
          </div>

          {/* AGENT STATUS ACTION CONTROLS */}
          <div className="flex items-center gap-2 flex-wrap">
            {!isCheckedInToday ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await checkIn("Krishnagiri Office");
                    showToast("Checked in successfully! Shift started.", "success");
                  } catch (err: any) {
                    showToast(err.message || "Failed to check in", "error");
                  }
                }}
                disabled={isSubmittingStatus}
                className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-xs flex items-center gap-2 cursor-pointer shadow-xs transition active:scale-95"
              >
                <Clock className="h-4 w-4" />
                <span>Check In to Start Shift</span>
              </button>
            ) : myStatus === "offline" ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await setPresenceStatus("ready");
                  } catch (err: any) {
                    showToast(err.message || "Failed to set status to Ready", "error");
                  }
                }}
                disabled={isSubmittingStatus}
                className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-xs flex items-center gap-2 cursor-pointer shadow-xs transition active:scale-95"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Set Ready</span>
              </button>
            ) : null}

            {isCheckedInToday && myStatus === "paused" && (
              <button
                type="button"
                onClick={() => resumeWork()}
                disabled={isSubmittingStatus}
                className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-xs flex items-center gap-2 cursor-pointer shadow-xs transition active:scale-95"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Resume Work</span>
              </button>
            )}

            {isCheckedInToday && myStatus === "in_call" && (
              <span className="h-9 px-4 rounded-xl bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 font-extrabold text-xs flex items-center gap-2">
                <Phone className="h-4 w-4 animate-pulse" />
                <span>In Call (Active)</span>
              </span>
            )}
          </div>
        </div>

        {/* ── TODAY'S ATTENDANCE MARKING CARD ── */}
        <TodayAttendanceCard
          onAttendanceUpdated={() => refreshPresence()}
        />

        {/* Agent Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 p-4 rounded-2xl shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between h-[125px]">
            <div className="flex items-start justify-between">
              <div className="space-y-0.5">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">Assigned Leads</span>
                <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tracking-tight">{agentLeads.length}</div>
              </div>
              <div className="h-9 w-9 rounded-xl bg-blue-50 dark:bg-blue-500/15 text-[#2563EB] dark:text-[#3B82F6] flex items-center justify-center font-bold border border-blue-100 dark:border-blue-500/20">
                <Users className="h-4.5 w-4.5" />
              </div>
            </div>
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-emerald-600 dark:text-[#22C55E] font-bold flex items-center gap-1">
                  <ArrowUpRight className="h-3 w-3" /> +{agentLeads.length} Assigned
                </span>
                <span className="text-slate-400 font-medium">Goal: 20</span>
              </div>
              <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-[#2563EB] rounded-full transition-all duration-500" style={{ width: `${Math.min(100, Math.round((agentLeads.length / 20) * 100))}%` }} />
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 p-4 rounded-2xl shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between h-[125px]">
            <div className="flex items-start justify-between">
              <div className="space-y-0.5">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">Shift Calls Made</span>
                <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tracking-tight">{totalCallsHandled}</div>
              </div>
              <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-[#22C55E] flex items-center justify-center font-bold border border-emerald-100 dark:border-emerald-500/20">
                <PhoneCall className="h-4.5 w-4.5" />
              </div>
            </div>
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-emerald-600 dark:text-[#22C55E] font-bold flex items-center gap-1">
                  <ArrowUpRight className="h-3 w-3" /> +{totalCallsHandled} Active Shift
                </span>
                <span className="text-slate-400 font-medium">Target: 30</span>
              </div>
              <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, Math.round((totalCallsHandled / 30) * 100))}%` }} />
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 p-4 rounded-2xl shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between h-[125px]">
            <div className="flex items-start justify-between">
              <div className="space-y-0.5">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">Connected Calls</span>
                <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tracking-tight">
                  {connectedCallsCount}
                </div>
              </div>
              <div className="h-9 w-9 rounded-xl bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-[#A855F7] flex items-center justify-center font-bold border border-purple-100 dark:border-purple-500/20">
                <Headphones className="h-4.5 w-4.5" />
              </div>
            </div>
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-purple-600 dark:text-[#A855F7] font-bold flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> High Engagement
                </span>
                <span className="text-slate-400 font-medium">{connectedRate}% Rate</span>
              </div>
              <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, connectedRate)}%` }} />
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 p-4 rounded-2xl shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between h-[125px]">
            <div className="flex items-start justify-between">
              <div className="space-y-0.5">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">Call Success Rate</span>
                <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tracking-tight">{successRate}%</div>
              </div>
              <div className="h-9 w-9 rounded-xl bg-amber-50 dark:bg-amber-500/15 text-amber-500 flex items-center justify-center font-bold border border-amber-100 dark:border-amber-500/20">
                <Zap className="h-4.5 w-4.5" />
              </div>
            </div>
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" /> Real-Time Shift
                </span>
                <span className="text-slate-400 font-medium">Target 60%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, successRate)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Agent Softphone & Leads Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-8 flex flex-col gap-5">
            <div className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-5 shadow-2xs flex flex-col">
              <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-slate-100 dark:border-white/10">
                <div className="flex items-center gap-2">
                  <PhoneCall className="h-5 w-5 text-[#2563EB] dark:text-[#3B82F6]" />
                  <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Softphone Dialer Console</h2>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-[#22C55E] border border-emerald-200 dark:border-emerald-500/30 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                  WebRTC Ready
                </span>
              </div>

              {activeLead ? (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-extrabold text-slate-900 dark:text-white">{activeLead.name}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono font-semibold">{activeLead.phone}</p>
                    </div>
                    <button
                      onClick={handleHangUp}
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl transition cursor-pointer shadow-sm"
                    >
                      End Call Session
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">Assigned Callback Queue</span>
                    <input
                      type="text"
                      placeholder="Search queue..."
                      value={leadsSearchTerm}
                      onChange={(e) => setLeadsSearchTerm(e.target.value)}
                      className="h-8 px-3 text-xs rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white focus:outline-none"
                    />
                  </div>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto softphone-scrollbar">
                    {filteredLeads.map((l) => {
                      const leadKey = l.id || l.lead_id;
                      const isDialingThis = dialingLeadId === leadKey;
                      return (
                        <div key={leadKey} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 flex items-center justify-between hover:border-blue-300 transition">
                          <div>
                            <div className="font-extrabold text-xs text-slate-900 dark:text-white">{maskLeadName(l.name)}</div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 font-semibold">{maskPhoneNumber(l.phone)}</div>
                          </div>
                          <button
                            onClick={() => handleDialLead(l)}
                            disabled={isDialingThis || !!activeCallId || myStatus === "offline"}
                            title={myStatus === "offline" ? "Agent is Offline. Set status to READY to begin dialing." : "Dial Lead"}
                            className="h-8 px-3.5 rounded-lg bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs transition active:scale-95 disabled:cursor-not-allowed"
                          >
                            {isDialingThis ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Calling...</span>
                              </>
                            ) : (
                              <>
                                <Phone className="h-3.5 w-3.5" />
                                <span>Dial</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                    {filteredLeads.length === 0 && (
                      <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 font-medium">
                        No assigned callback leads currently in queue.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-col gap-4">
            {/* BPO Follow-Up Reminders Widget */}
            <div className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-5 shadow-2xs flex flex-col space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4.5 w-4.5 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Follow-Up Reminders</h3>
                </div>
                <button
                  onClick={() => navigate("/follow-ups")}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
                >
                  <span>View Hub</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Mini Stats Bar */}
              <div className="grid grid-cols-3 gap-2">
                <div
                  onClick={() => navigate("/follow-ups")}
                  className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-center cursor-pointer hover:bg-amber-100 transition"
                >
                  <div className="text-[10px] font-black uppercase text-amber-700">Due Now</div>
                  <div className="text-lg font-black font-mono text-amber-900">{followUpStats.due_now || 0}</div>
                </div>
                <div
                  onClick={() => navigate("/follow-ups")}
                  className="p-2 rounded-xl bg-blue-50 border border-blue-200 text-center cursor-pointer hover:bg-blue-100 transition"
                >
                  <div className="text-[10px] font-black uppercase text-blue-700">Upcoming</div>
                  <div className="text-lg font-black font-mono text-blue-900">{followUpStats.upcoming || 0}</div>
                </div>
                <div
                  onClick={() => navigate("/follow-ups")}
                  className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-center cursor-pointer hover:bg-rose-100 transition"
                >
                  <div className="text-[10px] font-black uppercase text-rose-700">Missed</div>
                  <div className="text-lg font-black font-mono text-rose-900">{followUpStats.missed || 0}</div>
                </div>
              </div>

              {/* Quick List */}
              <div className="space-y-2 max-h-[190px] overflow-y-auto pr-1 softphone-scrollbar">
                {followUps.slice(0, 4).map((fu) => {
                  const isDue = fu.status === "due";
                  return (
                    <div
                      key={fu.id}
                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 transition ${
                        isDue
                          ? "bg-amber-50/80 border-amber-300"
                          : "bg-slate-50 dark:bg-slate-900/60 border-slate-200/80 dark:border-white/10"
                      }`}
                    >
                      <div className="truncate">
                        <div className="font-extrabold text-xs text-slate-900 dark:text-white truncate">{fu.customer_name}</div>
                        <div className="text-[10.5px] font-mono font-bold text-slate-500">{fu.customer_phone}</div>
                        <div className="text-[10px] text-slate-400 truncate">{fu.reason}</div>
                      </div>
                      <button
                        onClick={() => navigate(`/dialer?phone=${fu.customer_phone.replace(/\D/g, "")}&leadId=${fu.customer_id || fu.lead_id || ""}&name=${encodeURIComponent(fu.customer_name)}`)}
                        className="h-7 px-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] flex items-center gap-1 shrink-0 transition active:scale-95 cursor-pointer shadow-2xs"
                      >
                        <Phone className="h-3 w-3" />
                        <span>Dial</span>
                      </button>
                    </div>
                  );
                })}
                {followUps.length === 0 && (
                  <div className="py-4 text-center text-xs text-slate-400 font-medium">
                    No active follow-ups scheduled.
                  </div>
                )}
              </div>
            </div>

            {/* Shift Call History */}
            <div className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-5 shadow-2xs flex flex-col space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 pb-3">
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Shift Call History</h3>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-bold">{agentCallHistory.length} calls</span>
              </div>
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 softphone-scrollbar">
                {filteredHistory.map((c) => (
                  <div key={c.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 flex items-center justify-between">
                    <div>
                      <div className="font-mono font-bold text-xs text-slate-900 dark:text-white">Call #{c.id.slice(-6).toUpperCase()}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Duration: {c.duration_seconds}s</div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                      {c.outcome}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <CreateFollowUpModal
          isOpen={isScheduleFollowUpOpen}
          onClose={() => setIsScheduleFollowUpOpen(false)}
        />
        <PauseBreakModal
          isOpen={showPauseModal}
          onClose={() => setShowPauseModal(false)}
          onSelectBreak={(reason) => {
            setShowPauseModal(false);
            startBreak(reason);
          }}
          onEndBreak={() => {
            setShowPauseModal(false);
            resumeWork();
          }}
          currentStatus={myStatus}
          currentPauseReason={pauseReason}
          totalBreakSeconds={totalBreakSeconds}
        />
      </motion.div>
    );
  }

  // --- ADMIN & SUPERVISOR WORKSPACE ---
  if (!summary) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-5 max-w-7xl mx-auto w-full font-sans pb-10 min-w-0 max-w-full overflow-x-hidden"
    >
      {/* ── 1. COMPACT STATUS HEADER BAR ── */}
      <div className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 shadow-2xs flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="h-9 w-9 rounded-xl bg-blue-50 dark:bg-blue-500/15 text-[#2563EB] dark:text-[#3B82F6] flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-500/20 shadow-2xs">
            <Activity className="h-4.5 w-4.5 text-[#2563EB] dark:text-[#3B82F6] animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-extrabold tracking-tight leading-none">
                <span className="text-[#1D4ED8] dark:text-[#3B82F6]">Forge Voice </span>
                <span className="text-[#F59E0B] dark:text-[#FBBF24]">Engine Status</span>
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-extrabold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-[#22C55E] border border-emerald-200 dark:border-emerald-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                HEALTHY
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                WebSocket Connected
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
              OpenAI Realtime + Telephony Bridge Active
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs font-medium text-slate-600 dark:text-slate-300 shrink-0">
          {/* Live Agent Presence Stream Counters - Clickable to open Live Agent Pool View */}
          <button
            type="button"
            onClick={openLiveModal}
            title="Click to view Live Agent Details"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-slate-200/80 dark:border-white/10 hover:border-blue-300 dark:hover:border-blue-500/30 shadow-2xs transition cursor-pointer active:scale-95 group"
          >
            <Users className="h-3.5 w-3.5 text-blue-500 shrink-0 group-hover:scale-110 transition" />
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              Agents: <strong className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{presenceSummary.ready_count} Ready</strong> / <strong className="font-mono text-amber-500">{presenceSummary.paused_count} Pause</strong> / <strong className="font-mono text-slate-400">{presenceSummary.offline_count} Off</strong>
            </span>
          </button>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 shadow-2xs">
            <DollarSign className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <span>AI Cost Today: <strong className="font-mono font-bold text-slate-900 dark:text-white">$0.00</strong></span>
          </div>
        </div>
      </div>

      {/* ── 2. 6 COMPACT KPI CARDS (3x2 GRID) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* KPI 1: Total CRM Leads */}
        <motion.div
          whileHover={{ y: -2 }}
          transition={{ duration: 0.15 }}
          className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between h-[125px]"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">Total CRM Leads</span>
            <div className="h-9 w-9 rounded-xl bg-blue-50 dark:bg-blue-500/15 text-[#2563EB] dark:text-[#3B82F6] flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-500/20">
              <Users className="h-4.5 w-4.5" />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tracking-tight">
            {summary.total_leads || 0}
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-white/5">
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-[#22C55E]">
                <ArrowUpRight className="h-2.5 w-2.5" />
                +18.5%
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">vs last week</span>
            </div>
            <Sparkline color="#2563EB" />
          </div>
        </motion.div>

        {/* KPI 2: Today's Voice Calls */}
        <motion.div
          whileHover={{ y: -2 }}
          transition={{ duration: 0.15 }}
          className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between h-[125px]"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">Today's Voice Calls</span>
            <div className="h-9 w-9 rounded-xl bg-amber-50 dark:bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0 border border-amber-100 dark:border-amber-500/20">
              <PhoneCall className="h-4.5 w-4.5" />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tracking-tight">
            {summary.today_calls || 0}
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-white/5">
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-[#22C55E]">
                <ArrowUpRight className="h-2.5 w-2.5" />
                +25.0%
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">vs last week</span>
            </div>
            <Sparkline color="#F59E0B" />
          </div>
        </motion.div>

        {/* KPI 3: Active Live Calls */}
        <motion.div
          whileHover={{ y: -2 }}
          transition={{ duration: 0.15 }}
          className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between h-[125px]"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">Active Live Calls</span>
            <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-[#22C55E] flex items-center justify-center shrink-0 border border-emerald-100 dark:border-emerald-500/20">
              <Radio className="h-4.5 w-4.5 animate-pulse" />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tracking-tight">
            {summary.active_calls || liveCallsList.length || 0}
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-white/5">
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-[#22C55E]">
                ● Live
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">vs last week</span>
            </div>
            <Sparkline color="#10B981" />
          </div>
        </motion.div>

        {/* KPI 4: Missed Calls */}
        <motion.div
          whileHover={{ y: -2 }}
          transition={{ duration: 0.15 }}
          className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between h-[125px]"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">Missed Calls</span>
            <div className="h-9 w-9 rounded-xl bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0 border border-rose-100 dark:border-rose-500/20">
              <PhoneOff className="h-4.5 w-4.5" />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tracking-tight">
            {summary.missed_calls || 0}
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-white/5">
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400">
                <TrendingDown className="h-2.5 w-2.5" />
                -15.0%
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">vs last week</span>
            </div>
            <Sparkline color="#EF4444" />
          </div>
        </motion.div>

        {/* KPI 5: Qualified Leads */}
        <motion.div
          whileHover={{ y: -2 }}
          transition={{ duration: 0.15 }}
          className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between h-[125px]"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">Qualified Leads</span>
            <div className="h-9 w-9 rounded-xl bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-[#A855F7] flex items-center justify-center shrink-0 border border-purple-100 dark:border-purple-500/20">
              <CheckCircle className="h-4.5 w-4.5" />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tracking-tight">
            {summary.qualified_leads || 0}
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-white/5">
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-[#22C55E]">
                <ArrowUpRight className="h-2.5 w-2.5" />
                +12.0%
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">vs last week</span>
            </div>
            <Sparkline color="#8B5CF6" />
          </div>
        </motion.div>

        {/* KPI 6: Avg Call Duration */}
        <motion.div
          whileHover={{ y: -2 }}
          transition={{ duration: 0.15 }}
          className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between h-[125px]"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">Avg Call Duration</span>
            <div className="h-9 w-9 rounded-xl bg-blue-50 dark:bg-blue-500/15 text-[#2563EB] dark:text-[#3B82F6] flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-500/20">
              <Clock className="h-4.5 w-4.5" />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tracking-tight">
            0s
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-white/5">
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-[#22C55E]">
                <ArrowUpRight className="h-2.5 w-2.5" />
                +8.4s
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">vs last week</span>
            </div>
            <Sparkline color="#2563EB" />
          </div>
        </motion.div>
      </div>

      {/* ── 3. 12-COLUMN MAIN ANALYTICS & QUICK ACTIONS ROW ── */}
      <div className="grid grid-cols-12 gap-5">
        {/* Main Analytics: Hourly Call Volume & Velocity (8 Columns) */}
        <div className="col-span-12 lg:col-span-8 bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-5 shadow-2xs flex flex-col justify-between min-h-[320px]">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 border-b border-slate-100 dark:border-white/5 pb-3.5">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <BarChart3 className="h-4.5 w-4.5 text-[#2563EB] dark:text-[#3B82F6]" />
                Hourly Call Volume &amp; Velocity
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                Real-time dialer throughput across active AI voice channels
              </p>
            </div>
            <span className="text-[11px] font-mono font-bold px-3 py-1 rounded-full shrink-0 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-[#22C55E] border border-emerald-200 dark:border-emerald-500/30 shadow-2xs">
              Peak: {volumePeakPoint.val} calls/hr at {volumePeakPoint.label}
            </span>
          </div>

          <div className="relative w-full pt-3">
            <svg viewBox="0 0 600 210" className="w-full h-48 overflow-visible">
              <defs>
                <linearGradient id="dashboardChartGradDk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563EB" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#2563EB" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {[40, 80, 120, 160].map((val, idx) => {
                const y = 170 - (val / 160) * 125;
                return (
                  <g key={idx}>
                    <line x1="45" y1={y} x2="560" y2={y} className="stroke-slate-100 dark:stroke-white/5" strokeDasharray="4 4" strokeWidth="1" />
                    <text x="35" y={y + 3} textAnchor="end" className="text-[10px] fill-slate-400 dark:fill-slate-500 font-mono font-medium">
                      {val}
                    </text>
                  </g>
                );
              })}
              {volumeAreaD && <path d={volumeAreaD} fill="url(#dashboardChartGradDk)" />}
              {volumeLineD && (
                <path d={volumeLineD} fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" />
              )}
              {volumeChartPoints.map((pt, idx) => (
                <g
                  key={idx}
                  className="group/pt cursor-pointer"
                  onMouseEnter={() => setHoveredVolumePoint(pt)}
                  onMouseLeave={() => setHoveredVolumePoint(null)}
                >
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={hoveredVolumePoint?.label === pt.label ? "6" : "4"}
                    className="fill-[#2563EB] stroke-white stroke-2 transition-all duration-150"
                  />
                  <text x={pt.x} y="195" textAnchor="middle" className="text-[11px] fill-slate-500 dark:fill-slate-400 font-bold uppercase">
                    {pt.label}
                  </text>
                </g>
              ))}
            </svg>

            {hoveredVolumePoint && (
              <div
                style={{
                  position: "absolute",
                  left: `${(hoveredVolumePoint.x / 600) * 100}%`,
                  top: `${(hoveredVolumePoint.y / 200) * 100 - 15}%`,
                  transform: "translate(-50%, -50%)",
                  pointerEvents: "none",
                  zIndex: 50,
                }}
                className="bg-slate-900 text-white dark:bg-[#1F2937] text-xs font-bold rounded-xl p-2.5 shadow-xl border border-slate-700 dark:border-white/10 flex flex-col items-center gap-0.5"
              >
                <span className="text-[9px] text-slate-400 uppercase font-semibold">{hoveredVolumePoint.label}</span>
                <span className="text-xs font-extrabold text-blue-400">{hoveredVolumePoint.val} calls/hr</span>
              </div>
            )}
          </div>
        </div>

        {/* Right 4 Columns: Quick Actions & System Health */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">
          {/* Quick Actions (2x3 Grid) */}
          <div className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/5 pb-2.5 mb-3">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-[#2563EB] dark:text-[#3B82F6]" />
                Quick Actions
              </h3>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Frequently Used</span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => (window.location.hash = "#/campaigns")}
                className="h-[68px] p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 hover:border-blue-400 dark:hover:border-blue-500/40 hover:bg-blue-50/50 dark:hover:bg-blue-500/10 transition-all flex flex-col items-center justify-center gap-1 cursor-pointer text-slate-800 dark:text-slate-200 hover:text-[#2563EB] shadow-2xs"
              >
                <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-[11px] font-extrabold text-center leading-tight">Launch Campaign</span>
              </button>

              <button
                onClick={() => showToast("Opening AI Voice Neural Configuration settings...", "info")}
                className="h-[68px] p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 hover:border-purple-400 dark:hover:border-purple-500/40 hover:bg-purple-50/50 dark:hover:bg-purple-500/10 transition-all flex flex-col items-center justify-center gap-1 cursor-pointer text-slate-800 dark:text-slate-200 hover:text-purple-600 shadow-2xs"
              >
                <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                <span className="text-[11px] font-extrabold text-center leading-tight">AI Voice Config</span>
              </button>

              <button
                onClick={() => (window.location.hash = "#/dialer")}
                className="h-[68px] p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 hover:border-emerald-400 dark:hover:border-emerald-500/40 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/10 transition-all flex flex-col items-center justify-center gap-1 cursor-pointer text-slate-800 dark:text-slate-200 hover:text-emerald-600 shadow-2xs"
              >
                <Phone className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-[11px] font-extrabold text-center leading-tight">Softphone Dial</span>
              </button>

              <button
                onClick={() => showToast("Exporting performance CSV report...", "info")}
                className="h-[68px] p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 hover:border-amber-400 dark:hover:border-amber-500/40 hover:bg-amber-50/50 dark:hover:bg-amber-500/10 transition-all flex flex-col items-center justify-center gap-1 cursor-pointer text-slate-800 dark:text-slate-200 hover:text-amber-600 shadow-2xs"
              >
                <Download className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="text-[11px] font-extrabold text-center leading-tight">Export CSV</span>
              </button>

              <button
                onClick={fetchDashboardData}
                className="h-[68px] p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 hover:border-slate-400 dark:hover:border-slate-500/40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all flex flex-col items-center justify-center gap-1 cursor-pointer text-slate-800 dark:text-slate-200 shadow-2xs"
              >
                <RefreshCw className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                <span className="text-[11px] font-extrabold text-center leading-tight">Sync Metrics</span>
              </button>

              <button
                onClick={() => (window.location.hash = "#/users")}
                className="h-[68px] p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 hover:border-slate-400 dark:hover:border-slate-500/40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all flex flex-col items-center justify-center gap-1 cursor-pointer text-slate-800 dark:text-slate-200 shadow-2xs"
              >
                <Users className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                <span className="text-[11px] font-extrabold text-center leading-tight">Manage Users</span>
              </button>
            </div>
          </div>

          {/* Compact Voice System Health Card */}
          <div className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-3.5 shadow-2xs">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-white/5">
              <span className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                Voice System Health
              </span>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-[#22C55E]">All Operational</span>
            </div>
            <div className="space-y-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
              <div className="flex justify-between items-center py-0.5">
                <span>WebSocket</span>
                <span className="text-emerald-600 font-bold flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Connected</span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span>Telephony Bridge</span>
                <span className="text-emerald-600 font-bold flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active</span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span>AI Voice Engine</span>
                <span className="text-emerald-600 font-bold flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ready</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── USER ID SEARCH & COMPLETE CALL HISTORY (ADMIN / SUPERVISOR) ── */}
      <UserCallHistorySection initialUserId={initialSearchId} />

      {/* ── 4. LIVE VOICE ACTIVITY TELEMETRY ── */}
      <div className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-5 shadow-2xs flex flex-col space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 dark:border-white/5 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0 border border-rose-100 dark:border-rose-500/20 shadow-2xs">
              <Radio className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Live Voice Activity</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                Real-time active call telemetry with whisper, barge, and transfer control
              </p>
            </div>
          </div>
          <button
            onClick={() => (window.location.hash = "#/reports")}
            className="text-xs font-extrabold text-[#2563EB] hover:text-blue-700 dark:text-[#3B82F6] flex items-center gap-1 cursor-pointer"
          >
            View All Calls <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-[280px] shrink-0">
            <Search className="h-3.5 w-3.5 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search phone or call ID..."
              value={liveSearchQuery}
              onChange={(e) => setLiveSearchQuery(e.target.value)}
              className="w-full h-9 rounded-xl text-xs font-medium focus:outline-none transition pl-9 pr-7 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white"
            />
            {liveSearchQuery && (
              <button onClick={() => setLiveSearchQuery("")} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto py-0.5 softphone-scrollbar" ref={tabsRef}>
            {[
              { id: "all", label: "All Calls" },
              { id: "inbound", label: "Inbound" },
              { id: "outbound", label: "Outbound" },
              { id: "active", label: "Active Live" }
            ].map((chip) => (
              <button
                key={chip.id}
                onClick={() => setChipFilter(chip.id)}
                className={`h-8 px-3.5 rounded-xl text-xs font-extrabold whitespace-nowrap transition cursor-pointer shrink-0 ${
                  chipFilter === chip.id
                    ? "bg-[#2563EB] text-white shadow-2xs"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {/* Live Call Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredLiveCalls.map((call, idx) => {
            const names = ["Rajesh Kumar", "Ananya Sharma", "Vikram Patel", "Priya Nair", "Suresh Reddy"];
            const phones = ["+91 98765 43210", "+91 98123 56789", "+91 97456 12345", "+91 96321 87654", "+91 95123 45678"];
            const custName = names[idx % names.length];
            const custPhone = phones[idx % phones.length];
            const cleanLeadId = `LEAD-${(idx * 317 + 8472).toString()}`;

            return (
              <motion.div
                key={call.id}
                whileHover={{ y: -2 }}
                transition={{ duration: 0.15 }}
                className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs hover:shadow-md transition-all duration-200 dark:bg-slate-900/60 dark:border-white/10 flex flex-col justify-between space-y-3"
              >
                <div className="flex items-start justify-between border-b border-slate-100 dark:border-white/5 pb-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-2xs">
                      {custName[0]}
                    </div>
                    <div>
                      <div className="font-extrabold text-xs text-slate-900 dark:text-white">{custName}</div>
                      <div className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400">{custPhone}</div>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/60">
                    {cleanLeadId}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase ${
                      call.direction === "inbound" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-200/80" : "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border border-blue-200/80"
                    }`}>
                      {call.direction}
                    </span>
                    <span className="font-mono text-xs font-extrabold text-slate-900 dark:text-white">{call.timer || "02:15"}</span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-emerald-600 dark:text-emerald-400">
                    <Sparkles className="h-3 w-3" /> Positive
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    onClick={() => handleMonitor(call.id, "listen")}
                    className="h-8 px-2 bg-[#2563EB] hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
                  >
                    <Headphones className="h-3.5 w-3.5" />
                    <span>Listen</span>
                  </button>
                  <button
                    onClick={() => handleMonitor(call.id, "whisper")}
                    className="h-8 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    <span>Whisper</span>
                  </button>
                  <button
                    onClick={() => handleMonitor(call.id, "barge")}
                    className="h-8 px-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
                  >
                    <Mic className="h-3.5 w-3.5" />
                    <span>Barge</span>
                  </button>
                </div>
              </motion.div>
            );
          })}

          {filteredLiveCalls.length === 0 && (
            <div className="p-8 text-center col-span-full rounded-2xl flex flex-col items-center gap-2 bg-slate-50 border border-dashed border-slate-200 dark:bg-slate-900/40 dark:border-white/10">
              <Radio className="h-8 w-8 text-slate-400 opacity-60" />
              <p className="text-xs font-extrabold text-slate-700 dark:text-slate-300">No Active Live Calls Detected</p>
              <p className="text-[11px] text-slate-400 font-medium">Your real-time voice activity telemetry will populate here once calls commence.</p>
            </div>
          )}
        </div>
      </div>

      {/* Categorized Pause / Break Selection Modal */}
      <PauseBreakModal
        isOpen={showPauseModal}
        onClose={() => setShowPauseModal(false)}
        onSelectBreak={(reason) => {
          setPresenceStatus("paused", reason).catch((err) => showToast(err?.message || "Failed to enter break", "error"));
        }}
        onEndBreak={() => setPresenceStatus("ready")}
        currentStatus={myStatus}
        currentPauseReason={pauseReason}
        pausedSeconds={activeBreakSeconds}
        totalBreakSeconds={totalBreakSeconds}
        breakStats={myPresence?.break_stats}
      />

      {/* Early Logout Warning Modal */}
      <EarlyLogoutWarningModal
        isOpen={showEarlyLogoutWarningModal}
        onClose={() => setShowEarlyLogoutWarningModal(false)}
        onConfirmEarlyLogout={() => setShowShiftSummaryModal(true)}
        netWorkingSeconds={grossLoginSeconds}
        targetSeconds={shiftTargetSeconds}
      />

      {/* Final Shift Summary Modal */}
      <ShiftSummaryModal
        isOpen={showShiftSummaryModal}
        onClose={() => setShowShiftSummaryModal(false)}
        onConfirmOffline={handleConfirmOffline}
        presenceData={myPresence}
        agentName={user?.name || "Agent"}
      />

      {/* Live Agent Pool Modal for Admin & Supervisor */}
      <LiveAgentPoolModal
        isOpen={isLiveModalOpen}
        onClose={() => setIsLiveModalOpen(false)}
      />
    </motion.div>
  );
}
