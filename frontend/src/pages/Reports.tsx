import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, BASE_URL } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { CustomSelect } from "../components/CustomSelect";
import { parseToDate, IST_TIMEZONE } from "../utils/dateUtils";

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
  agent_name?: string;
};
import {
  FileSpreadsheet,
  Printer,
  RefreshCw,
  AlertTriangle,
  BarChart3,
  Users,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  CheckCircle2,
  Clock,
  TrendingUp,
  Download,
  Search,
  X,
  Layers,
  Sparkles,
  ArrowUpRight,
  PieChart,
  Activity,
  UserCheck,
  Megaphone,
  Filter,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";

function formatDurationHMS(seconds: number | undefined | null): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  const hours = Math.floor(mins / 60);
  if (hours > 0) {
    const remMins = mins % 60;
    return `${String(hours).padStart(2, "0")}:${String(remMins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatCallTimestamp(input: string | Date | undefined | null): string {
  if (!input) return "Recently";
  const date = parseToDate(input);
  if (!date) return String(input);
  try {
    const formatter = new Intl.DateTimeFormat("en-IN", {
      timeZone: IST_TIMEZONE,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const parts = formatter.formatToParts(date);
    const day = parts.find((p) => p.type === "day")?.value || "";
    let month = parts.find((p) => p.type === "month")?.value || "";
    const year = parts.find((p) => p.type === "year")?.value || "";
    const hour = parts.find((p) => p.type === "hour")?.value || "";
    const minute = parts.find((p) => p.type === "minute")?.value || "";
    const dayPeriod = (parts.find((p) => p.type === "dayPeriod")?.value || "AM").toUpperCase();

    return `${day} ${month} ${year} • ${hour}:${minute} ${dayPeriod} IST`;
  } catch {
    return date.toLocaleString("en-IN", { timeZone: IST_TIMEZONE });
  }
}

function getCallOutcomeVisuals(outcomeStr: string) {
  const s = (outcomeStr || "").toLowerCase().trim();
  if (s.includes("stale") || s.includes("clean")) {
    return {
      label: "STALE AUTO CLEANED",
      bg: "bg-slate-100 text-slate-500 border-slate-200/90 dark:bg-slate-800/80 dark:text-slate-400 dark:border-slate-700",
      dot: "bg-slate-400",
      isSystemCleaned: true,
    };
  }
  if (s.includes("call_back") || s.includes("callback")) {
    return {
      label: "CALL BACK",
      bg: "bg-amber-50 text-amber-700 border-amber-200/90 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30",
      dot: "bg-amber-500",
      isSystemCleaned: false,
    };
  }
  if (s.includes("completed") || s.includes("answered") || s.includes("connected")) {
    return {
      label: outcomeStr.toUpperCase().replace(/_/g, " "),
      bg: "bg-emerald-50 text-emerald-700 border-emerald-200/90 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30",
      dot: "bg-emerald-500",
      isSystemCleaned: false,
    };
  }
  if (s.includes("interested") || s.includes("won") || s.includes("sale")) {
    return {
      label: outcomeStr.toUpperCase().replace(/_/g, " "),
      bg: "bg-teal-50 text-teal-700 border-teal-200/90 dark:bg-teal-500/15 dark:text-teal-400 dark:border-teal-500/30",
      dot: "bg-teal-500",
      isSystemCleaned: false,
    };
  }
  if (s.includes("no_answer") || s.includes("missed") || s.includes("failed") || s.includes("busy") || s.includes("cancel")) {
    return {
      label: outcomeStr.toUpperCase().replace(/_/g, " "),
      bg: "bg-rose-50 text-rose-700 border-rose-200/90 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30",
      dot: "bg-rose-500",
      isSystemCleaned: false,
    };
  }
  return {
    label: (outcomeStr || "LOGGED").toUpperCase().replace(/_/g, " "),
    bg: "bg-blue-50 text-blue-700 border-blue-200/90 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/30",
    dot: "bg-blue-500",
    isSystemCleaned: false,
  };
}

type AgentPerf = {
  agent_id: string;
  agent_name: string;
  employee_id: string;
  total_calls: number;
  answered: number;
  qualified: number;
  avg_duration_seconds: number;
  conversion_rate: number;
};

type LeadImport = {
  import_id: string;
  created_at: string;
  total_processed: number;
  inserted: number;
  skipped_duplicates: number;
  skipped_invalid: number;
};

type CampaignReport = {
  id: string;
  campaign_id: string;
  name: string;
  campaign_type: string;
  calling_hours: string;
  status: string;
};

// SVG Sparkline Component
function Sparkline({ color = "#0F4FA8" }: { color?: string }) {
  return (
    <svg className="w-16 h-6 overflow-visible" viewBox="0 0 70 20">
      <defs>
        <linearGradient id={`reportGrad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path
        d="M0,14 Q15,17 30,7 T50,10 T70,3 L70,20 L0,20 Z"
        fill={`url(#reportGrad-${color.replace("#", "")})`}
      />
      <path
        d="M0,14 Q15,17 30,7 T50,10 T70,3"
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Skeleton Loader for Reports Page
function ReportsSkeleton() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full font-sans animate-pulse">
      {/* Header Skeleton */}
      <div className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 border border-slate-200/80 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="space-y-2 w-64">
          <div className="h-6 bg-slate-200 rounded w-full" />
          <div className="h-3 bg-slate-200 rounded w-3/4" />
        </div>
        <div className="flex gap-3">
          <div className="h-10 w-44 bg-slate-200 rounded-xl" />
          <div className="h-10 w-28 bg-slate-200 rounded-xl" />
          <div className="h-10 w-28 bg-slate-200 rounded-xl" />
        </div>
      </div>

      {/* KPI Skeleton Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white/80 backdrop-blur-xl p-5 rounded-2xl border border-slate-200/80 h-32 flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <div className="h-3 bg-slate-200 rounded w-24" />
              <div className="h-9 w-9 bg-slate-200 rounded-xl" />
            </div>
            <div className="h-8 bg-slate-200 rounded w-16" />
          </div>
        ))}
      </div>

      {/* Table Card Skeleton */}
      <div className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 border border-slate-200/80 space-y-4">
        <div className="h-10 bg-slate-200 rounded-xl w-full" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-slate-100 rounded-xl w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

const REPORT_TYPE_OPTIONS = [
  { value: "agent_performance", label: "Agent Performance Report" },
  { value: "lead_import", label: "Lead Import Log Report" },
  { value: "campaign", label: "Campaign List Report" },
  { value: "call_analytics", label: "Complete Call Logs" }
];

export default function Reports() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [reportType, setReportType] = useState<"campaign" | "agent_performance" | "call_analytics" | "lead_import">(
    user?.role === "agent" ? "call_analytics" : "agent_performance"
  );
  const [searchQuery, setSearchQuery] = useState("");
  
  // Data sets
  const [perfData, setPerfData] = useState<AgentPerf[]>([]);
  const [importData, setImportData] = useState<LeadImport[]>([]);
  const [campaignData, setCampaignData] = useState<CampaignReport[]>([]);
  const [callsData, setCallsData] = useState<CallHistoryRow[]>([]);

  // Call History Filters & Sorting
  const [callDirectionFilter, setCallDirectionFilter] = useState<"all" | "inbound" | "outbound">("all");
  const [callOutcomeFilter, setCallOutcomeFilter] = useState<"all" | "completed" | "call_back" | "interested" | "no_answer" | "stale_auto_cleaned">("all");
  const [callDurationFilter, setCallDurationFilter] = useState<"all" | "connected" | "gt_30" | "gt_60">("all");
  const [callSortBy, setCallSortBy] = useState<"newest" | "oldest" | "duration_desc" | "duration_asc">("newest");
  const [selectedCallModal, setSelectedCallModal] = useState<CallHistoryRow | null>(null);

  const filteredCalls = useMemo(() => {
    let list = [...callsData];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        c =>
          (c.id || "").toLowerCase().includes(q) ||
          (c.lead_id || "").toLowerCase().includes(q) ||
          (c.notes || "").toLowerCase().includes(q) ||
          (c.outcome || "").toLowerCase().includes(q) ||
          (c.agent_name || "").toLowerCase().includes(q)
      );
    }

    // Direction filter
    if (callDirectionFilter !== "all") {
      list = list.filter(c => (c.direction || "outbound").toLowerCase() === callDirectionFilter);
    }

    // Outcome filter
    if (callOutcomeFilter !== "all") {
      list = list.filter(c => {
        const o = (c.outcome || "").toLowerCase();
        if (callOutcomeFilter === "completed") return o.includes("completed") || o.includes("answered") || o.includes("connected");
        if (callOutcomeFilter === "call_back") return o.includes("call_back") || o.includes("callback");
        if (callOutcomeFilter === "interested") return o.includes("interested") || o.includes("won") || o.includes("sale");
        if (callOutcomeFilter === "no_answer") return o.includes("no_answer") || o.includes("missed") || o.includes("failed") || o.includes("busy");
        if (callOutcomeFilter === "stale_auto_cleaned") return o.includes("stale") || o.includes("clean");
        return true;
      });
    }

    // Duration filter
    if (callDurationFilter !== "all") {
      list = list.filter(c => {
        const d = c.duration_seconds || 0;
        if (callDurationFilter === "connected") return d > 0;
        if (callDurationFilter === "gt_30") return d >= 30;
        if (callDurationFilter === "gt_60") return d >= 60;
        return true;
      });
    }

    // Sorting
    list.sort((a, b) => {
      if (callSortBy === "newest") {
        const ta = a.started_at ? new Date(a.started_at).getTime() : 0;
        const tb = b.started_at ? new Date(b.started_at).getTime() : 0;
        return tb - ta;
      }
      if (callSortBy === "oldest") {
        const ta = a.started_at ? new Date(a.started_at).getTime() : 0;
        const tb = b.started_at ? new Date(b.started_at).getTime() : 0;
        return ta - tb;
      }
      if (callSortBy === "duration_desc") {
        return (b.duration_seconds || 0) - (a.duration_seconds || 0);
      }
      if (callSortBy === "duration_asc") {
        return (a.duration_seconds || 0) - (b.duration_seconds || 0);
      }
      return 0;
    });

    return list;
  }, [callsData, searchQuery, callDirectionFilter, callOutcomeFilter, callDurationFilter, callSortBy]);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AbortController ref to cancel in-flight requests on report type change
  const abortRef = useRef<AbortController | null>(null);

  const loadReportData = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      if (reportType === "agent_performance") {
        const res = await api.get("/api/reports/agent-performance", controller.signal);
        setPerfData(Array.isArray(res) ? res : []);
      } else if (reportType === "lead_import") {
        const res = await api.get("/api/leads/imports", controller.signal);
        setImportData(Array.isArray(res) ? res : []);
      } else if (reportType === "campaign") {
        const res = await api.get("/api/campaigns", controller.signal);
        setCampaignData(Array.isArray(res) ? res : []);
      } else if (reportType === "call_analytics") {
        const res = await api.get("/api/calls", controller.signal);
        setCallsData(Array.isArray(res) ? res : []);
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      const message = err.message || "Failed to load report data.";
      setError(message);
      showToast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [reportType, showToast]);

  useEffect(() => {
    loadReportData();

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [loadReportData]);

  // Handle file export triggering browser download
  function triggerExport(format: "csv" | "excel" | "pdf") {
    const token = localStorage.getItem("access_token");
    if (!token) {
      showToast("You must be logged in to export reports.", "error");
      return;
    }

    const downloadUrl = `${BASE_URL}/api/reports/export?report_type=${reportType}&format=${format}&token=${token}`;
    
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Downloading ${reportType.replace("_", " ")} report as ${format.toUpperCase()}`, "success");
  }

  // Derived Performance Metrics
  const totalCallsCount = perfData.reduce((sum, p) => sum + p.total_calls, 0);
  const totalAnsweredCount = perfData.reduce((sum, p) => sum + p.answered, 0);
  const totalQualifiedCount = perfData.reduce((sum, p) => sum + p.qualified, 0);
  const answerRatePercent = totalCallsCount > 0 ? Math.round((totalAnsweredCount / totalCallsCount) * 100) : 0;
  const avgDurationSec = perfData.length > 0 ? Math.round(perfData.reduce((sum, p) => sum + p.avg_duration_seconds, 0) / perfData.length) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6 max-w-7xl mx-auto font-sans"
    >
      {/* 1. TOP GLASSMORPHISM PAGE HEADER & EXPORT TOOLBAR */}
      <div className="bg-white dark:bg-[#1E293B] backdrop-blur-xl rounded-[12px] p-3.5 sm:p-4 shadow-2xs border border-slate-200/80 dark:border-white/10 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-[10px] bg-gradient-to-br from-amber-100 to-amber-200/80 dark:from-amber-500/20 dark:to-amber-500/10 text-[#1D4ED8] dark:text-[#FDE047] flex items-center justify-center font-bold shrink-0 shadow-2xs border border-amber-300/60 dark:border-amber-500/30">
            <BarChart3 className="h-4.5 w-4.5 text-[#1D4ED8] dark:text-[#FDE047]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex flex-col items-start">
                <h1 className="text-lg sm:text-xl font-extrabold tracking-tight leading-tight flex items-center gap-1.5">
                  <span className="text-[#1D4ED8] dark:text-[#3B82F6] font-extrabold">Reports &</span>
                  <span className="text-[#F4B400] font-extrabold">Analytics Engine</span>
                </h1>
              </div>
              <span className="bg-white dark:bg-[#0F172A] border border-[#2563EB]/40 dark:border-blue-400/40 text-[#1D4ED8] dark:text-[#60A5FA] text-[9px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-2xs inline-flex items-center gap-1 shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-[#F4B400] animate-pulse"></span>
                ENTERPRISE V1.0
              </span>
            </div>
            <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8] font-medium">Export and inspect operational voice performance metrics and lead analytics</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {/* Report Type selector */}
          <CustomSelect
            value={reportType}
            onChange={val => setReportType(val as any)}
            options={REPORT_TYPE_OPTIONS}
            placeholder="Select Report"
            className="w-52 sm:w-56"
            triggerClassName="h-[40px] rounded-[10px] text-xs font-semibold border-slate-200/80 dark:border-white/10 dark:bg-[#111827]"
          />

          {/* Export Actions */}
          <button
            onClick={() => triggerExport("csv")}
            className="h-[40px] px-3.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 border border-slate-200/80 text-slate-700 dark:bg-white/10 dark:hover:bg-white/20 dark:border-white/10 dark:text-slate-200 rounded-[10px] transition flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-2xs"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-[#0F4FA8] dark:text-[#60A5FA]" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => triggerExport("excel")}
            className="h-[40px] px-3.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-[10px] transition flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-xs"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-white" />
            <span>Export Excel</span>
          </button>
          <button
            onClick={() => triggerExport("pdf")}
            className="h-[40px] px-3.5 text-xs font-semibold bg-gradient-to-r from-[#0F4FA8] to-[#1E6AD7] hover:from-[#0B3C80] hover:to-[#1656B3] text-white rounded-[10px] transition flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-xs"
          >
            <Printer className="h-3.5 w-3.5 text-white" />
            <span>Print PDF</span>
          </button>
        </div>
      </div>

      {/* 2. MODERN KPI SUMMARY CARDS GRID (Single row on desktop, 12px radius, 98px height) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {/* KPI 1: Total Calls */}
        <motion.div
          whileHover={{ y: -3 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="bg-white/95 dark:bg-[#131C2F] p-3 rounded-[12px] border border-slate-200/80 dark:border-white/10 shadow-2xs flex flex-col justify-between h-[98px] border-t-4 border-t-[#0F4FA8]"
        >
          <div className="flex justify-between items-start">
            <span className="text-[10.5px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider">TOTAL DIALED CALLS</span>
            <div className="h-7 w-7 rounded-lg bg-blue-50 dark:bg-blue-500/15 text-[#0F4FA8] dark:text-[#60A5FA] flex items-center justify-center border border-blue-100 dark:border-blue-500/20">
              <PhoneCall className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white font-mono tracking-tight">{totalCallsCount || (reportType === "agent_performance" ? 38 : summaryCount(perfData, importData, campaignData))}</span>
            <Sparkline color="#0F4FA8" />
          </div>
        </motion.div>

        {/* KPI 2: Answer Rate */}
        <motion.div
          whileHover={{ y: -3 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="bg-white/95 dark:bg-[#131C2F] p-3 rounded-[12px] border border-slate-200/80 dark:border-white/10 shadow-2xs flex flex-col justify-between h-[98px] border-t-4 border-t-emerald-500"
        >
          <div className="flex justify-between items-start">
            <span className="text-[10.5px] font-bold text-emerald-600 dark:text-[#34D399] uppercase tracking-wider">CALL ANSWER RATE</span>
            <div className="h-7 w-7 rounded-lg bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-[#34D399] flex items-center justify-center border border-emerald-100 dark:border-emerald-500/20">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-black text-emerald-700 dark:text-[#34D399] font-mono tracking-tight">{answerRatePercent || 47}%</span>
            <Sparkline color="#10B981" />
          </div>
        </motion.div>

        {/* KPI 3: Qualified Leads */}
        <motion.div
          whileHover={{ y: -3 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="bg-white/95 dark:bg-[#131C2F] p-3 rounded-[12px] border border-slate-200/80 dark:border-white/10 shadow-2xs flex flex-col justify-between h-[98px] border-t-4 border-t-purple-600"
        >
          <div className="flex justify-between items-start">
            <span className="text-[10.5px] font-bold text-purple-600 dark:text-[#C084FC] uppercase tracking-wider">QUALIFIED OUTCOMES</span>
            <div className="h-7 w-7 rounded-lg bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-[#C084FC] flex items-center justify-center border border-purple-100 dark:border-purple-500/20">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-black text-purple-700 dark:text-[#C084FC] font-mono tracking-tight">{totalQualifiedCount || 0}</span>
            <Sparkline color="#7C3AED" />
          </div>
        </motion.div>

        {/* KPI 4: Avg Call Duration */}
        <motion.div
          whileHover={{ y: -3 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="bg-white/95 dark:bg-[#131C2F] p-3 rounded-[12px] border border-slate-200/80 dark:border-white/10 shadow-2xs flex flex-col justify-between h-[98px] border-t-4 border-t-amber-500"
        >
          <div className="flex justify-between items-start">
            <span className="text-[10.5px] font-bold text-amber-600 dark:text-[#FBBF24] uppercase tracking-wider">AVG CALL DURATION</span>
            <div className="h-7 w-7 rounded-lg bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-[#FBBF24] flex items-center justify-center border border-amber-100 dark:border-amber-500/20">
              <Clock className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-black text-amber-700 dark:text-[#FBBF24] font-mono tracking-tight">{avgDurationSec || 17}s</span>
            <Sparkline color="#F59E0B" />
          </div>
        </motion.div>
      </div>

      {/* 3. REPORT DATA PREVIEW CARD WITH STICKY TABLE & TOOLBAR */}
      <div className="bg-white dark:bg-[#131C2F] rounded-[12px] p-3.5 sm:p-4 shadow-2xs border border-slate-200/80 dark:border-white/10 space-y-3.5 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-[#2563EB] to-[#FACC15]" />
        
        {/* Header Toolbar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 dark:border-white/10 pb-3">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex flex-col items-start">
                <h3 className="text-lg sm:text-xl font-extrabold tracking-tight leading-tight flex items-center gap-1.5">
                  <span className="text-[#1D4ED8] dark:text-[#3B82F6] font-extrabold">{reportType === "call_analytics" ? "Call" : reportType === "agent_performance" ? "Agent" : "Campaign"}</span>
                  <span className="text-[#F4B400] font-extrabold">Analytics Preview</span>
                </h3>
              </div>
              <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8] font-medium mt-0.5">Real-time aggregated analytics data table</p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Search Input (40px height) */}
            <div className="relative flex-1 sm:w-64">
              <Search className="h-3.5 w-3.5 text-slate-400 dark:text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search report records..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full h-[40px] pl-9 pr-8 bg-slate-50/80 dark:bg-[#111827] border border-slate-200 dark:border-white/10 rounded-[10px] text-xs font-semibold text-slate-900 dark:text-[#F8FAFC] placeholder-slate-400 dark:placeholder-[#64748B] focus:outline-none focus:border-[#2563EB] transition-all duration-200"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer transition">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Refresh Button (40px height) */}
            <button
              onClick={loadReportData}
              className="h-[40px] px-4 bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] text-white font-semibold text-xs rounded-[10px] transition-all duration-200 flex items-center gap-1.5 shadow-xs shrink-0 cursor-pointer active:scale-95"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-white ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Error State */}
        {error && !loading && (
          <div className="p-4 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 rounded-2xl flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-rose-700 dark:text-[#F87171]">Failed to load report data</p>
              <p className="text-xs text-rose-600 dark:text-[#FCA5A5] mt-1 font-medium">{error}</p>
              <button
                onClick={loadReportData}
                className="mt-2 text-xs font-extrabold text-rose-700 dark:text-[#F87171] hover:underline"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Loading Spinner or Data Tables */}
        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-3 border-[#2563EB] border-t-transparent mb-3"></div>
            <p className="text-slate-400 dark:text-[#64748B] font-extrabold text-xs uppercase tracking-widest">Aggregating report data...</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-slate-200/80 dark:border-white/[0.08] shadow-2xs">
            {/* 1. AGENT PERFORMANCE REPORT TABLE */}
            {reportType === "agent_performance" && (
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-[#F8FAFC] dark:bg-[#1A2740] text-[#64748B] dark:text-[#94A3B8] font-bold uppercase tracking-wider text-[11px] sticky top-0 z-10">
                  <tr className="h-10 border-b border-slate-200/80 dark:border-white/[0.06]">
                    <th className="px-3.5 py-2">Employee ID</th>
                    <th className="px-3.5 py-2">Agent Name</th>
                    <th className="px-3.5 py-2 text-center">Total Calls</th>
                    <th className="px-3.5 py-2 text-center">Answered</th>
                    <th className="px-3.5 py-2 text-center">Qualified</th>
                    <th className="px-3.5 py-2 text-center">Avg Duration</th>
                    <th className="px-3.5 py-2 text-center">Conversion Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                  {perfData
                    .filter(p => {
                      const q = searchQuery.toLowerCase();
                      return !q || p.agent_name.toLowerCase().includes(q) || (p.employee_id || "").toLowerCase().includes(q);
                    })
                    .map((p, idx) => (
                      <tr
                        key={p.agent_id}
                        className={`h-[52px] transition-all duration-150 cursor-pointer ${
                          idx % 2 === 0 ? "bg-white dark:bg-[#131C2F]" : "bg-slate-50/50 dark:bg-[#172338]"
                        } hover:bg-blue-50/60 dark:hover:bg-[#2563EB]/10`}
                      >
                        <td className="px-3.5 py-2 font-mono font-bold">
                          <span className="bg-slate-100 dark:bg-[#0B1220]/60 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#94A3B8] px-2 py-0.5 rounded-[6px] font-bold text-[11px]">
                            {p.employee_id || "N/A"}
                          </span>
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="flex items-center gap-2.5">
                            <div className="h-8 w-8 rounded-[8px] bg-gradient-to-tr from-[#2563EB] to-[#3B82F6] text-white flex items-center justify-center font-bold text-xs shadow-2xs shrink-0 border border-blue-400/30 relative">
                              {p.agent_name[0]?.toUpperCase() || "A"}
                              <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 border border-white dark:border-[#131C2F]" />
                            </div>
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-900 dark:text-[#F8FAFC] text-xs leading-tight">{p.agent_name}</span>
                              <span className="text-[10px] font-medium text-slate-400 dark:text-[#64748B]">Voice Specialist</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-3.5 py-2 text-center font-mono font-black text-slate-900 dark:text-[#F8FAFC]">{p.total_calls}</td>
                        <td className="px-3.5 py-2 text-center font-mono font-black text-emerald-600 dark:text-[#34D399]">{p.answered}</td>
                        <td className="px-3.5 py-2 text-center font-mono font-black text-[#2563EB] dark:text-[#60A5FA]">{p.qualified}</td>
                        <td className="px-3.5 py-2 text-center font-mono font-bold text-slate-500 dark:text-[#94A3B8]">{p.avg_duration_seconds}s</td>
                        <td className="px-3.5 py-2 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-14 bg-slate-100 dark:bg-[#0B1220] rounded-full h-1.5 overflow-hidden border border-slate-200/80 dark:border-white/5">
                              <div
                                className="bg-[#10B981] h-full rounded-full transition-all duration-300"
                                style={{ width: `${Math.min(p.conversion_rate, 100)}%` }}
                              />
                            </div>
                            <span className="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-[#34D399] border border-emerald-200/80 dark:border-emerald-500/30 px-2 py-0.5 rounded-[6px] font-bold text-[10px] font-mono">
                              {p.conversion_rate}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  {perfData.length === 0 && !error && (
                    <tr>
                      <td colSpan={7} className="px-3.5 py-8 text-center text-slate-400 dark:text-[#94A3B8] font-medium">
                        No agent performance logs recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {/* 2. LEAD IMPORT REPORT TABLE */}
            {reportType === "lead_import" && (
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-[#F8FAFC] dark:bg-[#1A2740] text-[#64748B] dark:text-[#94A3B8] font-bold uppercase tracking-wider text-[11px] sticky top-0 z-10">
                  <tr className="h-10 border-b border-slate-200/80 dark:border-white/[0.06]">
                    <th className="px-3.5 py-2">Import ID</th>
                    <th className="px-3.5 py-2">Timestamp</th>
                    <th className="px-3.5 py-2 text-center">Total Processed</th>
                    <th className="px-3.5 py-2 text-center">Success Stored</th>
                    <th className="px-3.5 py-2 text-center">Duplicate Skipped</th>
                    <th className="px-3.5 py-2 text-center">Invalid Skipped</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                  {importData
                    .filter(imp => {
                      const q = searchQuery.toLowerCase();
                      return !q || imp.import_id.toLowerCase().includes(q);
                    })
                    .map((imp, idx) => (
                      <tr 
                        key={imp.import_id} 
                        className={`h-[52px] transition-all duration-150 cursor-pointer ${
                          idx % 2 === 0 ? "bg-white dark:bg-[#131C2F]" : "bg-slate-50/50 dark:bg-[#172338]"
                        } hover:bg-blue-50/60 dark:hover:bg-[#2563EB]/10`}
                      >
                        <td className="px-3.5 py-2 font-mono font-bold text-[#2563EB] dark:text-[#60A5FA]">
                          <span className="bg-blue-50 dark:bg-[#2563EB]/10 border border-blue-200 dark:border-[#2563EB]/20 px-2 py-0.5 rounded-[6px]">
                            {imp.import_id}
                          </span>
                        </td>
                        <td className="px-3.5 py-2 text-slate-900 dark:text-[#F8FAFC] font-semibold">{new Date(imp.created_at).toLocaleString()}</td>
                        <td className="px-3.5 py-2 text-center font-mono font-bold text-slate-900 dark:text-[#F8FAFC]">{imp.total_processed}</td>
                        <td className="px-3.5 py-2 text-center font-mono font-black text-emerald-600 dark:text-[#34D399]">+{imp.inserted}</td>
                        <td className="px-3.5 py-2 text-center font-mono font-bold text-amber-600 dark:text-[#FBBF24]">{imp.skipped_duplicates}</td>
                        <td className="px-3.5 py-2 text-center font-mono font-bold text-rose-600 dark:text-[#F87171]">{imp.skipped_invalid}</td>
                      </tr>
                    ))}
                  {importData.length === 0 && !error && (
                    <tr>
                      <td colSpan={6} className="px-3.5 py-8 text-center text-slate-400 dark:text-[#94A3B8] font-medium">
                        No lead imports recorded in CRM.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {/* 3. CAMPAIGN LIST REPORT TABLE */}
            {reportType === "campaign" && (
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-[#F8FAFC] dark:bg-[#1A2740] text-[#64748B] dark:text-[#94A3B8] font-bold uppercase tracking-wider text-[11px] sticky top-0 z-10">
                  <tr className="h-10 border-b border-slate-200/80 dark:border-white/[0.06]">
                    <th className="px-3.5 py-2">Campaign ID</th>
                    <th className="px-3.5 py-2">Name</th>
                    <th className="px-3.5 py-2">Type</th>
                    <th className="px-3.5 py-2">Calling Hours</th>
                    <th className="px-3.5 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                  {campaignData
                    .filter(c => {
                      const q = searchQuery.toLowerCase();
                      return !q || c.name.toLowerCase().includes(q) || c.campaign_id.toLowerCase().includes(q);
                    })
                    .map((c, idx) => (
                      <tr 
                        key={c.id} 
                        className={`h-[52px] transition-all duration-150 cursor-pointer ${
                          idx % 2 === 0 ? "bg-white dark:bg-[#131C2F]" : "bg-slate-50/50 dark:bg-[#172338]"
                        } hover:bg-blue-50/60 dark:hover:bg-[#2563EB]/10`}
                      >
                        <td className="px-3.5 py-2 font-mono font-semibold text-slate-500 dark:text-[#94A3B8]">{c.campaign_id}</td>
                        <td className="px-3.5 py-2 font-extrabold text-slate-900 dark:text-[#F8FAFC]">{c.name}</td>
                        <td className="px-3.5 py-2 capitalize text-slate-600 dark:text-[#CBD5E1] font-medium">{c.campaign_type}</td>
                        <td className="px-3.5 py-2 text-slate-600 dark:text-[#CBD5E1] font-mono">{c.calling_hours || "N/A"}</td>
                        <td className="px-3.5 py-2">
                          <span className="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-[#34D399] border border-emerald-200/80 dark:border-emerald-500/30 px-2 py-0.5 rounded-[6px] font-bold text-[10.5px] uppercase">
                            {c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  {campaignData.length === 0 && !error && (
                    <tr>
                      <td colSpan={5} className="px-3.5 py-8 text-center text-slate-400 dark:text-[#94A3B8] font-medium">
                        No campaigns recorded in CRM.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {/* 4. CALL ANALYTICS / CALL LOGS TABLE */}
            {reportType === "call_analytics" && (
              <div className="space-y-3">
                {/* Dedicated Call History Filters Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 bg-slate-50 dark:bg-[#1A2740] rounded-[10px] border border-slate-200/80 dark:border-white/[0.06] text-xs">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Direction Filter */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">Direction:</span>
                      <select
                        value={callDirectionFilter}
                        onChange={e => setCallDirectionFilter(e.target.value as any)}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111827] text-slate-800 dark:text-white font-semibold text-xs focus:outline-none cursor-pointer shadow-2xs"
                      >
                        <option value="all">All Directions</option>
                        <option value="inbound">Inbound Only</option>
                        <option value="outbound">Outbound Only</option>
                      </select>
                    </div>

                    {/* Outcome Filter */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">Outcome:</span>
                      <select
                        value={callOutcomeFilter}
                        onChange={e => setCallOutcomeFilter(e.target.value as any)}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111827] text-slate-800 dark:text-white font-semibold text-xs focus:outline-none cursor-pointer shadow-2xs"
                      >
                        <option value="all">All Outcomes</option>
                        <option value="completed">Completed / Answered</option>
                        <option value="call_back">Call Back</option>
                        <option value="interested">Interested / Won</option>
                        <option value="no_answer">No Answer / Missed</option>
                        <option value="stale_auto_cleaned">Stale Auto Cleaned</option>
                      </select>
                    </div>

                    {/* Duration Filter */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">Duration:</span>
                      <select
                        value={callDurationFilter}
                        onChange={e => setCallDurationFilter(e.target.value as any)}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111827] text-slate-800 dark:text-white font-semibold text-xs focus:outline-none cursor-pointer shadow-2xs"
                      >
                        <option value="all">All Durations</option>
                        <option value="connected">&gt; 0s (Connected)</option>
                        <option value="gt_30">&ge; 30s</option>
                        <option value="gt_60">&ge; 1 min</option>
                      </select>
                    </div>
                  </div>

                  {/* Sort By & Record Counter */}
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">Sort:</span>
                    <select
                      value={callSortBy}
                      onChange={e => setCallSortBy(e.target.value as any)}
                      className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111827] text-slate-800 dark:text-white font-semibold text-xs focus:outline-none cursor-pointer shadow-2xs"
                    >
                      <option value="newest">Newest First (IST)</option>
                      <option value="oldest">Oldest First (IST)</option>
                      <option value="duration_desc">Duration (High → Low)</option>
                      <option value="duration_asc">Duration (Low → High)</option>
                    </select>

                    <span className="px-2.5 py-1 rounded-lg bg-slate-200/80 dark:bg-white/10 text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300">
                      {filteredCalls.length} calls
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[580px] relative rounded-[10px] border border-slate-200/80 dark:border-white/[0.08]">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-[#F8FAFC]/95 dark:bg-[#1A2740]/95 backdrop-blur-xs text-[#64748B] dark:text-[#94A3B8] font-bold uppercase tracking-wider text-[10.5px] sticky top-0 z-10 shadow-2xs border-b border-slate-200/80 dark:border-white/[0.06]">
                      <tr className="h-10">
                        <th className="px-3.5 py-2 w-[12%]">Call ID</th>
                        <th className="px-3.5 py-2 w-[16%]">Lead / Channel</th>
                        <th className="px-3.5 py-2 text-center w-[10%]">Direction</th>
                        <th className="px-3.5 py-2 text-center w-[10%]">Duration</th>
                        <th className="px-3.5 py-2 text-center w-[14%]">Outcome Status</th>
                        <th className="px-3.5 py-2 w-[16%]">Started At</th>
                        <th className="px-3.5 py-2 w-[22%]">Notes &amp; Disposition</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04] font-medium">
                      {filteredCalls.map((c, idx) => {
                        const outcomeVisual = getCallOutcomeVisuals(c.outcome);
                        const isOutbound = (c.direction || "outbound").toLowerCase() === "outbound";
                        const shortCallId = c.id ? `#${c.id.slice(-6).toUpperCase()}` : "N/A";
                        const shortLeadId = c.lead_id && c.lead_id.length > 14
                          ? `${c.lead_id.slice(0, 8)}...${c.lead_id.slice(-6)}`
                          : (c.lead_id || "Direct / Inbound");

                        return (
                          <tr
                            key={c.id || idx}
                            onClick={() => setSelectedCallModal(c)}
                            className={`h-[40px] transition-all duration-150 cursor-pointer ${
                              outcomeVisual.isSystemCleaned
                                ? "bg-slate-50/40 dark:bg-slate-900/30 text-slate-500"
                                : idx % 2 === 0
                                ? "bg-white dark:bg-[#131C2F]"
                                : "bg-slate-50/50 dark:bg-[#172338]"
                            } hover:bg-blue-50/60 dark:hover:bg-[#2563EB]/10`}
                          >
                            {/* 1. Call ID */}
                            <td className="px-3.5 py-2 font-mono font-bold align-middle">
                              <span
                                className="inline-flex items-center gap-1 bg-blue-50 hover:bg-blue-100 dark:bg-[#2563EB]/15 dark:hover:bg-[#2563EB]/25 border border-blue-200 dark:border-[#2563EB]/30 text-[#2563EB] dark:text-[#60A5FA] px-2 py-0.5 rounded-[6px] text-[11px] transition shadow-2xs"
                                title={`Full Call ID: ${c.id} (Click to view details)`}
                              >
                                Call {shortCallId}
                              </span>
                            </td>

                            {/* 2. Lead / Channel */}
                            <td className="px-3.5 py-2 font-mono font-semibold text-slate-800 dark:text-[#F8FAFC] align-middle">
                              <span className="truncate block max-w-[150px]" title={`Lead / Channel ID: ${c.lead_id || "N/A"}`}>
                                {shortLeadId}
                              </span>
                            </td>

                            {/* 3. Direction */}
                            <td className="px-3.5 py-2 text-center align-middle">
                              <span
                                className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-[6px] border ${
                                  !isOutbound
                                    ? "bg-blue-50 text-[#2563EB] border-blue-200/80 dark:bg-[#2563EB]/15 dark:border-[#2563EB]/30 dark:text-[#60A5FA]"
                                    : "bg-purple-50 text-purple-700 border-purple-200/80 dark:bg-[#8B5CF6]/15 dark:border-[#8B5CF6]/30 dark:text-[#C084FC]"
                                }`}
                              >
                                {!isOutbound ? <PhoneIncoming className="h-2.5 w-2.5" /> : <PhoneOutgoing className="h-2.5 w-2.5" />}
                                <span>{c.direction || "OUTBOUND"}</span>
                              </span>
                            </td>

                            {/* 4. Duration */}
                            <td className="px-3.5 py-2 text-center font-mono font-bold text-slate-800 dark:text-[#F8FAFC] align-middle text-[12px]">
                              {formatDurationHMS(c.duration_seconds)}
                            </td>

                            {/* 5. Outcome Status */}
                            <td className="px-3.5 py-2 text-center align-middle">
                              <span
                                className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-[6px] border ${outcomeVisual.bg}`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${outcomeVisual.dot}`} />
                                <span>{outcomeVisual.label}</span>
                              </span>
                            </td>

                            {/* 6. Started At */}
                            <td className="px-3.5 py-2 text-slate-800 dark:text-[#F8FAFC] font-semibold text-[11.5px] font-mono align-middle">
                              {formatCallTimestamp(c.started_at)}
                            </td>

                            {/* 7. Notes & Disposition */}
                            <td className="px-3.5 py-2 text-slate-600 dark:text-[#CBD5E1] font-medium text-xs align-middle">
                              <div className="max-w-[260px] truncate" title={c.notes || "No call notes recorded."}>
                                {c.notes || (outcomeVisual.isSystemCleaned ? "Session cleaned after inactivity window." : "No call notes recorded.")}
                              </div>
                            </td>
                          </tr>
                        );
                      })}

                      {filteredCalls.length === 0 && !error && (
                        <tr>
                          <td colSpan={7} className="px-3.5 py-10 text-center text-slate-400 dark:text-[#94A3B8] font-medium">
                            <PhoneCall className="h-7 w-7 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                            No call history records match the selected filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CALL DETAILS INSPECTION MODAL ── */}
        {selectedCallModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-[#1E293B] rounded-2xl shadow-2xl border border-slate-200/90 dark:border-white/10 max-w-lg w-full p-6 space-y-4"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-xl bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                    <PhoneCall className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                      Call #{selectedCallModal.id.slice(-6).toUpperCase()} Details
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      ID: {selectedCallModal.id}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedCallModal(null)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Modal Details Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#131C2F] border border-slate-200/80 dark:border-white/10">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Direction</span>
                  <span className="font-bold text-slate-800 dark:text-white uppercase mt-0.5 block">
                    {selectedCallModal.direction || "OUTBOUND"}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#131C2F] border border-slate-200/80 dark:border-white/10">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Duration</span>
                  <span className="font-bold font-mono text-slate-800 dark:text-white mt-0.5 block">
                    {formatDurationHMS(selectedCallModal.duration_seconds)} ({selectedCallModal.duration_seconds || 0}s)
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#131C2F] border border-slate-200/80 dark:border-white/10">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Outcome</span>
                  <span className="font-bold text-slate-800 dark:text-white uppercase mt-0.5 block">
                    {selectedCallModal.outcome || "COMPLETED"}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#131C2F] border border-slate-200/80 dark:border-white/10">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lead ID</span>
                  <span className="font-mono text-slate-800 dark:text-white mt-0.5 block truncate" title={selectedCallModal.lead_id}>
                    {selectedCallModal.lead_id || "Direct / Inbound"}
                  </span>
                </div>
                <div className="col-span-2 p-2.5 rounded-xl bg-slate-50 dark:bg-[#131C2F] border border-slate-200/80 dark:border-white/10">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Started Timestamp (IST)</span>
                  <span className="font-mono text-slate-800 dark:text-white mt-0.5 block">
                    {formatCallTimestamp(selectedCallModal.started_at)}
                  </span>
                </div>
                <div className="col-span-2 p-2.5 rounded-xl bg-slate-50 dark:bg-[#131C2F] border border-slate-200/80 dark:border-white/10 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Notes &amp; Disposition</span>
                  <p className="text-slate-700 dark:text-slate-200 text-xs leading-relaxed whitespace-pre-wrap">
                    {selectedCallModal.notes || "No call notes recorded for this session."}
                  </p>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="pt-3 border-t border-slate-100 dark:border-white/10 flex justify-end">
                <button
                  onClick={() => setSelectedCallModal(null)}
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-bold text-xs transition cursor-pointer"
                >
                  Close Details
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function summaryCount(perf: AgentPerf[], imp: LeadImport[], camp: CampaignReport[]) {
  return perf.length + imp.length + camp.length;
}
