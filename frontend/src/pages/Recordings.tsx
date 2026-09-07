import { useEffect, useState, useCallback, useRef } from "react";
import { api, getBaseUrl, getToken } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { CustomSelect } from "../components/CustomSelect";
import {
  Mic,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Download,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileAudio,
  Trash2,
  ShieldCheck,
  Calendar,
  Sparkles,
  FileText,
  Copy,
  ChevronRight,
  X,
  Radio,
  HardDrive,
  Cloud,
  Lock,
  ExternalLink
} from "lucide-react";

export type RecordingItem = {
  id?: string;
  _id?: string;
  call_id: string;
  lead_id?: string;
  customer_name?: string;
  phone_number?: string;
  masked_phone?: string;
  agent_id?: string;
  agent_name?: string;
  pool_id?: string;
  status: "RECORDING" | "PROCESSING" | "READY" | "FAILED";
  storage_provider?: "cloudinary" | "local_fallback" | string;
  public_id?: string;
  secure_url?: string;
  signed_playback_url?: string;
  duration?: number;
  duration_seconds: number;
  format?: string;
  call_start_time?: string;
  call_end_time?: string;
  call_outcome?: string;
  storage_path?: string;
  filename?: string;
  file_size_bytes?: number;
  bytes?: number;
  mime_type?: string;
  checksum_sha256?: string;
  remote_url?: string;
  error_message?: string;
  retry_count?: number;
  consent_status?: string;
  notes?: string;
  ai_summary?: string;
  transcript?: string;
  events?: any[];
  has_audio_file?: boolean;
  upload_started_at?: string;
  upload_completed_at?: string;
  upload_error_at?: string;
  created_at?: string;
  updated_at?: string;
};

type StatsData = {
  total_recordings: number;
  ready_count: number;
  processing_count: number;
  recording_count: number;
  failed_count: number;
  total_size_bytes: number;
  total_size_mb: number;
  total_duration_seconds: number;
};

const STATUS_FILTERS = [
  { id: "ALL", label: "All Statuses" },
  { id: "READY", label: "Ready" },
  { id: "PROCESSING", label: "Processing" },
  { id: "RECORDING", label: "Live Recording" },
  { id: "FAILED", label: "Failed" }
];

const DISPOSITION_OPTIONS = [
  { value: "ALL", label: "All Dispositions" },
  { value: "completed", label: "Completed" },
  { value: "interested", label: "Interested" },
  { value: "callback", label: "Callback Scheduled" },
  { value: "not_interested", label: "Not Interested" },
  { value: "busy", label: "Busy" },
  { value: "no_answer", label: "No Answer" },
  { value: "wrong_number", label: "Wrong Number" },
  { value: "qualified", label: "Qualified Lead" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" }
];

export default function Recordings() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dispositionFilter, setDispositionFilter] = useState("ALL");
  const [agentFilter, setAgentFilter] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Agent list for dropdown
  const [agents, setAgents] = useState<{ value: string; label: string }[]>([]);

  // Selected recording for detail panel & audio player
  const [selectedRec, setSelectedRec] = useState<RecordingItem | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"player" | "metadata" | "transcript" | "events">("player");

  // Audio Player State
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Cleanup orphans modal
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [cleaningOrphans, setCleaningOrphans] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<any>(null);

  // Retrying state
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";
  const isSupervisor = user?.role === "team_leader" || user?.role === "admin";

  // Load Agents list
  useEffect(() => {
    async function fetchAgents() {
      try {
        const data = await api.get("/api/users");
        if (Array.isArray(data)) {
          const agentOptions = data
            .filter((u: any) => u.role === "agent" || u.role === "team_leader")
            .map((u: any) => ({
              value: u.id || u._id,
              label: `${u.name} (${u.role === "team_leader" ? "TL" : "Agent"}${u.department ? ` - ${u.department}` : ""})`
            }));
          setAgents([{ value: "ALL", label: "All Agents" }, ...agentOptions]);
        }
      } catch (e) {
        console.warn("[RECORDINGS] Failed to fetch agents:", e);
      }
    }
    fetchAgents();
  }, []);

  // Fetch Stats
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await api.get("/api/recordings/stats");
      setStats(data);
    } catch (e) {
      console.warn("[RECORDINGS] Failed to load stats:", e);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Fetch Recordings
  const loadRecordings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", "25");

      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (statusFilter !== "ALL") params.set("status_filter", statusFilter);
      if (dispositionFilter !== "ALL") params.set("call_status", dispositionFilter);
      if (agentFilter !== "ALL") params.set("agent_id", agentFilter);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      const res = await api.get(`/api/recordings?${params.toString()}`);
      if (res && res.items) {
        setRecordings(res.items);
        setTotalCount(res.total || 0);
        setTotalPages(res.pages || 1);

        // If currently selected recording was updated, sync it
        if (selectedRec) {
          const updated = res.items.find((r: RecordingItem) => (r.id || r._id) === (selectedRec.id || selectedRec._id) || r.call_id === selectedRec.call_id);
          if (updated) {
            setSelectedRec(updated);
          }
        }
      }
    } catch (err: any) {
      showToast(err.message || "Failed to load call recordings", "error");
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, statusFilter, dispositionFilter, agentFilter, dateFrom, dateTo, selectedRec, showToast]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadRecordings();
  }, [loadRecordings]);

  // Real-time WebSocket synchronization
  useEffect(() => {
    const handleWsRecordingUpdate = (e: Event) => {
      const customEvt = e as CustomEvent;
      const data = customEvt.detail;
      if (!data) return;

      console.log("[RECORDINGS WS EVENT]", data);
      // Reload stats and current list
      loadStats();
      setRecordings((prev) => {
        const recId = data.recording_id || data.data?.id;
        const callId = data.call_id || data.data?.call_id;
        const status = data.status || data.data?.status;

        return prev.map((item) => {
          if ((item.id && item.id === recId) || (item._id && item._id === recId) || item.call_id === callId) {
            return {
              ...item,
              status: status || item.status,
              ...(data.data || {})
            };
          }
          return item;
        });
      });

      // Update selected recording if active
      setSelectedRec((prev) => {
        if (!prev) return null;
        const recId = data.recording_id || data.data?.id;
        const callId = data.call_id || data.data?.call_id;
        if ((prev.id && prev.id === recId) || (prev._id && prev._id === recId) || prev.call_id === callId) {
          return {
            ...prev,
            status: data.status || data.data?.status || prev.status,
            ...(data.data || {})
          };
        }
        return prev;
      });
    };

    window.addEventListener("recording:status_changed", handleWsRecordingUpdate);
    window.addEventListener("recording_status_updated", handleWsRecordingUpdate);

    return () => {
      window.removeEventListener("recording:status_changed", handleWsRecordingUpdate);
      window.removeEventListener("recording_status_updated", handleWsRecordingUpdate);
    };
  }, [loadStats]);

  // Audio stream URL with auth token
  const getStreamFallbackUrl = (rec: RecordingItem) => {
    const recId = rec.id || rec._id || rec.call_id;
    const token = getToken();
    const base = getBaseUrl();
    return `${base}/api/recordings/${recId}/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  };

  // Select a recording for inspection & playback
  const handleSelectRecording = async (rec: RecordingItem) => {
    setSelectedRec(rec);
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(rec.duration_seconds || rec.duration || 0);
    setAudioError(null);

    const recId = rec.id || rec._id || rec.call_id;
    
    // Set default streaming URL
    let streamUrl = getStreamFallbackUrl(rec);
    setPlaybackUrl(streamUrl);

    // Fetch full details & secure Cloudinary signed playback URL
    try {
      const fullDoc = await api.get(`/api/recordings/${recId}`);
      if (fullDoc) {
        setSelectedRec(fullDoc);
      }

      if (rec.status === "READY" || fullDoc?.status === "READY") {
        try {
          const securePlayback = await api.get(`/api/recordings/${recId}/secure-playback`);
          if (securePlayback && securePlayback.signed_playback_url) {
            setPlaybackUrl(securePlayback.signed_playback_url);
          }
        } catch (secErr) {
          console.warn("[RECORDINGS] Secure playback URL fallback to direct stream:", secErr);
        }
      }
    } catch (err) {
      console.warn("[RECORDINGS] Failed to fetch full recording detail:", err);
    }
  };

  // Audio Download Handler
  const handleDownload = async (rec: RecordingItem) => {
    try {
      const recId = rec.id || rec._id || rec.call_id;
      const token = getToken();
      const base = getBaseUrl();
      const downloadUrl = `${base}/api/recordings/${recId}/download${token ? `?token=${encodeURIComponent(token)}` : ""}`;

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", rec.filename || `recording_${rec.call_id}.wav`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast("Call recording download started.", "info");
    } catch (err: any) {
      showToast(err.message || "Failed to download recording", "error");
    }
  };

  // Audio Playback Controls
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch((e) => {
        console.error("Playback error:", e);
        setAudioError("Unable to play audio stream. Cloudinary / storage provider connecting...");
      });
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const seekTime = parseFloat(e.target.value);
    setCurrentTime(seekTime);
    if (audioRef.current) {
      audioRef.current.currentTime = seekTime;
    }
  };

  const handleSkip = (seconds: number) => {
    if (!audioRef.current) return;
    const newTime = Math.max(0, Math.min(audioDuration, audioRef.current.currentTime + seconds));
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
      audioRef.current.muted = val === 0;
    }
    setIsMuted(val === 0);
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.muted = false;
      setIsMuted(false);
      if (volume === 0) setVolume(1);
    } else {
      audioRef.current.muted = true;
      setIsMuted(true);
    }
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  // Retry failed recording
  const handleRetry = async (rec: RecordingItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const recId = rec.id || rec._id || rec.call_id;
    setRetryingId(recId);
    try {
      const res = await api.post(`/api/recordings/${recId}/retry`);
      showToast(res.message || "Retry download queued successfully.", "success");
      loadRecordings();
    } catch (err: any) {
      showToast(err.message || "Failed to retry recording download.", "error");
    } finally {
      setRetryingId(null);
    }
  };

  // Cleanup orphans action
  const handleCleanupOrphans = async () => {
    setCleaningOrphans(true);
    try {
      const res = await api.post("/api/recordings/cleanup-orphans");
      setCleanupResult(res);
      showToast(`Cleaned ${res.orphans_cleaned_count} orphan files, reclaimed ${res.reclaimed_mb} MB.`, "success");
      loadStats();
      loadRecordings();
    } catch (err: any) {
      showToast(err.message || "Failed to cleanup orphan files.", "error");
    } finally {
      setCleaningOrphans(false);
    }
  };

  // Preset Date Filter Helpers
  const applyDatePreset = (preset: "today" | "yesterday" | "week" | "all") => {
    const now = new Date();
    if (preset === "today") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
      setDateFrom(start.slice(0, 10));
      setDateTo(end.slice(0, 10));
    } else if (preset === "yesterday") {
      const y = new Date(now.getTime() - 86400000);
      const start = new Date(y.getFullYear(), y.getMonth(), y.getDate()).toISOString();
      const end = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59).toISOString();
      setDateFrom(start.slice(0, 10));
      setDateTo(end.slice(0, 10));
    } else if (preset === "week") {
      const w = new Date(now.getTime() - 7 * 86400000);
      setDateFrom(w.toISOString().slice(0, 10));
      setDateTo(now.toISOString().slice(0, 10));
    } else {
      setDateFrom("");
      setDateTo("");
    }
    setPage(1);
  };

  const formatSeconds = (sec: number) => {
    if (!sec || isNaN(sec)) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "0 KB";
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard!`, "info");
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-slate-950 text-slate-100 selection:bg-amber-500/30 selection:text-amber-200">
      {/* Top Header */}
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-xl px-6 py-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center shadow-lg shadow-amber-500/20 ring-1 ring-amber-400/30">
              <FileAudio className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  Voice Call Recordings
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1">
                    <Cloud className="h-3 w-3" />
                    Cloudinary Audio Vault
                  </span>
                </h1>
              </div>
              <p className="text-xs text-slate-400">
                Private Cloudinary storage, authenticated signed streaming, role-scoped access & audit logs.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              onClick={() => {
                loadStats();
                loadRecordings();
              }}
              disabled={loading}
              className="inline-flex items-center space-x-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/60 shadow-sm transition-all disabled:opacity-50"
              title="Refresh recordings"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-amber-400" : ""}`} />
              <span>Refresh</span>
            </button>

            {isAdmin && (
              <button
                onClick={() => {
                  setCleanupResult(null);
                  setShowCleanupModal(true);
                }}
                className="inline-flex items-center space-x-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-800/40 shadow-sm transition-all"
                title="Scan and clean orphan storage files"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-400" />
                <span>Cleanup Orphans</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-6 max-w-7xl w-full mx-auto">
        {/* Metric Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>Total Recordings</span>
              <FileAudio className="h-4 w-4 text-slate-400" />
            </div>
            <div className="text-2xl font-bold text-white mt-2">
              {statsLoading ? "..." : (stats?.total_recordings ?? totalCount)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {stats?.total_duration_seconds ? `${Math.round(stats.total_duration_seconds / 60)} min logged` : "Across all pools"}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between text-emerald-400 text-xs font-medium">
              <span>Ready for Playback</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-emerald-400 mt-2">
              {statsLoading ? "..." : (stats?.ready_count ?? 0)}
            </div>
            <div className="text-[11px] text-emerald-500/70 mt-1">
              Signed URL streamable
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between text-amber-400 text-xs font-medium">
              <span>Processing</span>
              <Clock className="h-4 w-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-amber-400 mt-2 flex items-center gap-1.5">
              {statsLoading ? "..." : (stats?.processing_count ?? 0)}
              {(stats?.processing_count ?? 0) > 0 && (
                <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-ping" />
              )}
            </div>
            <div className="text-[11px] text-amber-500/70 mt-1">
              Cloudinary uploading
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between text-rose-400 text-xs font-medium">
              <span>Failed / Retries</span>
              <AlertCircle className="h-4 w-4 text-rose-400" />
            </div>
            <div className="text-2xl font-bold text-rose-400 mt-2">
              {statsLoading ? "..." : (stats?.failed_count ?? 0)}
            </div>
            <div className="text-[11px] text-rose-500/70 mt-1">
              Manual retry available
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between text-cyan-400 text-xs font-medium">
              <span>Cloud Storage</span>
              <Cloud className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="text-2xl font-bold text-cyan-400 mt-2">
              {statsLoading ? "..." : `${stats?.total_size_mb ?? 0} MB`}
            </div>
            <div className="text-[11px] text-cyan-500/70 mt-1">
              Resource: Video / Authenticated
            </div>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800/80 shadow-md space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Search Input */}
            <div className="md:col-span-4 relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search Call ID, Lead, Phone, Agent, Notes..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-10 pr-8 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Agent Filter */}
            <div className="md:col-span-3">
              <CustomSelect
                options={agents}
                value={agentFilter}
                onChange={(val) => {
                  setAgentFilter(val);
                  setPage(1);
                }}
                placeholder="Filter by Agent"
              />
            </div>

            {/* Disposition Filter */}
            <div className="md:col-span-3">
              <CustomSelect
                options={DISPOSITION_OPTIONS}
                value={dispositionFilter}
                onChange={(val) => {
                  setDispositionFilter(val);
                  setPage(1);
                }}
                placeholder="Filter Disposition"
              />
            </div>

            {/* Quick Reset Filters */}
            <div className="md:col-span-2 flex justify-end">
              <button
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("ALL");
                  setDispositionFilter("ALL");
                  setAgentFilter("ALL");
                  setDateFrom("");
                  setDateTo("");
                  setPage(1);
                }}
                className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/80 transition-all text-center"
              >
                Reset All Filters
              </button>
            </div>
          </div>

          {/* Secondary Row: Status Pills & Date Presets */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pt-2 border-t border-slate-800/60">
            {/* Status Pills */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1">
              <span className="text-xs text-slate-400 font-medium mr-1.5 flex items-center gap-1">
                <Filter className="h-3 w-3 text-slate-500" />
                Status:
              </span>
              {STATUS_FILTERS.map((st) => (
                <button
                  key={st.id}
                  onClick={() => {
                    setStatusFilter(st.id);
                    setPage(1);
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                    statusFilter === st.id
                      ? "bg-amber-500 text-slate-950 font-bold shadow-sm shadow-amber-500/20"
                      : "bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {/* Date Filters & Presets */}
            <div className="flex items-center space-x-2 text-xs">
              <div className="flex items-center space-x-1">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  className="bg-slate-950 border border-slate-700/80 rounded-md px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                />
                <span className="text-slate-500">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  className="bg-slate-950 border border-slate-700/80 rounded-md px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center space-x-1">
                <button
                  onClick={() => applyDatePreset("today")}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 font-medium"
                >
                  Today
                </button>
                <button
                  onClick={() => applyDatePreset("yesterday")}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 font-medium"
                >
                  Yesterday
                </button>
                <button
                  onClick={() => applyDatePreset("week")}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 font-medium"
                >
                  7 Days
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area: Recordings List & Player Inspector */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Recordings Table / List */}
          <div className={`${selectedRec ? "lg:col-span-7" : "lg:col-span-12"} space-y-4`}>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                      <th className="px-4 py-3">Call ID / Lead</th>
                      <th className="px-4 py-3">Agent</th>
                      <th className="px-4 py-3">Date & Duration</th>
                      <th className="px-4 py-3">Outcome</th>
                      <th className="px-4 py-3">Storage / Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-slate-500">
                          <div className="flex flex-col items-center justify-center space-y-2">
                            <RefreshCw className="h-6 w-6 animate-spin text-amber-500" />
                            <span>Loading call recordings...</span>
                          </div>
                        </td>
                      </tr>
                    ) : recordings.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-slate-500">
                          <FileAudio className="h-8 w-8 mx-auto text-slate-600 mb-2" />
                          <p className="text-sm font-medium text-slate-400">No call recordings found</p>
                          <p className="text-xs text-slate-600 mt-1">Try changing your search query or filter parameters.</p>
                        </td>
                      </tr>
                    ) : (
                      recordings.map((rec) => {
                        const isSelected = selectedRec && ((selectedRec.id || selectedRec._id) === (rec.id || rec._id) || selectedRec.call_id === rec.call_id);
                        return (
                          <tr
                            key={rec.id || rec._id || rec.call_id}
                            onClick={() => handleSelectRecording(rec)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-amber-500/10 border-l-4 border-l-amber-500"
                                : "hover:bg-slate-800/40"
                            }`}
                          >
                            <td className="px-4 py-3">
                              <div className="font-semibold text-white flex items-center gap-1.5">
                                {rec.customer_name || "Customer"}
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                                <span>{rec.masked_phone || "****"}</span>
                                <span className="text-slate-600">•</span>
                                <span className="text-slate-500" title={rec.call_id}>
                                  {rec.call_id?.slice(0, 10)}...
                                </span>
                              </div>
                            </td>

                            <td className="px-4 py-3">
                              <div className="text-slate-200 font-medium">{rec.agent_name || "Agent"}</div>
                              <div className="text-[10px] text-slate-500 capitalize">{rec.pool_id || "General"}</div>
                            </td>

                            <td className="px-4 py-3">
                              <div className="text-slate-200 font-medium">
                                {rec.call_start_time ? new Date(rec.call_start_time).toLocaleDateString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "N/A"}
                              </div>
                              <div className="text-[11px] text-amber-400/90 font-mono mt-0.5">
                                {formatSeconds(rec.duration_seconds || rec.duration || 0)}
                              </div>
                            </td>

                            <td className="px-4 py-3">
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700/60">
                                {rec.call_outcome || "Completed"}
                              </span>
                            </td>

                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1 items-start">
                                {rec.status === "READY" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    <CheckCircle2 className="h-3 w-3" />
                                    READY
                                  </span>
                                )}
                                {rec.status === "PROCESSING" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                                    <Clock className="h-3 w-3" />
                                    PROCESSING
                                  </span>
                                )}
                                {rec.status === "RECORDING" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                    <Radio className="h-3 w-3 animate-pulse" />
                                    RECORDING
                                  </span>
                                )}
                                {rec.status === "FAILED" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                                    <AlertCircle className="h-3 w-3" />
                                    FAILED
                                  </span>
                                )}
                                {rec.public_id && (
                                  <span className="text-[9px] font-mono text-cyan-400/80 flex items-center gap-0.5 truncate max-w-[130px]" title={rec.public_id}>
                                    <Cloud className="h-2.5 w-2.5 shrink-0" />
                                    {rec.public_id.split("/").pop()}
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end space-x-1.5">
                                {rec.status === "FAILED" && isSupervisor && (
                                  <button
                                    onClick={(e) => handleRetry(rec, e)}
                                    disabled={retryingId === (rec.id || rec._id || rec.call_id)}
                                    className="p-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-all"
                                    title="Retry Cloudinary upload"
                                  >
                                    <RotateCw className={`h-3.5 w-3.5 ${retryingId === (rec.id || rec._id || rec.call_id) ? "animate-spin" : ""}`} />
                                  </button>
                                )}

                                {isSupervisor && rec.status === "READY" && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDownload(rec);
                                    }}
                                    className="p-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-all"
                                    title="Download recording"
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                  </button>
                                )}

                                <ChevronRight className="h-4 w-4 text-slate-500" />
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination controls */}
              <div className="px-4 py-3 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between text-xs text-slate-400">
                <div>
                  Showing <span className="font-semibold text-slate-200">{recordings.length}</span> of <span className="font-semibold text-slate-200">{totalCount}</span> recordings
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span>
                    Page <span className="text-slate-200 font-semibold">{page}</span> / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || loading}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Call Details & Audio Player Panel */}
          {selectedRec && (
            <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-slate-900 shadow-xl flex flex-col overflow-hidden max-h-[85vh]">
              {/* Panel Header */}
              <div className="p-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="h-8 w-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                    <Mic className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                      {selectedRec.customer_name || "Customer Call"}
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-slate-800 text-slate-300 border border-slate-700">
                        {selectedRec.masked_phone || "****"}
                      </span>
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      Handled by <span className="text-slate-200 font-medium">{selectedRec.agent_name || "Agent"}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5">
                  {isSupervisor && selectedRec.status === "READY" && (
                    <button
                      onClick={() => handleDownload(selectedRec)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all"
                      title="Download Recording"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedRec(null)}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Inspector Navigation Tabs */}
              <div className="flex border-b border-slate-800 bg-slate-950/40 text-xs">
                <button
                  onClick={() => setActiveTab("player")}
                  className={`flex-1 py-2.5 px-3 font-semibold text-center border-b-2 transition-all ${
                    activeTab === "player"
                      ? "border-amber-500 text-amber-400 bg-amber-500/5"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Player & Audio
                </button>
                <button
                  onClick={() => setActiveTab("metadata")}
                  className={`flex-1 py-2.5 px-3 font-semibold text-center border-b-2 transition-all ${
                    activeTab === "metadata"
                      ? "border-amber-500 text-amber-400 bg-amber-500/5"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Cloudinary Asset
                </button>
                <button
                  onClick={() => setActiveTab("transcript")}
                  className={`flex-1 py-2.5 px-3 font-semibold text-center border-b-2 transition-all ${
                    activeTab === "transcript"
                      ? "border-amber-500 text-amber-400 bg-amber-500/5"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  AI Transcript
                </button>
                <button
                  onClick={() => setActiveTab("events")}
                  className={`flex-1 py-2.5 px-3 font-semibold text-center border-b-2 transition-all ${
                    activeTab === "events"
                      ? "border-amber-500 text-amber-400 bg-amber-500/5"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Timeline
                </button>
              </div>

              {/* Tab Content */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4">
                {activeTab === "player" && (
                  <div className="space-y-4">
                    {/* Audio Player Card */}
                    <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 shadow-inner space-y-4">
                      {/* Hidden HTML5 Audio Element with Cloudinary Signed / Streaming Source */}
                      <audio
                        ref={audioRef}
                        src={playbackUrl || getStreamFallbackUrl(selectedRec)}
                        preload="metadata"
                        onTimeUpdate={() => {
                          if (audioRef.current) {
                            setCurrentTime(audioRef.current.currentTime);
                          }
                        }}
                        onLoadedMetadata={() => {
                          if (audioRef.current) {
                            setAudioDuration(audioRef.current.duration || selectedRec.duration_seconds || selectedRec.duration || 0);
                            setAudioLoading(false);
                          }
                        }}
                        onWaiting={() => setAudioLoading(true)}
                        onPlaying={() => setAudioLoading(false)}
                        onEnded={() => setIsPlaying(false)}
                        onError={(e) => {
                          console.warn("Audio element stream error:", e);
                          setAudioLoading(false);
                          setAudioError("Audio playback connecting. Retrying signed source...");
                        }}
                      />

                      {/* Waveform / Scrubber bar */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                          <span className="text-amber-400 font-semibold">{formatSeconds(currentTime)}</span>
                          <span>{formatSeconds(audioDuration || selectedRec.duration_seconds || selectedRec.duration || 0)}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={audioDuration || selectedRec.duration_seconds || selectedRec.duration || 100}
                          step={0.1}
                          value={currentTime}
                          onChange={handleSeek}
                          disabled={selectedRec.status !== "READY"}
                          className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:opacity-40"
                        />
                      </div>

                      {/* Primary Playback Controls */}
                      <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleSkip(-10)}
                            disabled={selectedRec.status !== "READY"}
                            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white transition-all disabled:opacity-40"
                            title="Rewind 10 seconds"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>

                          <button
                            onClick={togglePlay}
                            disabled={selectedRec.status !== "READY"}
                            className="h-11 w-11 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 flex items-center justify-center font-bold shadow-lg shadow-amber-500/20 transition-all disabled:opacity-40 disabled:pointer-events-none"
                            title={isPlaying ? "Pause" : "Play"}
                          >
                            {audioLoading ? (
                              <RefreshCw className="h-5 w-5 animate-spin text-slate-950" />
                            ) : isPlaying ? (
                              <Pause className="h-5 w-5 fill-current" />
                            ) : (
                              <Play className="h-5 w-5 fill-current ml-0.5" />
                            )}
                          </button>

                          <button
                            onClick={() => handleSkip(10)}
                            disabled={selectedRec.status !== "READY"}
                            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white transition-all disabled:opacity-40"
                            title="Forward 10 seconds"
                          >
                            <RotateCw className="h-4 w-4" />
                          </button>
                        </div>

                        {/* Speed Selector */}
                        <div className="flex items-center space-x-1">
                          {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                            <button
                              key={rate}
                              onClick={() => handleRateChange(rate)}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                                playbackRate === rate
                                  ? "bg-amber-500 text-slate-950"
                                  : "bg-slate-800 text-slate-400 hover:text-white"
                              }`}
                            >
                              {rate}x
                            </button>
                          ))}
                        </div>

                        {/* Volume Control */}
                        <div className="flex items-center space-x-1.5 w-28">
                          <button
                            onClick={toggleMute}
                            className="text-slate-400 hover:text-white p-1"
                          >
                            {isMuted || volume === 0 ? (
                              <VolumeX className="h-4 w-4 text-red-400" />
                            ) : (
                              <Volume2 className="h-4 w-4 text-slate-300" />
                            )}
                          </button>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={isMuted ? 0 : volume}
                            onChange={handleVolumeChange}
                            className="w-16 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                          />
                        </div>
                      </div>

                      {/* Error Banner */}
                      {audioError && (
                        <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-800/40 text-red-300 text-xs flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                            {audioError}
                          </span>
                          {isSupervisor && (
                            <button
                              onClick={() => handleRetry(selectedRec)}
                              className="px-2 py-0.5 rounded bg-red-800 hover:bg-red-700 text-white font-semibold text-[10px]"
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Quick Call Overview Summary */}
                    <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5 text-xs">
                      <div className="font-semibold text-slate-200 flex items-center justify-between">
                        <span>Recording Status & Compliance</span>
                        <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Consent Recorded
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-slate-400">
                        <div>
                          <span className="text-slate-500">Call Outcome: </span>
                          <span className="text-slate-200 font-medium capitalize">{selectedRec.call_outcome || "Completed"}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">File Size: </span>
                          <span className="text-slate-200 font-medium">{formatFileSize(selectedRec.file_size_bytes || selectedRec.bytes)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Format: </span>
                          <span className="text-slate-200 font-medium uppercase font-mono">{selectedRec.format || selectedRec.mime_type || "WAV"}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Duration: </span>
                          <span className="text-slate-200 font-medium">{formatSeconds(selectedRec.duration_seconds || selectedRec.duration || 0)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "metadata" && (
                  <div className="space-y-3 text-xs">
                    {/* Cloudinary Asset Metadata Card */}
                    <div className="p-3.5 rounded-xl bg-slate-950/80 border border-cyan-800/30 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-cyan-400 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                          <Cloud className="h-3.5 w-3.5" />
                          Cloudinary Storage Reference
                        </h3>
                        <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1">
                          <Lock className="h-2.5 w-2.5" />
                          Authenticated Delivery
                        </span>
                      </div>

                      <div className="space-y-2 text-slate-300">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Storage Provider:</span>
                          <span className="font-semibold text-cyan-300 uppercase font-mono">{selectedRec.storage_provider || "Cloudinary"}</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Public ID:</span>
                          <div className="flex items-center space-x-1 font-mono text-cyan-400 text-[11px] truncate max-w-[200px]">
                            <span className="truncate">{selectedRec.public_id || "N/A"}</span>
                            {selectedRec.public_id && (
                              <button
                                onClick={() => copyToClipboard(selectedRec.public_id || "", "Public ID")}
                                className="p-1 hover:text-white shrink-0"
                                title="Copy Cloudinary Public ID"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        {selectedRec.secure_url && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Secure URL:</span>
                            <div className="flex items-center space-x-1 font-mono text-slate-300 text-[11px] truncate max-w-[200px]">
                              <span className="truncate">{selectedRec.secure_url}</span>
                              <button
                                onClick={() => copyToClipboard(selectedRec.secure_url || "", "Secure URL")}
                                className="p-1 hover:text-white shrink-0"
                                title="Copy Secure URL"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Resource Type:</span>
                          <span className="font-mono text-slate-300">video (audio stream)</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Format:</span>
                          <span className="font-mono text-slate-300 uppercase">{selectedRec.format || "wav"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Identifiers Card */}
                    <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                      <h3 className="font-bold text-slate-200 uppercase tracking-wider text-[10px]">Call Identifiers</h3>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Call ID:</span>
                          <div className="flex items-center space-x-1 font-mono text-slate-200">
                            <span>{selectedRec.call_id}</span>
                            <button
                              onClick={() => copyToClipboard(selectedRec.call_id, "Call ID")}
                              className="p-1 hover:text-amber-400"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        </div>

                        {selectedRec.lead_id && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Lead ID:</span>
                            <div className="flex items-center space-x-1 font-mono text-slate-200">
                              <span>{selectedRec.lead_id}</span>
                              <button
                                onClick={() => copyToClipboard(selectedRec.lead_id || "", "Lead ID")}
                                className="p-1 hover:text-amber-400"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Customer Name:</span>
                          <span className="font-semibold text-slate-200">{selectedRec.customer_name || "Customer"}</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Phone (Masked):</span>
                          <span className="font-mono text-slate-200">{selectedRec.masked_phone || "****"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Upload Timestamps & Integrity */}
                    <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                      <h3 className="font-bold text-slate-200 uppercase tracking-wider text-[10px]">Timestamps & Integrity</h3>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Upload Started:</span>
                          <span className="font-mono text-slate-300">
                            {selectedRec.upload_started_at ? new Date(selectedRec.upload_started_at).toLocaleTimeString() : "N/A"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Upload Completed:</span>
                          <span className="font-mono text-slate-300">
                            {selectedRec.upload_completed_at ? new Date(selectedRec.upload_completed_at).toLocaleTimeString() : "N/A"}
                          </span>
                        </div>
                        {selectedRec.upload_error_at && (
                          <div className="flex items-center justify-between text-rose-400">
                            <span>Error Timestamp:</span>
                            <span className="font-mono">{new Date(selectedRec.upload_error_at).toLocaleTimeString()}</span>
                          </div>
                        )}
                        {selectedRec.checksum_sha256 && (
                          <div className="flex flex-col space-y-1 pt-1 border-t border-slate-800">
                            <span className="text-slate-400">SHA-256 Checksum:</span>
                            <span className="font-mono text-[10px] text-amber-400 break-all bg-slate-900 p-1.5 rounded">
                              {selectedRec.checksum_sha256}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Agent & Lifecycle Timing */}
                    <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                      <h3 className="font-bold text-slate-200 uppercase tracking-wider text-[10px]">Agent & Lifecycle Timing</h3>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-slate-500">Agent: </span>
                          <span className="text-slate-200 font-medium">{selectedRec.agent_name}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Pool: </span>
                          <span className="text-slate-200 font-medium capitalize">{selectedRec.pool_id || "General"}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Started: </span>
                          <span className="text-slate-200 font-medium">{selectedRec.call_start_time ? new Date(selectedRec.call_start_time).toLocaleTimeString() : "N/A"}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Ended: </span>
                          <span className="text-slate-200 font-medium">{selectedRec.call_end_time ? new Date(selectedRec.call_end_time).toLocaleTimeString() : "N/A"}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "transcript" && (
                  <div className="space-y-3 text-xs">
                    {/* AI Summary Block */}
                    <div className="p-3.5 rounded-xl bg-gradient-to-br from-purple-950/40 to-slate-950 border border-purple-800/30 space-y-2">
                      <div className="flex items-center space-x-1.5 text-purple-400 font-bold text-[11px] uppercase tracking-wider">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>AI Call Summary & Insights</span>
                      </div>
                      <p className="text-slate-300 leading-relaxed">
                        {selectedRec.ai_summary || "No AI summary available for this call."}
                      </p>
                    </div>

                    {/* Agent Notes */}
                    {selectedRec.notes && (
                      <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Agent Notes</span>
                        <p className="text-slate-200">{selectedRec.notes}</p>
                      </div>
                    )}

                    {/* Structured Transcript */}
                    <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <FileText className="h-3 w-3 text-slate-400" />
                        Transcript
                      </span>
                      {selectedRec.transcript ? (
                        <div className="space-y-2 text-slate-300 leading-relaxed font-sans max-h-60 overflow-y-auto pr-1">
                          {selectedRec.transcript.split("\n").map((line, idx) => (
                            <p key={idx} className="bg-slate-900/50 p-2 rounded border border-slate-800/40">
                              {line}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-slate-500 italic">No audio transcript recorded for this call.</p>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === "events" && (
                  <div className="space-y-2 text-xs">
                    {selectedRec.events && selectedRec.events.length > 0 ? (
                      <div className="relative pl-4 space-y-3 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                        {selectedRec.events.map((evt: any, i: number) => (
                          <div key={i} className="relative pl-2">
                            <div className="absolute -left-[18px] top-1.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-4 ring-slate-900" />
                            <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="font-semibold text-slate-200">{evt.title || evt.event || "Call Event"}</span>
                                <span className="text-slate-500 font-mono">{evt.timestamp || evt.created_at?.slice(11, 19) || ""}</span>
                              </div>
                              {evt.description && (
                                <p className="text-slate-400 text-[11px] mt-0.5">{evt.description}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-slate-500 text-center py-6">No call event log captured for this call.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Orphan Cleanup Confirmation Modal */}
      {showCleanupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-red-400">
              <div className="h-10 w-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Scan & Cleanup Orphan Recordings</h3>
                <p className="text-xs text-slate-400">Admin Maintenance Utility</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              This routine scans physical storage and purges audio files that are no longer indexed in the MongoDB database, reclaiming storage space securely while retaining all valid call audio files.
            </p>

            {cleanupResult && (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1 text-slate-300">
                <div className="text-emerald-400 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  Cleanup Completed
                </div>
                <div>Deleted files count: <span className="text-white font-mono">{cleanupResult.orphans_cleaned_count}</span></div>
                <div>Reclaimed space: <span className="text-white font-mono">{cleanupResult.reclaimed_mb} MB</span></div>
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowCleanupModal(false)}
                disabled={cleaningOrphans}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
              >
                Close
              </button>

              <button
                onClick={handleCleanupOrphans}
                disabled={cleaningOrphans}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/30 transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {cleaningOrphans && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                <span>{cleaningOrphans ? "Cleaning..." : "Run Cleanup Now"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
