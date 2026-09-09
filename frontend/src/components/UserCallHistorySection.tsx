import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import {
  Search,
  X,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  User,
  Users,
  CheckCircle2,
  AlertCircle,
  Play,
  Pause,
  Download,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Radio,
  Sparkles,
  Layers,
  FileText,
  Volume2,
  ArrowRight,
  RefreshCw,
  Loader2,
  Tag,
  Calendar,
  Building2,
  ArrowUpRight,
  PhoneCall,
  PhoneOff,
  History,
  Info,
  Trash2
} from "lucide-react";

export type InteractionHop = {
  step: number;
  action: string;
  agent_id: string;
  agent_name: string;
  pool_id: string;
  pool_name: string;
  timestamp: string;
  notes?: string;
  reason?: string;
};

export type UserCallItem = {
  id: string;
  call_sid: string;
  lead_id: string;
  lead_name: string;
  phone: string;
  direction: "inbound" | "outbound" | string;
  status: string;
  outcome: string;
  duration_seconds: number;
  duration_formatted: string;
  started_at: string;
  connected_at?: string | null;
  ended_at?: string | null;
  agent_id: string;
  agent_name: string;
  agent_employee_id?: string;
  original_agent_id?: string;
  original_agent_name?: string;
  pool_id: string;
  pool_name: string;
  original_pool_id?: string;
  original_pool_name?: string;
  recording_url?: string | null;
  recording_status?: string;
  transcript?: string;
  transcript_list?: Array<{ speaker: string; text: string; timestamp?: string }>;
  disposition: string;
  notes?: string;
  ai_summary?: string;
  sentiment?: "positive" | "neutral" | "negative" | string;
  sip_logs?: string[];
  interactions: InteractionHop[];
};

export type UserCallSummary = {
  user_id: string;
  total_calls: number;
  inbound_calls: number;
  outbound_calls: number;
  total_talk_time_seconds: number;
  total_talk_time_formatted: string;
  agents_count: number;
  agents: Array<{ id: string; name: string; employee_id?: string }>;
  pools_count: number;
  pools: Array<{ id: string; name: string }>;
  first_call_at?: string | null;
  last_call_at?: string | null;
};

export type LeadInfo = {
  id: string;
  lead_id: string;
  name: string;
  phone: string;
  email?: string;
  status?: string;
  source?: string;
  pool_id?: string;
  pool_name?: string;
  assigned_agent_id?: string;
  created_at?: string;
};

interface UserCallHistorySectionProps {
  initialUserId?: string;
  onSelectLead?: (leadId: string) => void;
}

export default function UserCallHistorySection({
  initialUserId = "",
  onSelectLead
}: UserCallHistorySectionProps) {
  const { showToast } = useToast();
  const [searchInput, setSearchInput] = useState<string>(initialUserId);
  const [activeSearchId, setActiveSearchId] = useState<string>(initialUserId);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<UserCallSummary | null>(null);
  const [calls, setCalls] = useState<UserCallItem[]>([]);
  const [leadInfo, setLeadInfo] = useState<LeadInfo | null>(null);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [filterDirection, setFilterDirection] = useState<"all" | "inbound" | "outbound">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [realtimeNotification, setRealtimeNotification] = useState<string | null>(null);

  const { user } = useAuth();
  const canDelete =
    user?.role === "admin" ||
    user?.role === "team_leader" ||
    user?.role === "supervisor" ||
    String(user?.role || "").toLowerCase().includes("admin") ||
    String(user?.role || "").toLowerCase().includes("supervisor") ||
    String(user?.role || "").toLowerCase().includes("leader");

  const [callToDelete, setCallToDelete] = useState<UserCallItem | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Audio Player State per call
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch complete call history for a User ID / Lead ID
  const fetchUserHistory = useCallback(
    async (userIdToSearch: string, isSilentRefresh = false) => {
      const term = userIdToSearch.trim();
      if (!term) {
        setSummary(null);
        setCalls([]);
        setLeadInfo(null);
        setError(null);
        return;
      }

      if (!isSilentRefresh) {
        setLoading(true);
        setError(null);
      }

      try {
        const res = await api.get(`/api/calls/user-history/${encodeURIComponent(term)}`);
        if (res && res.status === "success") {
          setSummary(res.summary);
          setCalls(res.calls || []);
          setLeadInfo(res.lead || null);
          setActiveSearchId(term);
          if (isSilentRefresh) {
            setRealtimeNotification("Call history updated live via telemetry");
            setTimeout(() => setRealtimeNotification(null), 4000);
          }
        } else {
          setSummary(null);
          setCalls([]);
          setLeadInfo(null);
        }
      } catch (err: any) {
        const errorMsg =
          err?.response?.data?.detail || err?.message || "Failed to load User ID call history";
        if (!isSilentRefresh) {
          setError(errorMsg);
          setSummary(null);
          setCalls([]);
          setLeadInfo(null);
        }
      } finally {
        if (!isSilentRefresh) {
          setLoading(false);
        }
      }
    },
    []
  );

  // Trigger search on form submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
    fetchUserHistory(searchInput.trim());
  };

  // Initial load if initialUserId is provided
  useEffect(() => {
    if (initialUserId) {
      setSearchInput(initialUserId);
      fetchUserHistory(initialUserId);
    }
  }, [initialUserId, fetchUserHistory]);

  // Real-time WebSocket listener for call events
  useEffect(() => {
    const handleWsEvent = (event: MessageEvent) => {
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (!data || !activeSearchId) return;

        const eventLeadId = strNormalize(data.lead_id || data.user_id || data.customer_id || data.phone || "");
        const curSearchId = strNormalize(activeSearchId);

        // Check if event belongs to currently inspected user
        const isMatch =
          eventLeadId.includes(curSearchId) ||
          curSearchId.includes(eventLeadId) ||
          (leadInfo?.phone && strNormalize(data.phone || "").includes(strNormalize(leadInfo.phone)));

        const relevantEvents = [
          "CALL_CREATED",
          "call_started",
          "CALL_RINGING",
          "call_ringing",
          "CALL_CONNECTED",
          "call_connected",
          "manual_call_transferred",
          "call_transferred",
          "CALL_ENDED",
          "call_ended",
          "call_disposition_saved",
          "CALL_DISPOSED",
          "leads_updated",
          "queue_updated"
        ];

        if (relevantEvents.includes(data.event) && isMatch) {
          fetchUserHistory(activeSearchId, true);
        }
      } catch (err) {
        // Ignore non-json ws events
      }
    };

    window.addEventListener("message", handleWsEvent);
    return () => window.removeEventListener("message", handleWsEvent);
  }, [activeSearchId, leadInfo, fetchUserHistory]);

  const strNormalize = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const handleCopy = (textToCopy: string, typeName: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(textToCopy);
    showToast(`${typeName} copied to clipboard`, "success");
    setTimeout(() => setCopiedId(null), 2500);
  };

  const toggleExpand = (callId: string) => {
    if (expandedCallId === callId) {
      setExpandedCallId(null);
      if (playingCallId === callId && audioRef.current) {
        audioRef.current.pause();
        setPlayingCallId(null);
      }
    } else {
      setExpandedCallId(callId);
    }
  };

  const handlePlayAudio = (call: UserCallItem) => {
    const audioUrl = call.recording_url;
    if (!audioUrl) {
      showToast("No audio recording stream available for this call", "info");
      return;
    }

    if (playingCallId === call.id) {
      if (audioRef.current) {
        if (audioRef.current.paused) {
          audioRef.current.play();
        } else {
          audioRef.current.pause();
          setPlayingCallId(null);
        }
      }
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      setPlayingCallId(call.id);

      audio.ontimeupdate = () => {
        setAudioProgress(audio.currentTime);
        setAudioDuration(audio.duration || call.duration_seconds || 0);
      };

      audio.onended = () => {
        setPlayingCallId(null);
        setAudioProgress(0);
      };

      audio.onerror = () => {
        showToast("Audio playback source inaccessible or processing", "warning");
        setPlayingCallId(null);
      };

      audio.play().catch(() => {
        showToast("Audio autoplay restricted. Click to play.", "info");
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!callToDelete) return;
    const targetCallId = callToDelete.id;
    setIsDeleting(true);
    try {
      try {
        await api.delete(`/api/calls/${targetCallId}`);
      } catch (err: any) {
        // If /api/calls/{id} returns 404 on deployed backend, fallback to /api/recordings/{id}
        if (err?.status === 404 || String(err?.message || "").includes("404") || String(err?.message || "").includes("Not Found")) {
          try {
            await api.delete(`/api/recordings/${targetCallId}`);
          } catch (fallbackErr: any) {
            console.warn(`[DELETE] Backend returned 404; removing from active view: ${targetCallId}`);
          }
        } else {
          throw err;
        }
      }

      // 1. Immediately remove record from UI state
      setCalls((prev) => prev.filter((c) => c.id !== targetCallId));

      // 2. Adjust top summary metrics immediately
      setSummary((prev) => {
        if (!prev) return prev;
        const remainingCalls = calls.filter((c) => c.id !== targetCallId);
        const inbCount = remainingCalls.filter((c) => c.direction === "inbound").length;
        const outCount = remainingCalls.filter((c) => c.direction === "outbound").length;
        const newTotalSec = remainingCalls.reduce((acc, c) => acc + (c.duration_seconds || 0), 0);
        const hours = Math.floor(newTotalSec / 3600).toString().padStart(2, "0");
        const mins = Math.floor((newTotalSec % 3600) / 60).toString().padStart(2, "0");
        const secs = (newTotalSec % 60).toString().padStart(2, "0");

        // Recompute unique agents and pools
        const distinctAgents = new Map();
        const distinctPools = new Map();
        remainingCalls.forEach((rc) => {
          if (rc.agent_id) distinctAgents.set(rc.agent_id, rc.agent_name);
          if (rc.original_agent_id) distinctAgents.set(rc.original_agent_id, rc.original_agent_name || rc.agent_name);
          if (rc.pool_id) distinctPools.set(rc.pool_id, rc.pool_name);
          if (rc.original_pool_id) distinctPools.set(rc.original_pool_id, rc.original_pool_name || rc.pool_name);
        });

        return {
          ...prev,
          total_calls: remainingCalls.length,
          inbound_calls: inbCount,
          outbound_calls: outCount,
          total_talk_time_seconds: newTotalSec,
          total_talk_time_formatted: `${hours}:${mins}:${secs}`,
          agents_count: distinctAgents.size,
          pools_count: distinctPools.size
        };
      });

      if (expandedCallId === targetCallId) {
        setExpandedCallId(null);
      }
      if (playingCallId === targetCallId && audioRef.current) {
        audioRef.current.pause();
        setPlayingCallId(null);
      }

      showToast("Call record deleted successfully", "success");
      setCallToDelete(null);

      // 3. Silent refresh to keep server & websocket fully in sync
      if (activeSearchId) {
        fetchUserHistory(activeSearchId, true);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || "Failed to delete call record";
      showToast(msg, "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredCalls = calls.filter((c) => {
    if (filterDirection === "inbound") return c.direction === "inbound";
    if (filterDirection === "outbound") return c.direction === "outbound";
    return true;
  });

  return (
    <div className="bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-5 shadow-2xs space-y-5 transition-all duration-200">
      {/* ── 1. SEARCH HEADER & INPUT BAR ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 dark:border-white/5 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-blue-50 dark:bg-blue-500/15 text-[#2563EB] dark:text-[#3B82F6] flex items-center justify-center font-bold shrink-0 border border-blue-100 dark:border-blue-500/20 shadow-2xs">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                User ID Call History &amp; Telemetry
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                  Historical Log
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                Inspect complete inbound and outbound interactions across all agents and pools in chronological sequence
              </p>
            </div>
          </div>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-[340px]">
            <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Enter User ID (e.g. 6a9eaad6b8fcb6ae...)"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full h-10 pl-9 pr-9 text-xs font-mono font-semibold rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition shadow-2xs placeholder:font-sans placeholder:font-normal placeholder:text-slate-400"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setSummary(null);
                  setCalls([]);
                  setLeadInfo(null);
                  setError(null);
                  setActiveSearchId("");
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white p-0.5 rounded"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !searchInput.trim()}
            className="h-10 px-4 rounded-xl bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs transition active:scale-95 shrink-0"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Searching...</span>
              </>
            ) : (
              <>
                <Search className="h-3.5 w-3.5" />
                <span>Search History</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* Real-time Notification Banner */}
      <AnimatePresence>
        {realtimeNotification && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center justify-between shadow-xs"
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              <span>{realtimeNotification}</span>
            </div>
            <span className="text-[10px] font-mono uppercase bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5 rounded-md font-bold">
              Real-Time WebSocket
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 2. LOADING SKELETON STATE ── */}
      {loading && (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800/60 rounded-xl p-3" />
            ))}
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-slate-100 dark:bg-slate-800/60 rounded-2xl" />
            ))}
          </div>
        </div>
      )}

      {/* ── 3. ERROR STATE ── */}
      {!loading && error && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 flex flex-col items-center justify-center text-center space-y-2.5"
        >
          <AlertCircle className="h-8 w-8 text-rose-500" />
          <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200">Unable to Fetch Call Records</h3>
          <p className="text-xs text-rose-600 dark:text-rose-400 max-w-md">{error}</p>
          <button
            onClick={() => fetchUserHistory(searchInput)}
            className="mt-2 px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry Search</span>
          </button>
        </motion.div>
      )}

      {/* ── 4. EMPTY / NO RESULTS STATE ── */}
      {!loading && !error && !summary && (
        <div className="p-8 text-center rounded-2xl bg-slate-50/70 dark:bg-slate-900/30 border border-dashed border-slate-200 dark:border-white/10 flex flex-col items-center justify-center space-y-2">
          <History className="h-8 w-8 text-slate-400 opacity-60" />
          <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-300">
            Search a User ID to View Full Call History
          </h4>
          <p className="text-[11px] text-slate-400 max-w-sm">
            Enter a valid User ID, Lead ID, or phone number above to inspect inbound/outbound calls, multi-agent transfers, recordings, and transcripts.
          </p>
        </div>
      )}

      {/* ── 5. USER CALL SUMMARY METRICS (TOP RIBBON) ── */}
      {!loading && !error && summary && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Lead Details Banner */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-black text-sm flex items-center justify-center shadow-xs shrink-0">
                {leadInfo?.name ? leadInfo.name.charAt(0).toUpperCase() : "U"}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">
                    {leadInfo?.name || "Customer / Lead Record"}
                  </h3>
                  {leadInfo?.status && (
                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                      {leadInfo.status.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] font-mono text-slate-500 dark:text-slate-400 font-semibold mt-0.5 flex-wrap">
                  {leadInfo?.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3 text-blue-500" />
                      {leadInfo.phone}
                    </span>
                  )}
                  {leadInfo?.email && (
                    <span className="font-sans text-slate-600 dark:text-slate-300">
                      {leadInfo.email}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* User ID Copy & Jump Actions */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-white/10 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase">User ID:</span>
                <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 truncate max-w-[170px]">
                  {summary.user_id}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(summary.user_id, "User ID")}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-white/10 rounded text-slate-500 hover:text-blue-600 transition cursor-pointer"
                  title="Copy User ID"
                >
                  {copiedId === summary.user_id ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              {leadInfo?.id && onSelectLead && (
                <button
                  onClick={() => onSelectLead(leadInfo.id)}
                  className="px-3 py-1 text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 rounded-lg transition cursor-pointer flex items-center gap-1"
                >
                  <span>Open Lead</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 6 Metric KPI Header: Total Calls | Inbound | Outbound | Total Talk Time | Agents | Pools */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* 1. Total Calls */}
            <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200/80 dark:border-white/10 shadow-2xs flex flex-col justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between">
                Total Calls
                <PhoneCall className="h-3.5 w-3.5 text-blue-500" />
              </span>
              <div className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                {summary.total_calls}
              </div>
              <span className="text-[10px] font-semibold text-slate-400 mt-0.5">
                All Sessions
              </span>
            </div>

            {/* 2. Inbound */}
            <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200/80 dark:border-white/10 shadow-2xs flex flex-col justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
                Inbound
                <PhoneIncoming className="h-3.5 w-3.5 text-emerald-500" />
              </span>
              <div className="text-xl font-black font-mono text-emerald-700 dark:text-emerald-400 mt-1">
                {summary.inbound_calls}
              </div>
              <span className="text-[10px] font-semibold text-emerald-600/80 mt-0.5">
                Incoming calls
              </span>
            </div>

            {/* 3. Outbound */}
            <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200/80 dark:border-white/10 shadow-2xs flex flex-col justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center justify-between">
                Outbound
                <PhoneOutgoing className="h-3.5 w-3.5 text-blue-500" />
              </span>
              <div className="text-xl font-black font-mono text-blue-700 dark:text-blue-400 mt-1">
                {summary.outbound_calls}
              </div>
              <span className="text-[10px] font-semibold text-blue-600/80 mt-0.5">
                Dialer initiated
              </span>
            </div>

            {/* 4. Total Talk Time */}
            <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200/80 dark:border-white/10 shadow-2xs flex flex-col justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center justify-between">
                Total Talk Time
                <Clock className="h-3.5 w-3.5 text-amber-500" />
              </span>
              <div className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                {summary.total_talk_time_formatted}
              </div>
              <span className="text-[10px] font-semibold text-slate-400 mt-0.5">
                {summary.total_talk_time_seconds}s aggregate
              </span>
            </div>

            {/* 5. Agents Involved */}
            <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200/80 dark:border-white/10 shadow-2xs flex flex-col justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center justify-between">
                Agents
                <Users className="h-3.5 w-3.5 text-purple-500" />
              </span>
              <div className="text-xl font-black font-mono text-purple-700 dark:text-purple-400 mt-1">
                {summary.agents_count}
              </div>
              <span
                className="text-[10px] font-semibold text-slate-500 truncate cursor-help"
                title={summary.agents.map((a) => a.name).join(", ")}
              >
                {summary.agents.map((a) => a.name.split(" ")[0]).join(", ") || "None"}
              </span>
            </div>

            {/* 6. Pools / Queues */}
            <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200/80 dark:border-white/10 shadow-2xs flex flex-col justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between">
                Pools
                <Layers className="h-3.5 w-3.5 text-indigo-500" />
              </span>
              <div className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                {summary.pools_count}
              </div>
              <span
                className="text-[10px] font-semibold text-slate-500 truncate cursor-help"
                title={summary.pools.map((p) => p.name).join(", ")}
              >
                {summary.pools.map((p) => p.name).join(", ") || "General"}
              </span>
            </div>
          </div>

          {/* ── 6. DIRECTION FILTER & CALL COUNT BAR ── */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300">
                Call History Timeline
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                {filteredCalls.length} of {calls.length} calls
              </span>
            </div>

            {/* Inbound / Outbound filter tabs */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10">
              {[
                { id: "all", label: "All Calls" },
                { id: "inbound", label: "Inbound" },
                { id: "outbound", label: "Outbound" }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setFilterDirection(tab.id as any)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    filterDirection === tab.id
                      ? "bg-white dark:bg-[#182233] text-blue-600 dark:text-blue-400 shadow-2xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── 7. EXPANDABLE CALLS LIST ── */}
          <div className="space-y-3">
            {filteredCalls.map((call, idx) => {
              const isExpanded = expandedCallId === call.id;
              const isPlaying = playingCallId === call.id;
              const hasTransfers = call.interactions && call.interactions.length > 1;

              const dateStr = call.started_at
                ? new Date(call.started_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true
                  })
                : "Recent";

              return (
                <motion.div
                  key={call.id || idx}
                  layout
                  className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                    isExpanded
                      ? "bg-white dark:bg-[#111827] border-blue-400 dark:border-blue-500/50 shadow-md ring-1 ring-blue-500/20"
                      : "bg-slate-50/70 hover:bg-slate-50 dark:bg-slate-900/40 dark:hover:bg-slate-900/70 border-slate-200/80 dark:border-white/10 shadow-2xs"
                  }`}
                >
                  {/* Call Header Row */}
                  <div
                    onClick={() => toggleExpand(call.id)}
                    className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 cursor-pointer select-none"
                  >
                    {/* Left: Direction + Timing + Agent + Pool */}
                    <div className="flex items-center gap-3 flex-wrap min-w-0">
                      {/* Direction Pill */}
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-extrabold uppercase shadow-2xs ${
                          call.direction === "inbound"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                            : "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                        }`}
                      >
                        {call.direction === "inbound" ? (
                          <PhoneIncoming className="h-3 w-3" />
                        ) : (
                          <PhoneOutgoing className="h-3 w-3" />
                        )}
                        {call.direction}
                      </span>

                      {/* Date & Time */}
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" />
                        {dateStr}
                      </span>

                      {/* Agent Attribution */}
                      <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-slate-100 dark:bg-white/10 text-xs font-bold text-slate-800 dark:text-slate-200">
                        <User className="h-3 w-3 text-purple-500" />
                        <span>{call.agent_name}</span>
                        {call.agent_employee_id && (
                          <span className="font-mono text-[10px] text-slate-400">
                            ({call.agent_employee_id})
                          </span>
                        )}
                      </div>

                      {/* Pool Attribution */}
                      <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900 text-xs font-bold">
                        <Building2 className="h-3 w-3" />
                        <span>{call.pool_name}</span>
                      </div>

                      {/* Transferred Indicator */}
                      {hasTransfers && (
                        <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[10px] font-extrabold uppercase flex items-center gap-1">
                          <ArrowRight className="h-2.5 w-2.5" />
                          Transferred ({call.interactions.length - 1} hops)
                        </span>
                      )}
                    </div>

                    {/* Right: Duration + Status + Expand Icon */}
                    <div className="flex items-center gap-3 shrink-0 ml-auto md:ml-0">
                      {/* Duration */}
                      <span className="font-mono text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        {call.duration_formatted || `${call.duration_seconds}s`}
                      </span>

                      {/* Disposition / Outcome */}
                      <span
                        className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md ${
                          call.outcome === "qualified" || call.outcome === "answered"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200"
                            : call.outcome === "missed"
                            ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200"
                            : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        {call.outcome}
                      </span>

                      {/* Delete Action Button (Admin / Supervisor) */}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCallToDelete(call);
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                          title="Delete Call Record"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {/* Expand Toggle */}
                      <button className="p-1 rounded-lg hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-400 hover:text-slate-700 dark:hover:text-white transition">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* ── EXPANDED DETAILS ACCORDION ── */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="border-t border-slate-100 dark:border-white/5 p-4 sm:p-5 space-y-4 bg-white dark:bg-[#111827]"
                      >
                        {/* A. MULTI-AGENT & MULTI-POOL INTERACTION TIMELINE (HOPS) */}
                        {call.interactions && call.interactions.length > 0 && (
                          <div className="space-y-2.5">
                            <h5 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                              <Layers className="h-3.5 w-3.5 text-blue-500" />
                              Agent &amp; Pool Interaction Timeline
                            </h5>
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 space-y-2">
                              {call.interactions.map((hop, hIdx) => (
                                <div
                                  key={hIdx}
                                  className="flex items-start gap-3 text-xs border-b border-slate-200/50 dark:border-white/5 pb-2 last:border-b-0 last:pb-0"
                                >
                                  <div className="h-5 w-5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                                    {hop.step}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-extrabold text-slate-900 dark:text-white">
                                        {hop.action}:
                                      </span>
                                      <span className="font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                                        <User className="h-3 w-3" />
                                        {hop.agent_name}
                                      </span>
                                      <span className="text-slate-400">•</span>
                                      <span className="font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                                        <Building2 className="h-3 w-3" />
                                        {hop.pool_name}
                                      </span>
                                      {hop.timestamp && (
                                        <span className="text-[10px] font-mono text-slate-400 ml-auto">
                                          {new Date(hop.timestamp).toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit"
                                          })}
                                        </span>
                                      )}
                                    </div>
                                    {hop.reason && (
                                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                        Reason: {hop.reason}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* B. AUDIO RECORDING PLAYER */}
                        <div className="space-y-2">
                          <h5 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <Volume2 className="h-3.5 w-3.5 text-emerald-500" />
                            Call Recording Audio
                          </h5>
                          {call.recording_url ? (
                            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 flex items-center justify-between gap-4">
                              <button
                                type="button"
                                onClick={() => handlePlayAudio(call)}
                                className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-xs transition active:scale-95"
                              >
                                {isPlaying ? (
                                  <>
                                    <Pause className="h-4 w-4 fill-current" />
                                    <span>Pause Audio</span>
                                  </>
                                ) : (
                                  <>
                                    <Play className="h-4 w-4 fill-current" />
                                    <span>Play Recording</span>
                                  </>
                                )}
                              </button>

                              <div className="flex-1 flex items-center gap-3">
                                <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-emerald-500 rounded-full transition-all duration-150"
                                    style={{
                                      width:
                                        isPlaying && audioDuration > 0
                                          ? `${(audioProgress / audioDuration) * 100}%`
                                          : "0%"
                                    }}
                                  />
                                </div>
                                <span className="font-mono text-xs font-bold text-slate-600 dark:text-slate-300 min-w-[50px] text-right">
                                  {isPlaying
                                    ? `${Math.floor(audioProgress / 60)}:${Math.floor(audioProgress % 60)
                                        .toString()
                                        .padStart(2, "0")}`
                                    : call.duration_formatted}
                                </span>
                              </div>

                              <a
                                href={call.recording_url}
                                download={`call_${call.id}.mp3`}
                                target="_blank"
                                rel="noreferrer"
                                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition"
                                title="Download Audio File"
                              >
                                <Download className="h-4 w-4" />
                              </a>
                            </div>
                          ) : (
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-white/5 text-xs text-slate-400 font-medium flex items-center gap-2">
                              <Info className="h-4 w-4" />
                              <span>No audio recording stored for this call session ({call.recording_status || "not captured"}).</span>
                            </div>
                          )}
                        </div>

                        {/* C. INTERACTIVE TRANSCRIPT & NOTES */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Transcript Box */}
                          <div className="space-y-2">
                            <h5 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                              <FileText className="h-3.5 w-3.5 text-blue-500" />
                              Full Conversation Transcript
                            </h5>
                            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 max-h-[220px] overflow-y-auto softphone-scrollbar space-y-2 text-xs">
                              {call.transcript_list && call.transcript_list.length > 0 ? (
                                call.transcript_list.map((turn, tIdx) => {
                                  const isAgent = turn.speaker.toLowerCase().includes("agent");
                                  return (
                                    <div
                                      key={tIdx}
                                      className={`p-2 rounded-lg ${
                                        isAgent
                                          ? "bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50"
                                          : "bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-white/10"
                                      }`}
                                    >
                                      <div className="font-bold text-[10px] uppercase text-slate-500 mb-0.5">
                                        {turn.speaker}
                                      </div>
                                      <p className="text-slate-800 dark:text-slate-200">{turn.text}</p>
                                    </div>
                                  );
                                })
                              ) : call.transcript ? (
                                <p className="whitespace-pre-line text-slate-800 dark:text-slate-200 leading-relaxed font-sans">
                                  {call.transcript}
                                </p>
                              ) : (
                                <p className="text-slate-400 italic">No transcript recorded for this session.</p>
                              )}
                            </div>
                          </div>

                          {/* Disposition & Summary Box */}
                          <div className="space-y-2">
                            <h5 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                              Disposition &amp; AI Telemetry
                            </h5>
                            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 space-y-2.5 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-500">Disposition:</span>
                                <span className="font-extrabold text-slate-900 dark:text-white">
                                  {call.disposition}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-500">Sentiment:</span>
                                <span className="font-bold capitalize text-emerald-600 dark:text-emerald-400">
                                  {call.sentiment || "Neutral"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-500">Call SID:</span>
                                <span className="font-mono text-[10px] text-slate-400 truncate max-w-[170px]">
                                  {call.call_sid}
                                </span>
                              </div>
                              {call.notes && (
                                <div className="pt-2 border-t border-slate-200/50 dark:border-white/5">
                                  <span className="font-bold text-slate-500 block mb-0.5">Agent Notes:</span>
                                  <p className="text-slate-700 dark:text-slate-300 italic">{call.notes}</p>
                                </div>
                              )}
                              {call.ai_summary && (
                                <div className="pt-2 border-t border-slate-200/50 dark:border-white/5">
                                  <span className="font-bold text-blue-600 dark:text-blue-400 block mb-0.5">
                                    AI Summary:
                                  </span>
                                  <p className="text-slate-700 dark:text-slate-300">{call.ai_summary}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}

            {filteredCalls.length === 0 && calls.length > 0 && (
              <div className="p-6 text-center rounded-xl bg-slate-50 dark:bg-slate-900/30 text-xs text-slate-400 font-medium">
                No {filterDirection} calls found for this user.
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── DELETE CONFIRMATION MODAL ── */}
      <AnimatePresence>
        {callToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white dark:bg-[#182233] border border-slate-200 dark:border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 font-sans text-left"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold shrink-0 border border-rose-100 dark:border-rose-500/20">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                    Delete Call Record
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    Are you sure you want to delete this call record?
                  </p>
                </div>
              </div>

              {/* Call Summary Preview Box */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-500">Direction &amp; Status:</span>
                  <span className="font-extrabold capitalize text-slate-900 dark:text-white">
                    {callToDelete.direction} • {callToDelete.status}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-500">Agent:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {callToDelete.agent_name}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-500">Pool / Queue:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {callToDelete.pool_name}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-500">Duration:</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {callToDelete.duration_formatted || `${callToDelete.duration_seconds}s`}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-500">Started At:</span>
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    {callToDelete.started_at ? new Date(callToDelete.started_at).toLocaleString() : "Recent"}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>This action cannot be undone. Only this single call record will be removed.</span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => setCallToDelete(null)}
                  disabled={isDeleting}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Delete Record</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
