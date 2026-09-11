import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useFollowUps, FollowUpItem, FollowUpTimelineItem } from "../context/FollowUpContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api } from "../api/client";
import { formatISTDateTime, formatISTDateParts, parseToDate } from "../utils/dateUtils";
import CreateFollowUpModal from "../components/CreateFollowUpModal";
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertOctagon,
  AlertTriangle,
  Trash2,
  Phone,
  Search,
  RefreshCw,
  Plus,
  Filter,
  User,
  Shield,
  PhoneCall,
  RotateCcw,
  Check,
  X,
  ChevronRight,
  Sparkles,
  ExternalLink,
  Volume2,
  Users,
  Activity,
  History,
  ArrowRight,
  UserCheck,
  UserX,
  Radio,
  Layers,
  Zap,
  FileText,
  Tag,
} from "lucide-react";

export default function FollowUps() {
  const {
    followUps,
    stats,
    loading,
    fetchFollowUps,
    fetchStats,
    completeFollowUp,
    cancelFollowUp,
    deleteFollowUp,
    updateFollowUp,
    triggerAutoCall,
    reassignFollowUp,
  } = useFollowUps();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<"all" | "due" | "upcoming" | "waiting" | "completed" | "missed" | "cancelled">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Timeline Modal State & Category Filter
  const [timelineModalItem, setTimelineModalItem] = useState<FollowUpItem | null>(null);
  const [timelineCategory, setTimelineCategory] = useState<"all" | "calls" | "assignments" | "status" | "followups">("all");

  // Delete / Cancel Confirmation Modal State
  const [deleteModalItem, setDeleteModalItem] = useState<FollowUpItem | null>(null);
  const [cancelReason, setCancelReason] = useState("Customer requested cancellation");
  const [isDeleting, setIsDeleting] = useState(false);

  // Close modals on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTimelineModalItem(null);
        setReassignModalItem(null);
        setRescheduleModalItem(null);
        setCompleteModalItem(null);
        setDeleteModalItem(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Reassign Modal State
  const [reassignModalItem, setReassignModalItem] = useState<FollowUpItem | null>(null);
  const [availableAgents, setAvailableAgents] = useState<Array<{ id: string; name: string; email?: string; role?: string; status?: string }>>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [reassignReason, setReassignReason] = useState("");
  const [isReassigning, setIsReassigning] = useState(false);

  // Reschedule Modal State
  const [rescheduleModalItem, setRescheduleModalItem] = useState<FollowUpItem | null>(null);
  const [rescheduleDateTime, setRescheduleDateTime] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");

  // Complete Modal State
  const [completeModalItem, setCompleteModalItem] = useState<FollowUpItem | null>(null);
  const [completionNotes, setCompletionNotes] = useState("");
  const [completionOutcome, setCompletionOutcome] = useState("completed");

  // Action Loading State
  const [callingId, setCallingId] = useState<string | null>(null);

  useEffect(() => {
    fetchFollowUps(activeTab, searchTerm);
    fetchStats();
  }, [activeTab, fetchFollowUps, fetchStats]);

  // Load available agents for reassignment modal
  useEffect(() => {
    const fetchAgentsList = async () => {
      try {
        const res: any = await api.get("/api/users?limit=100");
        const list = Array.isArray(res) ? res : res.users || [];
        setAvailableAgents(
          list.map((u: any) => ({
            id: u.id || u._id,
            name: u.name || u.full_name || u.username || "Agent",
            email: u.email || "",
            role: u.role || "agent",
            status: u.status || "offline",
          }))
        );
      } catch (err) {
        console.error("Failed to fetch agent list for reassignment:", err);
      }
    };
    fetchAgentsList();
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchFollowUps(activeTab, searchTerm);
  };

  const handleDial = (fu: FollowUpItem) => {
    const rawPhone = (fu.customer_phone || fu.phone_number || "").replace(/\D/g, "");
    navigate(`/dialer?phone=${rawPhone}&leadId=${fu.customer_id || fu.lead_id || ""}&name=${encodeURIComponent(fu.customer_name)}`);
  };

  const handleTriggerAutoCall = async (fu: FollowUpItem) => {
    try {
      setCallingId(fu.id);
      const ok = await triggerAutoCall(fu.id);
      if (ok) {
        showToast(`Auto-Call triggered successfully for ${fu.customer_name}`, "success");
        await fetchFollowUps(activeTab, searchTerm);
      }
    } finally {
      setCallingId(null);
    }
  };

  const handleSaveReassign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reassignModalItem || !selectedAgentId) return;
    try {
      setIsReassigning(true);
      const ok = await reassignFollowUp(reassignModalItem.id, selectedAgentId, undefined, reassignReason || "Supervisor Reassigned");
      if (ok) {
        setReassignModalItem(null);
        setSelectedAgentId("");
        setReassignReason("");
        await fetchFollowUps(activeTab, searchTerm);
      }
    } finally {
      setIsReassigning(false);
    }
  };

  const handleSaveReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescheduleModalItem || !rescheduleDateTime) return;
    await updateFollowUp(rescheduleModalItem.id, {
      follow_up_datetime: rescheduleDateTime,
      scheduled_at: rescheduleDateTime,
      reschedule_reason: rescheduleReason || "Agent Rescheduled",
    });
    setRescheduleModalItem(null);
    setRescheduleDateTime("");
    setRescheduleReason("");
    await fetchFollowUps(activeTab, searchTerm);
  };

  const handleSaveCompletion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completeModalItem) return;
    await completeFollowUp(completeModalItem.id, undefined, completionOutcome, completionNotes);
    setCompleteModalItem(null);
    setCompletionNotes("");
    setCompletionOutcome("completed");
    await fetchFollowUps(activeTab, searchTerm);
  };

  const handleConfirmDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteModalItem) return;
    setIsDeleting(true);
    try {
      const targetId = deleteModalItem.id || deleteModalItem._id || deleteModalItem.follow_up_id || "";
      const ok = await cancelFollowUp(targetId, cancelReason);
      if (ok) {
        setDeleteModalItem(null);
        setCancelReason("Customer requested cancellation");
        await fetchFollowUps(activeTab, searchTerm);
        await fetchStats();
      }
    } catch (err: any) {
      console.error("Failed to cancel follow up:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDisplayDateTime = (dtStr?: string, formattedIst?: string) => {
    if (formattedIst && formattedIst !== "Not set") return formattedIst;
    if (!dtStr) return "Not set";
    return formatISTDateTime(dtStr);
  };

  const getRelativeTime = (dtStr?: string, status?: string) => {
    if (!dtStr) return "";
    try {
      const d = parseToDate(dtStr);
      if (!d) return "";
      const target = d.getTime();
      const now = Date.now();
      const diffMins = Math.round((target - now) / (1000 * 60));

      if (status === "completed") return "Completed";
      if (status === "cancelled") return "Cancelled";
      if (status === "auto_calling") return "Auto-Calling Now";
      if (status === "waiting_for_agent") return "Waiting for Agent";
      if (status === "missed") {
        const pastMins = Math.abs(diffMins);
        if (pastMins < 60) return `${pastMins}m overdue`;
        const pastHours = Math.round(pastMins / 60);
        return `${pastHours}h overdue`;
      }
      if (status === "due" || (diffMins <= 0 && diffMins > -30)) return "Due Right Now";
      if (diffMins > 0 && diffMins < 60) return `In ${diffMins} mins`;
      if (diffMins >= 60 && diffMins < 1440) return `In ${Math.round(diffMins / 60)} hours`;
      if (diffMins >= 1440) return `In ${Math.round(diffMins / 1440)} days`;
      return "Past Due";
    } catch {
      return "";
    }
  };

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    switch (s) {
      case "due":
        return {
          label: "Due Now",
          bg: "bg-amber-50 text-amber-700 border-amber-300 ring-1 ring-amber-200",
          dot: "bg-amber-500 animate-ping",
        };
      case "auto_calling":
        return {
          label: "Auto Calling",
          bg: "bg-cyan-50 text-cyan-700 border-cyan-300 ring-2 ring-cyan-400 animate-pulse",
          dot: "bg-cyan-500 animate-spin",
        };
      case "waiting_for_agent":
        return {
          label: "Waiting Agent",
          bg: "bg-purple-50 text-purple-700 border-purple-300",
          dot: "bg-purple-500 animate-pulse",
        };
      case "connected":
        return {
          label: "Connected",
          bg: "bg-emerald-50 text-emerald-700 border-emerald-300 ring-1 ring-emerald-300",
          dot: "bg-emerald-500",
        };
      case "no_answer":
        return {
          label: "No Answer",
          bg: "bg-orange-50 text-orange-700 border-orange-300",
          dot: "bg-orange-500",
        };
      case "completed":
        return {
          label: "Completed",
          bg: "bg-emerald-50 text-emerald-700 border-emerald-300",
          dot: "bg-emerald-500",
        };
      case "missed":
        return {
          label: "Missed",
          bg: "bg-rose-50 text-rose-700 border-rose-300",
          dot: "bg-rose-500",
        };
      case "cancelled":
        return {
          label: "Cancelled",
          bg: "bg-slate-100 text-slate-600 border-slate-300",
          dot: "bg-slate-400",
        };
      case "scheduled":
      default:
        return {
          label: "Scheduled",
          bg: "bg-blue-50 text-blue-700 border-blue-300",
          dot: "bg-blue-500",
        };
    }
  };

  const filteredItems = useMemo(() => {
    return followUps.filter((item) => {
      const s = item.status?.toLowerCase();
      if (activeTab === "due" && s !== "due" && s !== "auto_calling") return false;
      if (activeTab === "upcoming" && s !== "scheduled") return false;
      if (activeTab === "waiting" && s !== "waiting_for_agent") return false;
      if (activeTab === "completed" && s !== "completed") return false;
      if (activeTab === "missed" && s !== "missed") return false;
      if (activeTab === "cancelled" && s !== "cancelled") return false;

      if (!searchTerm) return true;
      const q = searchTerm.toLowerCase();
      return (
        (item.customer_name || "").toLowerCase().includes(q) ||
        (item.customer_phone || "").includes(q) ||
        (item.reason || "").toLowerCase().includes(q) ||
        (item.agent_name || "").toLowerCase().includes(q) ||
        (item.current_agent_name || "").toLowerCase().includes(q) ||
        (item.original_agent_name || "").toLowerCase().includes(q) ||
        (item.pool_name || "").toLowerCase().includes(q)
      );
    });
  }, [followUps, activeTab, searchTerm]);

  const getEventCategory = (entry: any): "calls" | "assignments" | "status" | "followups" => {
    const act = (entry.action || entry.event || "").toLowerCase();
    if (act.includes("call") || act.includes("dial") || act.includes("ring") || act.includes("connect") || act.includes("answer")) return "calls";
    if (act.includes("assign") || act.includes("transfer") || act.includes("pool") || act.includes("agent")) return "assignments";
    if (act.includes("due") || act.includes("miss") || act.includes("wait") || act.includes("schedul") || act.includes("status")) return "status";
    return "followups";
  };

  const getTimelineEventVisuals = (actionName: string) => {
    const act = actionName.toUpperCase();
    if (act.includes("COMPLETED") || act.includes("CONNECTED") || act.includes("RESOLVED") || act.includes("WON")) {
      return {
        badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200",
        nodeBg: "bg-emerald-500",
        nodeRing: "ring-emerald-100",
        icon: <CheckCircle2 className="h-3.5 w-3.5 text-white" />,
      };
    }
    if (act.includes("CALL") || act.includes("INITIATED") || act.includes("RINGING") || act.includes("DIAL")) {
      return {
        badgeBg: "bg-cyan-50 text-cyan-700 border-cyan-200",
        nodeBg: "bg-cyan-500",
        nodeRing: "ring-cyan-100",
        icon: <PhoneCall className="h-3.5 w-3.5 text-white" />,
      };
    }
    if (act.includes("REASSIGN") || act.includes("ASSIGN") || act.includes("TRANSFER") || act.includes("POOL")) {
      return {
        badgeBg: "bg-purple-50 text-purple-700 border-purple-200",
        nodeBg: "bg-purple-500",
        nodeRing: "ring-purple-100",
        icon: <Users className="h-3.5 w-3.5 text-white" />,
      };
    }
    if (act.includes("RESCHEDULE") || act.includes("DUE") || act.includes("SCHEDULE")) {
      return {
        badgeBg: "bg-amber-50 text-amber-700 border-amber-200",
        nodeBg: "bg-amber-500",
        nodeRing: "ring-amber-100",
        icon: <Clock className="h-3.5 w-3.5 text-white" />,
      };
    }
    if (act.includes("FAIL") || act.includes("MISSED") || act.includes("CANCEL") || act.includes("UNAVAILABLE")) {
      return {
        badgeBg: "bg-rose-50 text-rose-700 border-rose-200",
        nodeBg: "bg-rose-500",
        nodeRing: "ring-rose-100",
        icon: <AlertOctagon className="h-3.5 w-3.5 text-white" />,
      };
    }
    if (act.includes("DISPOSITION") || act.includes("NOTE") || act.includes("OUTCOME")) {
      return {
        badgeBg: "bg-indigo-50 text-indigo-700 border-indigo-200",
        nodeBg: "bg-indigo-500",
        nodeRing: "ring-indigo-100",
        icon: <FileText className="h-3.5 w-3.5 text-white" />,
      };
    }
    return {
      badgeBg: "bg-blue-50 text-blue-700 border-blue-200",
      nodeBg: "bg-blue-500",
      nodeRing: "ring-blue-100",
      icon: <Activity className="h-3.5 w-3.5 text-white" />,
    };
  };

  const groupedTimelineEvents = useMemo(() => {
    if (!timelineModalItem?.timeline || timelineModalItem.timeline.length === 0) return [];

    const rawList = [...timelineModalItem.timeline];
    const filtered =
      timelineCategory === "all"
        ? rawList
        : rawList.filter((entry) => getEventCategory(entry) === timelineCategory);

    const grouped: Array<{
      id: string;
      action: string;
      description: string;
      actor: string;
      actor_role?: string;
      timestamp: string;
      metadata?: Record<string, any>;
      count: number;
    }> = [];

    filtered.forEach((entry: any, index: number) => {
      const prev = grouped[grouped.length - 1];
      const isConsecutiveDuplicate =
        prev &&
        prev.action === entry.action &&
        prev.description === entry.description &&
        prev.actor === entry.actor &&
        (prev.metadata?.call_id || "") === (entry.metadata?.call_id || "");

      if (isConsecutiveDuplicate) {
        prev.count += 1;
      } else {
        grouped.push({
          id: entry.id || `tl-${index}`,
          action: entry.action || entry.event || "EVENT",
          description: entry.description || "",
          actor: entry.actor || "System Scheduler",
          actor_role: entry.actor_role,
          timestamp: entry.timestamp,
          metadata: entry.metadata,
          count: 1,
        });
      }
    });

    return grouped;
  }, [timelineModalItem, timelineCategory]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full font-sans pb-16">
      {/* ── 1. HEADER ── */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-2xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
            <Calendar className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-slate-900 tracking-tight">Scheduled Auto-Call & Follow-Up Engine</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                Enterprise BPO Queue
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Server-side atomic auto-dialer • Smart pool fallback • Complete audit trail • Timezone: IST (UTC+05:30)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => {
              fetchStats();
              fetchFollowUps(activeTab, searchTerm);
            }}
            className="h-9 px-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center gap-2 transition cursor-pointer active:scale-95"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-2 shadow-sm transition active:scale-95 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Schedule Follow-Up</span>
          </button>
        </div>
      </div>

      {/* ── 2. KPI METRIC CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Due / Auto-Calling */}
        <div
          onClick={() => setActiveTab("due")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer select-none ${
            activeTab === "due"
              ? "bg-amber-500/10 border-amber-400 ring-2 ring-amber-400 shadow-md"
              : "bg-white border-slate-200/80 hover:border-amber-300 hover:shadow-xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-amber-700">Due / Calling</span>
            <div className="h-8 w-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Clock className="h-4 w-4 animate-spin" style={{ animationDuration: "8s" }} />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-amber-900 mt-2 flex items-baseline gap-2">
            {stats.due_now || 0}
            {stats.due_now > 0 && (
              <span className="text-[11px] font-bold text-amber-700 flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" /> Auto-Dialing
              </span>
            )}
          </div>
          <p className="text-[11px] text-amber-600/90 font-medium mt-1">Ready for scheduled callback</p>
        </div>

        {/* Scheduled / Upcoming */}
        <div
          onClick={() => setActiveTab("upcoming")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer select-none ${
            activeTab === "upcoming"
              ? "bg-blue-500/10 border-blue-500 ring-2 ring-blue-400 shadow-md"
              : "bg-white border-slate-200/80 hover:border-blue-300 hover:shadow-xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-blue-700">Upcoming</span>
            <div className="h-8 w-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Calendar className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-blue-900 mt-2">{stats.upcoming || 0}</div>
          <p className="text-[11px] text-blue-600/90 font-medium mt-1">Scheduled future callbacks</p>
        </div>

        {/* Waiting for Agent */}
        <div
          onClick={() => setActiveTab("waiting")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer select-none ${
            activeTab === "waiting"
              ? "bg-purple-500/10 border-purple-500 ring-2 ring-purple-400 shadow-md"
              : "bg-white border-slate-200/80 hover:border-purple-300 hover:shadow-xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-purple-700">Waiting Agent</span>
            <div className="h-8 w-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-purple-900 mt-2">
            {followUps.filter((f) => f.status === "waiting_for_agent").length}
          </div>
          <p className="text-[11px] text-purple-600/90 font-medium mt-1">Pending pool agent availability</p>
        </div>

        {/* Completed */}
        <div
          onClick={() => setActiveTab("completed")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer select-none ${
            activeTab === "completed"
              ? "bg-emerald-500/10 border-emerald-500 ring-2 ring-emerald-400 shadow-md"
              : "bg-white border-slate-200/80 hover:border-emerald-300 hover:shadow-xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-emerald-700">Completed</span>
            <div className="h-8 w-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-emerald-900 mt-2">{stats.completed || 0}</div>
          <p className="text-[11px] text-emerald-600/90 font-medium mt-1">Successfully handled callbacks</p>
        </div>

        {/* Missed */}
        <div
          onClick={() => setActiveTab("missed")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer select-none ${
            activeTab === "missed"
              ? "bg-rose-500/10 border-rose-500 ring-2 ring-rose-400 shadow-md"
              : "bg-white border-slate-200/80 hover:border-rose-300 hover:shadow-xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-rose-700">Missed</span>
            <div className="h-8 w-8 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
              <AlertOctagon className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-rose-900 mt-2">{stats.missed || 0}</div>
          <p className="text-[11px] text-rose-600/90 font-medium mt-1">Unreached / passed window</p>
        </div>
      </div>

      {/* ── 3. SEARCH & TAB BAR ── */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto">
          {(
            [
              { id: "all", label: "All Items", count: stats.total },
              { id: "due", label: "Due / Calling", count: stats.due_now },
              { id: "upcoming", label: "Scheduled", count: stats.upcoming },
              {
                id: "waiting",
                label: "Waiting Agent",
                count: followUps.filter((f) => f.status === "waiting_for_agent").length,
              },
              { id: "completed", label: "Completed", count: stats.completed },
              { id: "missed", label: "Missed", count: stats.missed },
              {
                id: "cancelled",
                label: "Cancelled",
                count: stats.cancelled ?? followUps.filter((f) => f.status === "cancelled").length,
              },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                activeTab === t.id
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
              }`}
            >
              <span>{t.label}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeTab === t.id ? "bg-slate-100 text-slate-800" : "bg-slate-200 text-slate-600"
                }`}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>

        <form onSubmit={handleSearchSubmit} className="relative sm:w-72">
          <Search className="h-3.5 w-3.5 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search customer, phone, agent..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none text-xs text-slate-900 font-medium"
          />
        </form>
      </div>

      {/* ── 4. ENTERPRISE BPO FOLLOW-UPS DATA TABLE ── */}
      <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto max-h-[640px] relative">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs border-b border-slate-200/90 shadow-2xs">
              <tr>
                <th className="py-3 px-4 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 w-[22%]">
                  Customer / Contact
                </th>
                <th className="py-3 px-4 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 w-[17%]">
                  Agent & Pool
                </th>
                <th className="py-3 px-4 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 w-[16%]">
                  Scheduled (IST)
                </th>
                <th className="py-3 px-4 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 w-[19%]">
                  Reason & Notes
                </th>
                <th className="py-3 px-4 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 w-[12%]">
                  Status & Attempts
                </th>
                <th className="py-3 px-4 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 w-[14%]">
                  Related Call
                </th>
                <th className="py-3 px-4 text-right text-[10.5px] font-bold uppercase tracking-wider text-slate-500 w-[10%]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filteredItems.map((item) => {
                const targetDt = item.scheduled_at || item.follow_up_datetime;
                const istParts = formatISTDateParts(targetDt);
                const relativeLabel = getRelativeTime(targetDt, item.status);
                const badge = getStatusBadge(item.status);
                const isDue = item.status === "due";
                const isAutoCalling = item.status === "auto_calling";
                const isMissed = item.status === "missed";
                const isCompleted = item.status === "completed";
                const isCancelled = item.status === "cancelled";
                const isReassigned =
                  item.original_agent_name &&
                  item.current_agent_name &&
                  item.original_agent_name !== item.current_agent_name;

                const rawPhone = (item.customer_phone || item.phone_number || "").replace(/\D/g, "");
                const formattedPhone = rawPhone.length >= 10
                  ? `+91 ${rawPhone.slice(-10, -5)} ${rawPhone.slice(-5)}`
                  : (rawPhone ? `+91 ${rawPhone}` : "+91 —");

                const shortId = (item.follow_up_id || item.id || "").slice(-8);
                const attemptsCount = item.call_attempts_count ?? (item.attempts?.length || 0);

                return (
                  <tr
                    key={item.id}
                    className={`group hover:bg-blue-50/30 transition-colors ${
                      isAutoCalling
                        ? "bg-cyan-50/40"
                        : isDue
                        ? "bg-amber-50/30"
                        : isMissed
                        ? "bg-rose-50/20"
                        : isCancelled
                        ? "bg-slate-50/60 opacity-80"
                        : ""
                    }`}
                  >
                    {/* 1. Customer / Contact */}
                    <td className="py-3.5 px-4 align-middle">
                      <div className="text-[14px] font-bold text-slate-900 leading-tight">
                        {item.customer_name || "Customer"}
                      </div>
                      <div className="text-[12.5px] font-semibold text-blue-700 font-mono mt-0.5 tracking-tight">
                        {formattedPhone}
                      </div>
                      {shortId && (
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                          ID: #{shortId}
                        </div>
                      )}
                    </td>

                    {/* 2. Agent Assignment & Pool */}
                    <td className="py-3.5 px-4 align-middle">
                      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                        <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{item.current_agent_name || item.agent_name || "Unassigned"}</span>
                        {isReassigned && (
                          <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-purple-50 text-purple-700 border border-purple-200 shrink-0">
                            Reassigned
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100/90 text-slate-600 text-[11px] font-medium border border-slate-200/60">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                          <span className="truncate max-w-[130px]">{item.pool_name || "Customer Support"}</span>
                        </span>
                      </div>
                    </td>

                    {/* 3. Scheduled Time (IST) */}
                    <td className="py-3.5 px-4 align-middle">
                      <div className="text-[13px] font-bold text-slate-900 leading-tight">
                        {istParts.date}
                      </div>
                      <div className="text-[12px] font-mono font-medium text-slate-600 mt-0.5">
                        {istParts.time || "Time not set"}
                      </div>
                      {relativeLabel && (
                        <span
                          className={`inline-block text-[10.5px] font-bold px-2 py-0.5 rounded-md mt-1 ${
                            isAutoCalling
                              ? "bg-cyan-100 text-cyan-800 border border-cyan-300 animate-pulse"
                              : isDue
                              ? "bg-amber-100 text-amber-800 border border-amber-300 animate-pulse"
                              : isMissed
                              ? "bg-rose-100 text-rose-800 border border-rose-300"
                              : isCompleted
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                              : isCancelled
                              ? "bg-slate-100 text-slate-700 border border-slate-300"
                              : "bg-blue-50 text-blue-800 border border-blue-200"
                          }`}
                        >
                          {relativeLabel}
                        </span>
                      )}
                    </td>

                    {/* 4. Reason & Notes */}
                    <td className="py-3.5 px-4 align-middle max-w-xs">
                      <div className="text-[13px] font-semibold text-slate-900 leading-tight truncate" title={item.reason}>
                        {item.reason || "Follow-up after call (Call Back)"}
                      </div>
                      {item.notes ? (
                        <p className="text-[12px] text-slate-500 line-clamp-1 truncate mt-0.5" title={item.notes}>
                          {item.notes}
                        </p>
                      ) : (
                        <p className="text-[11px] text-slate-400 italic mt-0.5">No notes</p>
                      )}
                    </td>

                    {/* 5. Status & Attempts */}
                    <td className="py-3.5 px-4 align-middle">
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.8 rounded-full text-[10.5px] font-bold uppercase tracking-wider border ${badge.bg}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                          {badge.label}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500 font-medium">
                          Attempts: {attemptsCount}
                        </span>
                      </div>
                    </td>

                    {/* 6. Related Call & Final Disposition */}
                    <td className="py-3.5 px-4 align-middle">
                      {item.related_call_id || item.original_call_id ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center font-mono text-[11px] font-bold text-blue-700 bg-blue-50/90 px-2 py-0.5 rounded border border-blue-200/80">
                            Call #{(item.related_call_id || item.original_call_id || "").slice(-6).toUpperCase()}
                          </span>
                          <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                            {item.completion_outcome || item.disposition || "Logged"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px] italic">—</span>
                      )}
                    </td>

                    {/* 7. Actions */}
                    <td className="py-3.5 px-4 align-middle text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Auto-Call Trigger Button */}
                        {!isCompleted && !isCancelled && (
                          <button
                            onClick={() => handleTriggerAutoCall(item)}
                            disabled={callingId === item.id || isAutoCalling}
                            className={`h-8 px-2.5 rounded-lg font-bold text-[11.5px] flex items-center gap-1.5 transition active:scale-95 shadow-2xs cursor-pointer ${
                              isAutoCalling
                                ? "bg-cyan-600 text-white animate-pulse"
                                : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
                            }`}
                            title="Trigger Server-Side Auto-Call Now"
                          >
                            <Zap className={`h-3.5 w-3.5 ${callingId === item.id ? "animate-spin" : ""}`} />
                            <span className="hidden xl:inline">{isAutoCalling ? "Calling..." : "Auto-Call"}</span>
                          </button>
                        )}

                        {/* Dial Softphone Button */}
                        {!isCompleted && !isCancelled && (
                          <button
                            onClick={() => handleDial(item)}
                            className="h-8 w-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold flex items-center justify-center transition active:scale-95 cursor-pointer shadow-2xs"
                            title="Dial Customer via Softphone"
                          >
                            <Phone className="h-3.5 w-3.5 text-slate-600" />
                          </button>
                        )}

                        {/* View Call / Follow-Up Details Button */}
                        <button
                          onClick={() => setTimelineModalItem(item)}
                          className="h-8 w-8 rounded-lg border border-slate-200 bg-white hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 text-slate-700 font-semibold flex items-center justify-center transition active:scale-95 cursor-pointer shadow-2xs"
                          title="View Call & Follow-Up Details (Audit Timeline)"
                        >
                          <History className="h-3.5 w-3.5 text-slate-600" />
                        </button>

                        {/* Reassign Button */}
                        {!isCompleted && !isCancelled && (
                          <button
                            onClick={() => {
                              setReassignModalItem(item);
                              setSelectedAgentId(item.current_agent_id || item.agent_id || "");
                            }}
                            className="h-8 w-8 rounded-lg border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-700 font-semibold flex items-center justify-center transition active:scale-95 cursor-pointer shadow-2xs"
                            title="Reassign Agent or Pool"
                          >
                            <Users className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Reschedule Button */}
                        {!isCompleted && !isCancelled && (
                          <button
                            onClick={() => {
                              setRescheduleModalItem(item);
                              setRescheduleDateTime(
                                (item.scheduled_at || item.follow_up_datetime || "").slice(0, 16)
                              );
                            }}
                            className="h-8 w-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold flex items-center justify-center transition active:scale-95 cursor-pointer shadow-2xs"
                            title="Reschedule Callback Time"
                          >
                            <RotateCcw className="h-3.5 w-3.5 text-slate-600" />
                          </button>
                        )}

                        {/* Complete Button */}
                        {!isCompleted && !isCancelled && (
                          <button
                            onClick={() => setCompleteModalItem(item)}
                            className="h-8 w-8 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold flex items-center justify-center transition active:scale-95 cursor-pointer shadow-2xs"
                            title="Mark Follow-Up Completed"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Safe Delete / Cancel Follow-Up Button (Available on Scheduled, Due, Missed, and Completed) */}
                        {!isCancelled && !isAutoCalling && (
                          <button
                            onClick={() => {
                              setDeleteModalItem(item);
                              setCancelReason(
                                item.status === "completed"
                                  ? "Archived completed follow-up"
                                  : "Customer requested cancellation"
                              );
                            }}
                            className="h-8 w-8 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600 font-semibold flex items-center justify-center transition active:scale-95 cursor-pointer shadow-2xs"
                            title={
                              item.status === "completed"
                                ? "Delete / Archive Completed Follow-Up"
                                : "Cancel / Delete Scheduled Callback (Safe Soft-Delete)"
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredItems.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500 font-medium text-xs">
                    <Calendar className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    No follow-up items found for this filter tab.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 5. ENTERPRISE BPO TIMELINE AUDIT MODAL ── */}
      {timelineModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200/90 max-w-3xl w-full p-6 space-y-4 max-h-[92vh] flex flex-col overflow-hidden"
          >
            {/* 1. Modal Fixed Header */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-3.5 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0 shadow-2xs">
                  <History className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                      Follow-Up Audit & Reassignment Timeline
                    </h3>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider border ${
                        getStatusBadge(timelineModalItem.status).bg
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${getStatusBadge(timelineModalItem.status).dot}`} />
                      {getStatusBadge(timelineModalItem.status).label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Real-time BPO lifecycle audit trail • Customer:{" "}
                    <strong className="text-slate-800">{timelineModalItem.customer_name || "Customer"}</strong> • Phone:{" "}
                    <span className="font-mono font-bold text-slate-700">
                      +91 {(timelineModalItem.customer_phone || timelineModalItem.phone_number || "").slice(-10)}
                    </span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setTimelineModalItem(null)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition cursor-pointer"
                title="Close (Esc)"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 2. Customer Summary Card */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 p-3.5 rounded-xl bg-slate-50/90 border border-slate-200/90 text-xs shrink-0">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Customer Phone</span>
                <span className="font-mono font-bold text-slate-900 mt-0.5 block truncate">
                  +91 {(timelineModalItem.customer_phone || timelineModalItem.phone_number || "").slice(-10)}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Original Agent</span>
                <span className="font-bold text-slate-800 mt-0.5 block truncate" title={timelineModalItem.original_agent_name}>
                  {timelineModalItem.original_agent_name || timelineModalItem.agent_name || "Sales Agent"}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Current Agent</span>
                <span className="font-bold text-blue-700 mt-0.5 block truncate" title={timelineModalItem.current_agent_name}>
                  {timelineModalItem.current_agent_name || timelineModalItem.agent_name || "Sales Agent"}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Scheduled (IST)</span>
                <span className="font-mono font-medium text-slate-800 mt-0.5 block text-[11px] truncate">
                  {formatDisplayDateTime(timelineModalItem.scheduled_at || timelineModalItem.follow_up_datetime)}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Status</span>
                <div className="mt-0.5">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                      getStatusBadge(timelineModalItem.status).bg
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${getStatusBadge(timelineModalItem.status).dot}`} />
                    {getStatusBadge(timelineModalItem.status).label}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Outcome</span>
                <span className="font-bold text-slate-800 uppercase tracking-wide mt-0.5 block truncate text-[11px]">
                  {timelineModalItem.completion_outcome ||
                    timelineModalItem.disposition ||
                    (timelineModalItem.status === "completed" ? "COMPLETED" : "PENDING")}
                </span>
              </div>
            </div>

            {/* 3. Category Filter Bar */}
            <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-100 pb-2.5 shrink-0">
              <div className="flex items-center gap-1 bg-slate-100/90 p-1 rounded-lg overflow-x-auto">
                {(
                  [
                    { id: "all", label: "All Events" },
                    { id: "calls", label: "Calls" },
                    { id: "assignments", label: "Assignments" },
                    { id: "status", label: "Status Changes" },
                    { id: "followups", label: "Follow-Ups" },
                  ] as const
                ).map((f) => {
                  const count =
                    f.id === "all"
                      ? timelineModalItem.timeline?.length || 0
                      : (timelineModalItem.timeline || []).filter((e: any) => getEventCategory(e) === f.id).length;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setTimelineCategory(f.id)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                        timelineCategory === f.id
                          ? "bg-white text-slate-900 shadow-2xs"
                          : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50"
                      }`}
                    >
                      <span>{f.label}</span>
                      <span className="px-1.5 py-0.2 rounded-full text-[9.5px] font-mono bg-slate-200/80 text-slate-600">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span>Single Source of Truth</span>
              </div>
            </div>

            {/* 4. Scrollable Timeline Stream */}
            <div className="flex-1 overflow-y-auto pr-1.5 space-y-4 max-h-[450px]">
              {groupedTimelineEvents.length > 0 ? (
                <div className="relative pl-7 border-l-2 border-slate-200 ml-3 space-y-5 my-2">
                  {groupedTimelineEvents.map((entry, index) => {
                    const visuals = getTimelineEventVisuals(entry.action);
                    const callId = entry.metadata?.call_id;

                    return (
                      <div key={entry.id || index} className="relative group">
                        {/* Timeline Node with event icon */}
                        <div
                          className={`absolute -left-[37px] top-1 h-6 w-6 rounded-full border-2 border-white ${visuals.nodeBg} flex items-center justify-center shadow-xs ring-4 ${visuals.nodeRing}`}
                        >
                          {visuals.icon}
                        </div>

                        {/* Timeline Card */}
                        <div className="bg-slate-50/80 hover:bg-slate-100/90 transition-colors rounded-xl p-3.5 border border-slate-200/80 space-y-2">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-black uppercase tracking-wider border ${visuals.badgeBg}`}
                              >
                                {entry.action?.replace(/_/g, " ") || "EVENT"}
                              </span>

                              {entry.count > 1 && (
                                <span
                                  className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 shadow-2xs cursor-default"
                                  title={`Grouped ${entry.count} consecutive duplicate events`}
                                >
                                  ×{entry.count}
                                </span>
                              )}
                            </div>

                            <span className="text-[11.5px] font-mono font-medium text-slate-500">
                              {formatDisplayDateTime(entry.timestamp)}
                            </span>
                          </div>

                          <p className="text-[12.5px] text-slate-800 font-medium leading-relaxed">
                            {entry.description}
                          </p>

                          {/* Footer metadata bar */}
                          <div className="flex items-center gap-3 pt-1.5 border-t border-slate-200/60 text-[11.5px] text-slate-500 font-medium flex-wrap">
                            <span className="flex items-center gap-1.5">
                              <User className="h-3.5 w-3.5 text-slate-400" />
                              <span>
                                Actor: <strong className="text-slate-800">{entry.actor || "System Scheduler"}</strong>
                              </span>
                            </span>

                            {callId && (
                              <button
                                onClick={() => navigate(`/calls?search=${callId}`)}
                                className="inline-flex items-center gap-1 font-mono text-blue-700 bg-blue-50/90 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200 text-[11px] font-bold transition cursor-pointer"
                                title="Click to view Call details"
                              >
                                <span>Call: #{callId.slice(-6).toUpperCase()}</span>
                                <ExternalLink className="h-2.5 w-2.5" />
                              </button>
                            )}

                            {entry.metadata?.duration_seconds && (
                              <span className="text-[11px] font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60">
                                Duration: {entry.metadata.duration_seconds}s
                              </span>
                            )}

                            {entry.metadata?.pool_name && (
                              <span className="text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60">
                                Pool: {entry.metadata.pool_name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-10 text-slate-400 text-xs">
                  <Clock className="h-7 w-7 mx-auto mb-2 text-slate-300" />
                  No timeline events found for the selected category.
                </div>
              )}
            </div>

            {/* 5. Modal Footer */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-500 font-medium">
                Showing {groupedTimelineEvents.length} distinct timeline records
              </span>
              <button
                onClick={() => setTimelineModalItem(null)}
                className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer shadow-xs active:scale-95"
              >
                Close Audit Timeline
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── 6. REASSIGN MODAL ── */}
      {reassignModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                  <Users className="h-4 w-4" />
                </div>
                <h3 className="text-base font-extrabold text-slate-900">Reassign Follow-Up</h3>
              </div>
              <button
                onClick={() => setReassignModalItem(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveReassign} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Customer</label>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 font-bold text-slate-900">
                  {reassignModalItem.customer_name} (+91 {(reassignModalItem.customer_phone || "").slice(-10)})
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Current Assigned Agent</label>
                <div className="p-2 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 font-bold flex items-center gap-2">
                  <User className="h-3.5 w-3.5" />
                  <span>{reassignModalItem.current_agent_name || reassignModalItem.agent_name || "Unassigned"}</span>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Select New Target Agent *</label>
                <select
                  required
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none font-semibold text-slate-900 text-xs"
                >
                  <option value="">-- Choose Agent --</option>
                  {availableAgents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.name} ({ag.role}) - {ag.status}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Reassignment Reason / Audit Note</label>
                <input
                  type="text"
                  placeholder="e.g. Agent shift ended / Supervisor load balancing"
                  value={reassignReason}
                  onChange={(e) => setReassignReason(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none font-medium text-slate-900 text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReassignModalItem(null)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isReassigning}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold cursor-pointer shadow-xs"
                >
                  {isReassigning ? "Reassigning..." : "Confirm Reassignment"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* ── 7. RESCHEDULE MODAL ── */}
      {rescheduleModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900">Reschedule Follow-Up</h3>
              <button
                onClick={() => setRescheduleModalItem(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveReschedule} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Customer</label>
                <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 font-bold text-slate-900">
                  {rescheduleModalItem.customer_name} ({rescheduleModalItem.customer_phone})
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">New Date & Time (IST) *</label>
                <input
                  type="datetime-local"
                  required
                  value={rescheduleDateTime}
                  onChange={(e) => setRescheduleDateTime(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none font-semibold text-slate-900 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Reason for Rescheduling</label>
                <input
                  type="text"
                  placeholder="e.g. Customer requested evening callback"
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none font-medium text-slate-900 text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setRescheduleModalItem(null)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
                >
                  Save Reschedule
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* ── 8. COMPLETE MODAL ── */}
      {completeModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900">Mark Follow-Up Completed</h3>
              <button onClick={() => setCompleteModalItem(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCompletion} className="space-y-3 text-xs">
              <p className="text-slate-600 font-medium">
                Mark follow-up with <strong className="text-slate-900">{completeModalItem.customer_name}</strong> as completed.
              </p>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Outcome</label>
                <select
                  value={completionOutcome}
                  onChange={(e) => setCompletionOutcome(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none font-semibold text-slate-900 text-xs"
                >
                  <option value="completed">Completed - Satisfied</option>
                  <option value="interested">Interested - Follow Up Later</option>
                  <option value="sale_closed">Sale Closed / Deal Won</option>
                  <option value="not_interested">Not Interested</option>
                  <option value="no_answer">No Answer</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Completion Outcome Notes</label>
                <textarea
                  rows={3}
                  placeholder="Summary of follow-up outcome, customer agreement, next steps..."
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none font-medium text-slate-900 text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCompleteModalItem(null)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                >
                  Mark Completed
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* ── 9. DELETE / CANCEL CONFIRMATION MODAL ── */}
      {deleteModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4"
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center shrink-0">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    {deleteModalItem.status === "completed"
                      ? "Archive / Delete Completed Record"
                      : "Cancel Scheduled Follow-Up"}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Safe soft-deletion with complete audit history retention
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isDeleting && setDeleteModalItem(null)}
                disabled={isDeleting}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Warning Banner */}
            <div className="p-3.5 rounded-xl bg-amber-50/90 border border-amber-200/80 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900">
                <p className="font-bold">
                  {deleteModalItem.status === "completed"
                    ? "Audit & Archive Notice"
                    : "Automatic Call Cancellation Warning"}
                </p>
                <p className="text-amber-800/90 font-medium mt-0.5 leading-relaxed">
                  {deleteModalItem.status === "completed"
                    ? "Deleting this completed follow-up will archive it from active queue views. All call logs, recordings, notes, and timeline events will be safely preserved in the database and audit trail."
                    : "Cancelling this follow-up will immediately prevent the backend auto-dialer from initiating outbound calls to this customer. The record and timeline will be archived as CANCELLED."}
                </p>
              </div>
            </div>

            {/* Target Item Details Card */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Customer / Lead</span>
                  <span className="font-bold text-slate-900 mt-0.5 block truncate">
                    {deleteModalItem.customer_name || "Lead"}
                  </span>
                  <span className="font-mono font-medium text-slate-600 text-[11px] block mt-0.5">
                    +91 {(deleteModalItem.customer_phone || deleteModalItem.phone_number || "").slice(-10)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Scheduled IST Time</span>
                  <span className="font-bold text-blue-700 mt-0.5 block">
                    {formatDisplayDateTime(
                      deleteModalItem.scheduled_at || deleteModalItem.follow_up_datetime,
                      deleteModalItem.formatted_ist || deleteModalItem.scheduled_at_ist
                    )}
                  </span>
                  <span className="text-[10.5px] font-medium text-slate-500 block mt-0.5">
                    Timezone: Asia/Kolkata (IST)
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200/60 grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Assigned Agent</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block truncate">
                    {deleteModalItem.current_agent_name || deleteModalItem.agent_name || "Unassigned"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Current Status</span>
                  <span className="font-mono font-bold text-amber-700 uppercase mt-0.5 block text-[11px]">
                    {deleteModalItem.status}
                  </span>
                </div>
              </div>
            </div>

            {/* Cancellation Form */}
            <form onSubmit={handleConfirmDelete} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1.5">
                  Reason <span className="text-rose-500">*</span>
                </label>
                
                {/* Preset Chips */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(deleteModalItem.status === "completed"
                    ? [
                        "Archived completed follow-up",
                        "Clean up historical queue",
                        "Duplicate completed record",
                        "Customer issue resolved",
                      ]
                    : [
                        "Customer requested cancellation",
                        "Resolved on earlier call",
                        "Duplicate follow-up scheduled",
                        "Invalid contact number",
                        "Customer not interested",
                      ]
                  ).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCancelReason(preset)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer border ${
                        cancelReason === preset
                          ? "bg-blue-50 text-blue-700 border-blue-300 font-bold shadow-2xs"
                          : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <textarea
                  rows={2}
                  required
                  placeholder="Enter reason for deleting/archiving this follow-up..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-rose-500 focus:outline-none font-medium text-slate-900 text-xs"
                />
              </div>

              {/* Action Buttons */}
              <div className="pt-2.5 flex justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setDeleteModalItem(null)}
                  className="px-4 py-2 rounded-xl text-slate-700 hover:bg-slate-100 font-bold transition cursor-pointer disabled:opacity-50"
                >
                  {deleteModalItem.status === "completed" ? "Keep in List" : "Keep Scheduled"}
                </button>
                <button
                  type="submit"
                  disabled={isDeleting || !cancelReason.trim()}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold flex items-center gap-2 shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeleting ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>
                        {deleteModalItem.status === "completed"
                          ? "Delete / Archive Record"
                          : "Cancel Follow-Up"}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* ── CREATE MODAL ── */}
      <CreateFollowUpModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => fetchFollowUps(activeTab, searchTerm)}
      />
    </div>
  );
}
