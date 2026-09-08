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
  Cloud,
  Lock,
  Headphones,
  User,
  Phone,
  Activity,
  Check
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
  recording_url?: string;
  recording_file?: string;
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
  { value: "voicemail", label: "Voicemail" }
];

const WAVEFORM_BARS = [
  30, 55, 40, 75, 60, 90, 45, 80, 95, 65, 85, 50, 70, 90, 100, 80, 65, 45, 75,
  90, 85, 60, 40, 70, 95, 80, 65, 90, 100, 75, 55, 40, 65, 80, 50, 30
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

  // Multi-Selection State for Bulk Deletion
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Delete Modals State
  const [recordingToDelete, setRecordingToDelete] = useState<RecordingItem | null>(null);
  const [showBatchDeleteModal, setShowBatchDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  // Maintenance & cleanup modal
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

        // Auto-select recording on refresh, URL param, or initial load
        if (res.items.length > 0) {
          if (!selectedRec) {
            const urlParams = new URLSearchParams(window.location.search);
            const targetCallId = urlParams.get("call_id");
            const targetRecId = urlParams.get("id") || urlParams.get("recording_id");
            const matched = res.items.find(
              (r: RecordingItem) =>
                (targetCallId && r.call_id === targetCallId) ||
                (targetRecId && ((r.id && r.id === targetRecId) || (r._id && r._id === targetRecId)))
            );
            handleSelectRecording(matched || res.items[0]);
          } else {
            const updated = res.items.find((r: RecordingItem) => (r.id || r._id) === (selectedRec.id || selectedRec._id) || r.call_id === selectedRec.call_id);
            if (updated) {
              setSelectedRec((prev) => (prev ? { ...prev, ...updated } : updated));
            }
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

    const handleWsRecordingDelete = (e: Event) => {
      const customEvt = e as CustomEvent;
      const data = customEvt.detail;
      if (!data) return;
      const recId = data.recording_id;
      const callId = data.call_id;
      setRecordings((prev) => prev.filter((item) => item.id !== recId && item._id !== recId && item.call_id !== callId));
      setSelectedRec((prev) => {
        if (prev && ((prev.id === recId) || (prev._id === recId) || prev.call_id === callId)) {
          return null;
        }
        return prev;
      });
      loadStats();
    };

    window.addEventListener("recording:deleted", handleWsRecordingDelete);
    window.addEventListener("recording_deleted", handleWsRecordingDelete);

    return () => {
      window.removeEventListener("recording:status_changed", handleWsRecordingUpdate);
      window.removeEventListener("recording_status_updated", handleWsRecordingUpdate);
      window.removeEventListener("recording:deleted", handleWsRecordingDelete);
      window.removeEventListener("recording_deleted", handleWsRecordingDelete);
    };
  }, [loadStats]);

  // Audio stream URL with auth token
  const getStreamFallbackUrl = (rec: RecordingItem) => {
    const recId = rec.id || rec._id || rec.call_id;
    const token = getToken() || localStorage.getItem("access_token") || "";
    const base = getBaseUrl();
    return `${base}/api/recordings/${recId}/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  };

  const getEffectiveAudioUrl = (rec: RecordingItem | null): string => {
    if (!rec) return "";
    const token = getToken() || localStorage.getItem("access_token") || "";
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
    const base = getBaseUrl();

    const directUrl = rec.secure_url || rec.recording_url || rec.remote_url;
    if (directUrl && typeof directUrl === "string" && (directUrl.startsWith("http://") || directUrl.startsWith("https://"))) {
      return directUrl;
    }
    const recId = rec.id || rec._id || rec.call_id;
    if (recId) {
      return `${base}/api/recordings/${recId}/stream${tokenQuery}`;
    }
    return "";
  };

  // Select a recording for inspection & playback
  const handleSelectRecording = async (rec: RecordingItem) => {
    setSelectedRec(rec);
    setIsPlaying(false);
    setCurrentTime(0);
    const initialDuration = Number(rec.duration_seconds || rec.duration || 0);
    setAudioDuration(initialDuration);
    setAudioError(null);
    setAudioLoading(false);

    const recId = rec.id || rec._id || rec.call_id;
    const initialUrl = getEffectiveAudioUrl(rec);
    setPlaybackUrl(initialUrl);

    // Fetch full details & secure playback URL
    try {
      const fullDoc = await api.get(`/api/recordings/${recId}`);
      if (fullDoc) {
        setSelectedRec(fullDoc);
        const bestUrl = getEffectiveAudioUrl(fullDoc);
        if (bestUrl) {
          setPlaybackUrl(bestUrl);
        }
        if (fullDoc.duration_seconds || fullDoc.duration) {
          setAudioDuration(Number(fullDoc.duration_seconds || fullDoc.duration));
        }
      }

      if (rec.status === "READY" || fullDoc?.status === "READY") {
        try {
          const securePlayback = await api.get(`/api/recordings/${recId}/secure-playback`);
          if (securePlayback && (securePlayback.secure_url || securePlayback.signed_playback_url)) {
            setPlaybackUrl(securePlayback.secure_url || securePlayback.signed_playback_url);
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

  // Single Recording Deletion Confirmation
  const confirmDeleteSingle = async () => {
    if (!recordingToDelete) return;
    setIsDeleting(true);
    const recId = recordingToDelete.id || recordingToDelete._id || recordingToDelete.call_id;
    try {
      try {
        await api.delete(`/api/recordings/${recId}`);
      } catch (delErr: any) {
        if (delErr?.status === 405 || delErr?.message?.includes("405") || delErr?.message?.includes("Method Not Allowed")) {
          try {
            await api.post(`/api/recordings/${recId}/delete`);
          } catch {
            await api.post("/api/recordings/batch-delete", { recording_ids: [recId] });
          }
        } else {
          throw delErr;
        }
      }

      showToast("Call recording deleted permanently.", "success");
      
      setRecordings((prev) =>
        prev.filter((r) => (r.id || r._id) !== (recordingToDelete.id || recordingToDelete._id) && r.call_id !== recordingToDelete.call_id)
      );

      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (recordingToDelete.id) next.delete(recordingToDelete.id);
        if (recordingToDelete._id) next.delete(recordingToDelete._id);
        next.delete(recordingToDelete.call_id);
        return next;
      });

      if (
        selectedRec &&
        ((selectedRec.id && selectedRec.id === (recordingToDelete.id || recordingToDelete._id)) ||
          (selectedRec._id && selectedRec._id === (recordingToDelete.id || recordingToDelete._id)) ||
          selectedRec.call_id === recordingToDelete.call_id)
      ) {
        setSelectedRec(null);
        setPlaybackUrl("");
      }

      setRecordingToDelete(null);
      loadStats();
    } catch (err: any) {
      showToast(err.message || "Failed to delete call recording.", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  // Batch Multi-Selection Deletion
  const confirmBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    const ids = Array.from(selectedIds);
    try {
      const res = await api.post("/api/recordings/batch-delete", { recording_ids: ids });
      showToast(`Deleted ${res.deleted_count || ids.length} recordings successfully.`, "success");

      setRecordings((prev) =>
        prev.filter((r) => !selectedIds.has(r.id || "") && !selectedIds.has(r._id || "") && !selectedIds.has(r.call_id))
      );

      if (
        selectedRec &&
        (selectedIds.has(selectedRec.id || "") ||
          selectedIds.has(selectedRec._id || "") ||
          selectedIds.has(selectedRec.call_id))
      ) {
        setSelectedRec(null);
        setPlaybackUrl("");
      }

      setSelectedIds(new Set());
      setShowBatchDeleteModal(false);
      loadStats();
    } catch (err: any) {
      showToast(err.message || "Failed to delete selected recordings.", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  // Toggle selection for a single row
  const toggleSelectRow = (rec: RecordingItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const idKey = rec.id || rec._id || rec.call_id;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(idKey)) {
        next.delete(idKey);
      } else {
        next.add(idKey);
      }
      return next;
    });
  };

  // Toggle select all on current page
  const toggleSelectAll = () => {
    if (selectedIds.size === recordings.length && recordings.length > 0) {
      setSelectedIds(new Set());
    } else {
      const allKeys = recordings.map((r) => r.id || r._id || r.call_id);
      setSelectedIds(new Set(allKeys));
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

  // Purge failed recordings action
  const handlePurgeFailed = async () => {
    const failedRecs = recordings.filter((r) => r.status === "FAILED");
    if (failedRecs.length === 0) {
      showToast("No failed recordings found to purge.", "info");
      return;
    }
    const failedIds = failedRecs.map((r) => r.id || r._id || r.call_id);
    setCleaningOrphans(true);
    try {
      const res = await api.post("/api/recordings/batch-delete", { recording_ids: failedIds });
      showToast(`Purged ${res.deleted_count || failedIds.length} failed recordings.`, "success");
      loadStats();
      loadRecordings();
    } catch (err: any) {
      showToast(err.message || "Failed to purge failed recordings.", "error");
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
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    showToast(`${label} copied to clipboard!`, "info");
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#F6F8FB] text-[#111827] font-sans antialiased">
      {/* ── Main Content Container ────────────────────────────────────────────── */}
      <main className="flex-1 p-6 space-y-6 max-w-7xl w-full mx-auto">
        {/* ── 5 Clean White KPI Summary Cards ─────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {/* 1. Total Recordings */}
          <div className="bg-white border border-[#E4E7EC] rounded-xl p-4 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#667085]">Total Recordings</span>
              <div className="h-7 w-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <FileAudio className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-2xl font-bold text-[#111827] mt-3">
              {statsLoading ? "..." : (stats?.total_recordings ?? totalCount)}
            </div>
            <div className="text-[11px] text-[#667085] mt-1 flex items-center gap-1 font-medium">
              <Activity className="h-3 w-3 text-slate-400" />
              {stats?.total_duration_seconds ? `${Math.round(stats.total_duration_seconds / 60)} min logged` : "Across all pools"}
            </div>
          </div>

          {/* 2. Ready for Playback */}
          <div className="bg-white border border-[#E4E7EC] rounded-xl p-4 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#667085]">Ready for Playback</span>
              <div className="h-7 w-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-2xl font-bold text-[#111827] mt-3">
              {statsLoading ? "..." : (stats?.ready_count ?? 0)}
            </div>
            <div className="text-[11px] text-emerald-700 mt-1 font-medium flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
              Signed URL streamable
            </div>
          </div>

          {/* 3. Processing */}
          <div className="bg-white border border-[#E4E7EC] rounded-xl p-4 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#667085]">Processing</span>
              <div className="h-7 w-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <Clock className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-2xl font-bold text-[#111827] mt-3 flex items-center gap-2">
              {statsLoading ? "..." : (stats?.processing_count ?? 0)}
              {(stats?.processing_count ?? 0) > 0 && (
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-ping" />
              )}
            </div>
            <div className="text-[11px] text-amber-700 mt-1 font-medium flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
              Cloudinary uploading
            </div>
          </div>

          {/* 4. Failed / Retries */}
          <div className="bg-white border border-[#E4E7EC] rounded-xl p-4 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#667085]">Failed / Retries</span>
              <div className="h-7 w-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                <AlertCircle className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-2xl font-bold text-[#111827] mt-3">
              {statsLoading ? "..." : (stats?.failed_count ?? 0)}
            </div>
            <div className="text-[11px] text-rose-700 mt-1 font-medium flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
              Manual retry available
            </div>
          </div>

          {/* 5. Cloud Storage */}
          <div className="bg-white border border-[#E4E7EC] rounded-xl p-4 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#667085]">Cloud Storage</span>
              <div className="h-7 w-7 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
                <Cloud className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-2xl font-bold text-[#111827] mt-3">
              {statsLoading ? "..." : `${stats?.total_size_mb ?? 0} MB`}
            </div>
            <div className="text-[11px] text-sky-700 mt-1 font-medium flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500"></span>
              Video / Authenticated
            </div>
          </div>
        </div>

        {/* ── Enterprise Filter Panel ─────────────────────────────────────────── */}
        <div className="bg-white border border-[#E4E7EC] rounded-xl p-4 shadow-xs space-y-3.5">
          {/* Primary Filter Row */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Search Input */}
            <div className="md:col-span-4 relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search Call ID, Lead, Phone, Agent, Note..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-10 pr-8 py-2 text-xs bg-slate-50 hover:bg-slate-100/60 focus:bg-white border border-[#E4E7EC] rounded-xl text-[#111827] placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-all font-medium"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Agent Dropdown */}
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

            {/* Disposition Dropdown */}
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

            {/* Actions: Refresh, Cleanup & Reset Buttons */}
            <div className="md:col-span-2 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  loadStats();
                  loadRecordings();
                }}
                disabled={loading}
                className="p-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-[#E4E7EC] shadow-xs transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer shrink-0"
                title="Refresh recordings"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-blue-600" : "text-slate-500"}`} />
              </button>

              {isAdmin && (
                <button
                  onClick={() => {
                    setCleanupResult(null);
                    setShowCleanupModal(true);
                  }}
                  className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 shadow-xs transition-all active:scale-[0.98] cursor-pointer shrink-0"
                  title="Scan and clean orphan storage files"
                >
                  <Trash2 className="h-4 w-4 text-rose-600" />
                </button>
              )}

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
                className="w-full py-2 px-3 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-all text-center cursor-pointer shadow-2xs active:scale-[0.98]"
              >
                Reset Filters
              </button>
            </div>
          </div>

          {/* Secondary Filter Row: Segmented Status Pills + Date Range */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pt-3 border-t border-[#E4E7EC]">
            {/* Status Segmented Control */}
            <div className="flex items-center space-x-1 overflow-x-auto pb-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/60 self-start lg:self-auto">
              <span className="text-[11px] text-[#667085] font-semibold px-2 flex items-center gap-1">
                <Filter className="h-3 w-3 text-slate-400" />
                Status:
              </span>
              {STATUS_FILTERS.map((st) => (
                <button
                  key={st.id}
                  onClick={() => {
                    setStatusFilter(st.id);
                    setPage(1);
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    statusFilter === st.id
                      ? "bg-white text-blue-700 shadow-xs border border-slate-200 font-bold"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {/* Date Range Inputs & Quick Shortcuts */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center space-x-1.5 bg-slate-50 border border-[#E4E7EC] rounded-xl px-2.5 py-1">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  className="bg-transparent text-slate-800 text-xs focus:outline-none font-medium"
                />
                <span className="text-slate-400 font-medium">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  className="bg-transparent text-slate-800 text-xs focus:outline-none font-medium"
                />
              </div>

              <div className="flex items-center space-x-1">
                <button
                  onClick={() => applyDatePreset("today")}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] text-slate-700 font-semibold border border-slate-200/80 transition-all cursor-pointer"
                >
                  Today
                </button>
                <button
                  onClick={() => applyDatePreset("yesterday")}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] text-slate-700 font-semibold border border-slate-200/80 transition-all cursor-pointer"
                >
                  Yesterday
                </button>
                <button
                  onClick={() => applyDatePreset("week")}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] text-slate-700 font-semibold border border-slate-200/80 transition-all cursor-pointer"
                >
                  7 Days
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Selection / Bulk Actions Floating Bar ──────────────────────────── */}
        {selectedIds.size > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 shadow-xs flex items-center justify-between text-xs animate-fadeIn">
            <div className="flex items-center space-x-2 text-blue-900 font-semibold">
              <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
              <span>
                <strong className="font-bold">{selectedIds.size}</strong> recording{selectedIds.size > 1 ? "s" : ""} selected
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold transition-all cursor-pointer"
              >
                Clear Selection
              </button>
              {isSupervisor && (
                <button
                  onClick={() => setShowBatchDeleteModal(true)}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete Selected ({selectedIds.size})</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Main Split View: Recordings Table + Detail Drawer ──────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Table Section */}
          <div className={`${selectedRec ? "lg:col-span-7" : "lg:col-span-12"} space-y-4`}>
            <div className="bg-white border border-[#E4E7EC] rounded-xl shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#E4E7EC] bg-slate-50/80 text-[#667085] font-bold uppercase tracking-wider text-[10px]">
                      {isSupervisor && (
                        <th className="px-3 py-3.5 w-8 text-center">
                          <input
                            type="checkbox"
                            checked={recordings.length > 0 && selectedIds.size === recordings.length}
                            onChange={toggleSelectAll}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-3.5 w-3.5"
                            title="Select / Deselect all"
                          />
                        </th>
                      )}
                      <th className="px-4 py-3.5">Call ID / Lead</th>
                      <th className="px-4 py-3.5">Agent</th>
                      <th className="px-4 py-3.5">Date & Duration</th>
                      <th className="px-4 py-3.5">Outcome</th>
                      <th className="px-4 py-3.5">Storage / Status</th>
                      <th className="px-4 py-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E7EC] text-slate-700">
                    {loading ? (
                      <tr>
                        <td colSpan={isSupervisor ? 7 : 6} className="text-center py-16 text-slate-500">
                          <div className="flex flex-col items-center justify-center space-y-2.5">
                            <RefreshCw className="h-6 w-6 animate-spin text-blue-600" />
                            <span className="font-semibold text-xs text-slate-600">Loading call recordings...</span>
                          </div>
                        </td>
                      </tr>
                    ) : recordings.length === 0 ? (
                      <tr>
                        <td colSpan={isSupervisor ? 7 : 6} className="text-center py-16 text-slate-500">
                          <FileAudio className="h-10 w-10 mx-auto text-slate-300 mb-2.5" />
                          <p className="text-sm font-bold text-slate-700">No call recordings found</p>
                          <p className="text-xs text-[#667085] mt-1">Try changing your search query or filter parameters.</p>
                        </td>
                      </tr>
                    ) : (
                      recordings.map((rec) => {
                        const recKey = rec.id || rec._id || rec.call_id;
                        const isSelected = selectedRec && ((selectedRec.id || selectedRec._id) === (rec.id || rec._id) || selectedRec.call_id === rec.call_id);
                        const isChecked = selectedIds.has(recKey);

                        return (
                          <tr
                            key={recKey}
                            onClick={() => handleSelectRecording(rec)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-blue-50/70 border-l-4 border-l-blue-600"
                                : isChecked
                                ? "bg-slate-50"
                                : "hover:bg-slate-50/80"
                            }`}
                          >
                            {isSupervisor && (
                              <td className="px-3 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => toggleSelectRow(rec, e as any)}
                                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-3.5 w-3.5"
                                />
                              </td>
                            )}

                            <td className="px-4 py-3.5">
                              <div className="font-bold text-[#111827] flex items-center gap-1.5">
                                {rec.customer_name || "Customer"}
                              </div>
                              <div className="text-[11px] text-[#667085] font-mono flex items-center gap-1.5 mt-0.5">
                                <span>{rec.masked_phone || "****"}</span>
                                <span className="text-slate-300">•</span>
                                <span className="text-slate-500" title={rec.call_id}>
                                  {rec.call_id?.slice(0, 10)}...
                                </span>
                              </div>
                            </td>

                            <td className="px-4 py-3.5">
                              <div className="text-[#111827] font-semibold">{rec.agent_name || "Agent"}</div>
                              <div className="text-[10px] text-[#667085] capitalize">{rec.pool_id || "General"}</div>
                            </td>

                            <td className="px-4 py-3.5">
                              <div className="text-slate-800 font-medium">
                                {rec.call_start_time ? new Date(rec.call_start_time).toLocaleDateString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "N/A"}
                              </div>
                              <div className="text-[11px] text-blue-700 font-mono font-bold mt-0.5">
                                {formatSeconds(rec.duration_seconds || rec.duration || 0)}
                              </div>
                            </td>

                            <td className="px-4 py-3.5">
                              <span className="inline-block px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                                {rec.call_outcome || "Completed"}
                              </span>
                            </td>

                            <td className="px-4 py-3.5">
                              <div className="flex flex-col gap-1 items-start">
                                {rec.status === "READY" && (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                    READY
                                  </span>
                                )}
                                {rec.status === "PROCESSING" && (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 animate-pulse">
                                    <Clock className="h-3 w-3 text-amber-600" />
                                    PROCESSING
                                  </span>
                                )}
                                {rec.status === "RECORDING" && (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                    <Radio className="h-3 w-3 text-blue-600 animate-pulse" />
                                    RECORDING
                                  </span>
                                )}
                                {rec.status === "FAILED" && (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                    <AlertCircle className="h-3 w-3 text-rose-600" />
                                    FAILED
                                  </span>
                                )}
                                {rec.public_id && (
                                  <span className="text-[9px] font-mono text-[#667085] flex items-center gap-1 truncate max-w-[130px]" title={rec.public_id}>
                                    <Cloud className="h-2.5 w-2.5 text-blue-500 shrink-0" />
                                    {rec.public_id.split("/").pop()}
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="px-4 py-3.5 text-right">
                              <div className="flex items-center justify-end space-x-1.5">
                                {rec.status === "FAILED" && isSupervisor && (
                                  <button
                                    onClick={(e) => handleRetry(rec, e)}
                                    disabled={retryingId === recKey}
                                    className="p-1.5 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition-all cursor-pointer"
                                    title="Retry Cloudinary upload"
                                  >
                                    <RotateCw className={`h-3.5 w-3.5 ${retryingId === recKey ? "animate-spin" : ""}`} />
                                  </button>
                                )}

                                {isSupervisor && rec.status === "READY" && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDownload(rec);
                                    }}
                                    className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-all cursor-pointer"
                                    title="Download recording"
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                  </button>
                                )}

                                {isSupervisor && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRecordingToDelete(rec);
                                    }}
                                    className="p-1.5 rounded-lg bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-[#E4E7EC] hover:border-rose-200 shadow-2xs transition-all cursor-pointer"
                                    title="Delete recording"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}

                                <ChevronRight className="h-4 w-4 text-slate-400" />
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="px-4 py-3 border-t border-[#E4E7EC] bg-slate-50/60 flex items-center justify-between text-xs text-[#667085]">
                <div className="font-medium">
                  Showing <span className="font-bold text-[#111827]">{recordings.length}</span> of <span className="font-bold text-[#111827]">{totalCount}</span> recordings
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                    className="px-3 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-[#E4E7EC] font-semibold shadow-xs disabled:opacity-40 cursor-pointer"
                  >
                    Previous
                  </button>
                  <span className="font-medium">
                    Page <span className="text-[#111827] font-bold">{page}</span> / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || loading}
                    className="px-3 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-[#E4E7EC] font-semibold shadow-xs disabled:opacity-40 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right Inspector & Audio Player Drawer ─────────────────────────── */}
          {selectedRec && (
            <div className="lg:col-span-5 bg-white border border-[#E4E7EC] rounded-xl shadow-md flex flex-col overflow-hidden max-h-[85vh] sticky top-24">
              {/* Detail Header */}
              <div className="p-4 border-b border-[#E4E7EC] bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="h-9 w-9 rounded-xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                    <Mic className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-[#111827] flex items-center gap-1.5">
                      {selectedRec.customer_name || "Customer Call"}
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                        {selectedRec.masked_phone || "****"}
                      </span>
                    </h2>
                    <p className="text-[11px] text-[#667085] mt-0.5">
                      Handled by <span className="text-slate-900 font-semibold">{selectedRec.agent_name || "Agent"}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5">
                  {isSupervisor && selectedRec.status === "READY" && (
                    <button
                      onClick={() => handleDownload(selectedRec)}
                      className="p-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-[#E4E7EC] shadow-xs transition-all cursor-pointer"
                      title="Download Recording"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  )}
                  {isSupervisor && (
                    <button
                      onClick={() => setRecordingToDelete(selectedRec)}
                      className="p-1.5 rounded-lg bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-[#E4E7EC] hover:border-rose-200 shadow-xs transition-all cursor-pointer"
                      title="Delete Recording"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedRec(null)}
                    className="p-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-900 border border-[#E4E7EC] shadow-xs transition-all cursor-pointer"
                    title="Close Inspector"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div className="flex border-b border-[#E4E7EC] bg-slate-50/60 text-xs">
                <button
                  onClick={() => setActiveTab("player")}
                  className={`flex-1 py-2.5 px-3 font-bold text-center border-b-2 transition-all cursor-pointer ${
                    activeTab === "player"
                      ? "border-blue-600 text-blue-600 bg-white"
                      : "border-transparent text-[#667085] hover:text-slate-900 hover:bg-slate-100/50"
                  }`}
                >
                  Player & Audio
                </button>
                <button
                  onClick={() => setActiveTab("metadata")}
                  className={`flex-1 py-2.5 px-3 font-bold text-center border-b-2 transition-all cursor-pointer ${
                    activeTab === "metadata"
                      ? "border-blue-600 text-blue-600 bg-white"
                      : "border-transparent text-[#667085] hover:text-slate-900 hover:bg-slate-100/50"
                  }`}
                >
                  Cloudinary Asset
                </button>
                <button
                  onClick={() => setActiveTab("transcript")}
                  className={`flex-1 py-2.5 px-3 font-bold text-center border-b-2 transition-all cursor-pointer ${
                    activeTab === "transcript"
                      ? "border-blue-600 text-blue-600 bg-white"
                      : "border-transparent text-[#667085] hover:text-slate-900 hover:bg-slate-100/50"
                  }`}
                >
                  AI Transcript
                </button>
                <button
                  onClick={() => setActiveTab("events")}
                  className={`flex-1 py-2.5 px-3 font-bold text-center border-b-2 transition-all cursor-pointer ${
                    activeTab === "events"
                      ? "border-blue-600 text-blue-600 bg-white"
                      : "border-transparent text-[#667085] hover:text-slate-900 hover:bg-slate-100/50"
                  }`}
                >
                  Timeline
                </button>
              </div>

              {/* Tab Content Panels */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4">
                {/* ── TAB 1: PLAYER & AUDIO ───────────────────────────────────── */}
                {activeTab === "player" && (
                  <div className="space-y-4">
                    {(() => {
                      const currentAudioSrc = playbackUrl || getEffectiveAudioUrl(selectedRec);
                      const isUnavailable = !currentAudioSrc || selectedRec.status === "FAILED";

                      if (isUnavailable) {
                        return (
                          <div className="p-8 rounded-2xl bg-slate-50 border border-[#E4E7EC] text-center space-y-3 shadow-2xs">
                            <div className="h-12 w-12 rounded-full bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center mx-auto">
                              <VolumeX className="h-6 w-6" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-slate-800">Recording Unavailable</h4>
                              <p className="text-xs text-[#667085] mt-1">No voice audio asset is available for this call log.</p>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="p-5 rounded-2xl bg-white border border-[#E4E7EC] shadow-sm space-y-4">
                          {/* Header with Mic/Recording indicator */}
                          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <div className="flex items-center gap-2.5">
                              <div className="h-8 w-8 rounded-xl bg-blue-50 border border-blue-200/60 text-blue-600 flex items-center justify-center">
                                <Mic className="h-4 w-4 text-blue-600 animate-pulse" />
                              </div>
                              <div>
                                <div className="text-xs font-bold text-[#111827] flex items-center gap-1.5">
                                  <span>Call Recording</span>
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold uppercase">
                                    {selectedRec.format?.toUpperCase() || "WAV"}
                                  </span>
                                </div>
                                <div className="text-[10px] text-[#667085] font-mono">
                                  {formatFileSize(selectedRec.file_size_bytes || selectedRec.bytes)} • Cloudinary Audio
                                </div>
                              </div>
                            </div>

                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              AUTHENTICATED AUDIO
                            </span>
                          </div>

                          {/* HTML5 Audio Element with Cloudinary Signed / Streaming Source */}
                          <audio
                            ref={audioRef}
                            src={currentAudioSrc}
                            preload="metadata"
                            onTimeUpdate={() => {
                              if (audioRef.current) {
                                setCurrentTime(audioRef.current.currentTime);
                              }
                            }}
                            onLoadedMetadata={() => {
                              if (audioRef.current) {
                                const dur = audioRef.current.duration;
                                if (dur && !isNaN(dur) && dur > 0 && dur !== Infinity) {
                                  setAudioDuration(dur);
                                }
                                setAudioLoading(false);
                              }
                            }}
                            onDurationChange={() => {
                              if (audioRef.current) {
                                const dur = audioRef.current.duration;
                                if (dur && !isNaN(dur) && dur > 0 && dur !== Infinity) {
                                  setAudioDuration(dur);
                                }
                              }
                            }}
                            onWaiting={() => setAudioLoading(true)}
                            onPlaying={() => {
                              setAudioLoading(false);
                              setIsPlaying(true);
                            }}
                            onPause={() => setIsPlaying(false)}
                            onEnded={() => {
                              setIsPlaying(false);
                              setCurrentTime(0);
                            }}
                            onError={() => {
                              setAudioLoading(false);
                              const fallback = getStreamFallbackUrl(selectedRec);
                              if (playbackUrl !== fallback) {
                                console.warn("[PLAYER] Switching from direct Cloudinary to streaming proxy:", fallback);
                                setPlaybackUrl(fallback);
                              } else {
                                setAudioError("Recording audio stream unavailable or processing.");
                              }
                            }}
                          />

                          {/* Dynamic Interactive Waveform & Scrubber */}
                          <div className="space-y-2">
                            <div
                              className="h-14 bg-slate-50 border border-[#E4E7EC] rounded-xl px-3 py-2 flex items-center justify-between gap-1 cursor-pointer select-none hover:border-blue-300 transition-all shadow-2xs group relative overflow-hidden"
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                                const totalDur = audioDuration || selectedRec.duration_seconds || selectedRec.duration || 1;
                                const targetTime = clickRatio * totalDur;
                                setCurrentTime(targetTime);
                                if (audioRef.current) audioRef.current.currentTime = targetTime;
                              }}
                              title="Click anywhere on waveform to seek"
                            >
                              {WAVEFORM_BARS.map((heightPercent, idx) => {
                                const totalDur = audioDuration || selectedRec.duration_seconds || selectedRec.duration || 1;
                                const progressRatio = totalDur > 0 ? (currentTime / totalDur) : 0;
                                const barRatio = idx / WAVEFORM_BARS.length;
                                const isPlayed = barRatio <= progressRatio;

                                return (
                                  <div key={idx} className="flex-1 flex items-center justify-center h-full">
                                    <div
                                      className={`w-full rounded-full transition-all duration-150 ${
                                        isPlayed ? "bg-blue-600 shadow-xs" : "bg-slate-200 group-hover:bg-slate-300"
                                      }`}
                                      style={{ height: `${Math.max(16, heightPercent)}%` }}
                                    />
                                  </div>
                                );
                              })}
                            </div>

                            {/* Time labels & Range slider scrubber */}
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-xs font-mono font-bold">
                                <span className="text-blue-600">{formatSeconds(currentTime)}</span>
                                <span className="text-[#667085]">
                                  {formatSeconds(audioDuration || selectedRec.duration_seconds || selectedRec.duration || 0)}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={audioDuration || selectedRec.duration_seconds || selectedRec.duration || 100}
                                step={0.1}
                                value={currentTime}
                                onChange={handleSeek}
                                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                              />
                            </div>
                          </div>

                          {/* Primary Playback Controls */}
                          <div className="flex items-center justify-between pt-1 flex-wrap gap-3">
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => handleSkip(-10)}
                                className="p-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-[#E4E7EC] shadow-xs transition-all cursor-pointer hover:border-slate-300 active:scale-95"
                                title="Rewind 10 seconds"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </button>

                              <button
                                onClick={togglePlay}
                                className="h-12 w-12 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white flex items-center justify-center font-bold shadow-md shadow-blue-500/25 transition-all cursor-pointer active:scale-95"
                                title={isPlaying ? "Pause" : "Play"}
                              >
                                {audioLoading ? (
                                  <RefreshCw className="h-5 w-5 animate-spin text-white" />
                                ) : isPlaying ? (
                                  <Pause className="h-5 w-5 fill-current" />
                                ) : (
                                  <Play className="h-5 w-5 fill-current ml-0.5" />
                                )}
                              </button>

                              <button
                                onClick={() => handleSkip(10)}
                                className="p-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-[#E4E7EC] shadow-xs transition-all cursor-pointer hover:border-slate-300 active:scale-95"
                                title="Forward 10 seconds"
                              >
                                <RotateCw className="h-4 w-4" />
                              </button>
                            </div>

                            {/* Speed Selector */}
                            <div className="flex items-center space-x-1 bg-slate-100 border border-[#E4E7EC] rounded-xl p-1">
                              {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                                <button
                                  key={rate}
                                  onClick={() => handleRateChange(rate)}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                                    playbackRate === rate
                                      ? "bg-blue-600 text-white shadow-xs"
                                      : "text-slate-600 hover:text-slate-900"
                                  }`}
                                >
                                  {rate}x
                                </button>
                              ))}
                            </div>

                            {/* Volume Control */}
                            <div className="flex items-center space-x-1.5 w-32 bg-slate-50 border border-[#E4E7EC] rounded-xl px-2.5 py-1.5">
                              <button
                                onClick={toggleMute}
                                className="text-slate-500 hover:text-slate-800 p-0.5 cursor-pointer"
                                title={isMuted ? "Unmute" : "Mute"}
                              >
                                {isMuted || volume === 0 ? (
                                  <VolumeX className="h-4 w-4 text-rose-500" />
                                ) : (
                                  <Volume2 className="h-4 w-4 text-slate-700" />
                                )}
                              </button>
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.05}
                                value={isMuted ? 0 : volume}
                                onChange={handleVolumeChange}
                                className="w-16 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                              />
                            </div>
                          </div>

                          {/* Error State Banner */}
                          {audioError && (
                            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between">
                              <span className="flex items-center gap-1.5 font-medium">
                                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                                {audioError}
                              </span>
                              {isSupervisor && (
                                <button
                                  onClick={() => handleRetry(selectedRec)}
                                  className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] shadow-xs cursor-pointer"
                                >
                                  Retry
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Quick Call Overview Summary Card */}
                    <div className="p-4 rounded-xl bg-white border border-[#E4E7EC] space-y-3 text-xs shadow-xs">
                      <div className="font-bold text-[#111827] flex items-center justify-between border-b border-slate-100 pb-2.5">
                        <span>Recording Status & Compliance</span>
                        <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                          Consent Recorded
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-[#667085]">
                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          <span className="text-[11px] block font-medium">Call Outcome:</span>
                          <span className="text-[#111827] font-bold capitalize mt-0.5 block">{selectedRec.call_outcome || "Completed"}</span>
                        </div>
                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          <span className="text-[11px] block font-medium">File Size:</span>
                          <span className="text-[#111827] font-bold mt-0.5 block">{formatFileSize(selectedRec.file_size_bytes || selectedRec.bytes)}</span>
                        </div>
                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          <span className="text-[11px] block font-medium">Format:</span>
                          <span className="text-[#111827] font-bold uppercase font-mono mt-0.5 block">{selectedRec.format || selectedRec.mime_type || "WEBM"}</span>
                        </div>
                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          <span className="text-[11px] block font-medium">Duration:</span>
                          <span className="text-[#111827] font-bold mt-0.5 block">{formatSeconds(selectedRec.duration_seconds || selectedRec.duration || 0)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── TAB 2: CLOUDINARY ASSET METADATA ───────────────────────── */}
                {activeTab === "metadata" && (
                  <div className="space-y-3 text-xs">
                    {/* Cloudinary Asset Metadata Card */}
                    <div className="p-4 rounded-xl bg-white border border-[#E4E7EC] shadow-xs space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                        <h3 className="font-bold text-blue-700 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                          <Cloud className="h-4 w-4 text-blue-600" />
                          Cloudinary Storage Reference
                        </h3>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                          <Lock className="h-3 w-3 text-blue-600" />
                          Authenticated Delivery
                        </span>
                      </div>

                      <div className="space-y-2.5 text-slate-700">
                        <div className="flex items-center justify-between py-1 border-b border-slate-100">
                          <span className="text-[#667085] font-medium">Storage Provider:</span>
                          <span className="font-bold text-blue-700 uppercase font-mono">{selectedRec.storage_provider || "Cloudinary"}</span>
                        </div>

                        <div className="flex items-center justify-between py-1 border-b border-slate-100">
                          <span className="text-[#667085] font-medium">Public ID:</span>
                          <div className="flex items-center space-x-1.5 font-mono text-blue-700 text-[11px] truncate max-w-[200px]">
                            <span className="truncate">{selectedRec.public_id || "N/A"}</span>
                            {selectedRec.public_id && (
                              <button
                                onClick={() => copyToClipboard(selectedRec.public_id || "", "Public ID")}
                                className="p-1 hover:text-blue-900 shrink-0 cursor-pointer"
                                title="Copy Cloudinary Public ID"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        {selectedRec.secure_url && (
                          <div className="flex items-center justify-between py-1 border-b border-slate-100">
                            <span className="text-[#667085] font-medium">Secure URL:</span>
                            <div className="flex items-center space-x-1.5 font-mono text-slate-800 text-[11px] truncate max-w-[200px]">
                              <span className="truncate">{selectedRec.secure_url}</span>
                              <button
                                onClick={() => copyToClipboard(selectedRec.secure_url || "", "Secure URL")}
                                className="p-1 hover:text-blue-600 shrink-0 cursor-pointer"
                                title="Copy Secure URL"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between py-1 border-b border-slate-100">
                          <span className="text-[#667085] font-medium">Resource Type:</span>
                          <span className="font-mono text-slate-900 font-semibold">video (audio stream)</span>
                        </div>

                        <div className="flex items-center justify-between py-1">
                          <span className="text-[#667085] font-medium">Format:</span>
                          <span className="font-mono text-slate-900 font-bold uppercase">{selectedRec.format || "webm"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Identifiers Card */}
                    <div className="p-4 rounded-xl bg-white border border-[#E4E7EC] shadow-xs space-y-2.5">
                      <h3 className="font-bold text-[#111827] uppercase tracking-wider text-[10px] border-b border-slate-100 pb-2">Call Identifiers</h3>
                      <div className="space-y-2 text-slate-700">
                        <div className="flex items-center justify-between">
                          <span className="text-[#667085] font-medium">Call ID:</span>
                          <div className="flex items-center space-x-1.5 font-mono text-slate-900 font-bold">
                            <span>{selectedRec.call_id}</span>
                            <button
                              onClick={() => copyToClipboard(selectedRec.call_id, "Call ID")}
                              className="p-1 hover:text-blue-600 cursor-pointer"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        </div>

                        {selectedRec.lead_id && (
                          <div className="flex items-center justify-between">
                            <span className="text-[#667085] font-medium">Lead ID:</span>
                            <div className="flex items-center space-x-1.5 font-mono text-slate-900">
                              <span>{selectedRec.lead_id}</span>
                              <button
                                onClick={() => copyToClipboard(selectedRec.lead_id || "", "Lead ID")}
                                className="p-1 hover:text-blue-600 cursor-pointer"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <span className="text-[#667085] font-medium">Customer Name:</span>
                          <span className="font-bold text-slate-900">{selectedRec.customer_name || "Customer"}</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-[#667085] font-medium">Phone (Masked):</span>
                          <span className="font-mono font-semibold text-slate-900">{selectedRec.masked_phone || "****"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Upload Timestamps & Integrity */}
                    <div className="p-4 rounded-xl bg-white border border-[#E4E7EC] shadow-xs space-y-2.5">
                      <h3 className="font-bold text-[#111827] uppercase tracking-wider text-[10px] border-b border-slate-100 pb-2">Timestamps & Integrity</h3>
                      <div className="space-y-2 text-slate-700">
                        <div className="flex items-center justify-between">
                          <span className="text-[#667085] font-medium">Upload Started:</span>
                          <span className="font-mono text-slate-800">
                            {selectedRec.upload_started_at ? new Date(selectedRec.upload_started_at).toLocaleTimeString() : "N/A"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[#667085] font-medium">Upload Completed:</span>
                          <span className="font-mono text-slate-800">
                            {selectedRec.upload_completed_at ? new Date(selectedRec.upload_completed_at).toLocaleTimeString() : "N/A"}
                          </span>
                        </div>
                        {selectedRec.upload_error_at && (
                          <div className="flex items-center justify-between text-rose-700">
                            <span className="font-medium">Error Timestamp:</span>
                            <span className="font-mono">{new Date(selectedRec.upload_error_at).toLocaleTimeString()}</span>
                          </div>
                        )}
                        {selectedRec.checksum_sha256 && (
                          <div className="flex flex-col space-y-1 pt-1.5 border-t border-slate-100">
                            <span className="text-[#667085] font-medium">SHA-256 Checksum:</span>
                            <span className="font-mono text-[10px] text-slate-800 break-all bg-slate-50 p-2 rounded-lg border border-slate-200">
                              {selectedRec.checksum_sha256}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── TAB 3: AI TRANSCRIPT ────────────────────────────────────── */}
                {activeTab === "transcript" && (
                  <div className="space-y-3 text-xs">
                    {/* AI Summary Block */}
                    <div className="p-4 rounded-xl bg-purple-50/70 border border-purple-200 shadow-xs space-y-2">
                      <div className="flex items-center space-x-1.5 text-purple-700 font-bold text-[11px] uppercase tracking-wider">
                        <Sparkles className="h-4 w-4 text-purple-600" />
                        <span>AI Call Summary & Insights</span>
                      </div>
                      <p className="text-purple-950 leading-relaxed font-medium">
                        {selectedRec.ai_summary || "No AI summary generated for this call."}
                      </p>
                    </div>

                    {/* Agent Notes */}
                    {selectedRec.notes && (
                      <div className="p-3.5 rounded-xl bg-white border border-[#E4E7EC] shadow-xs space-y-1">
                        <span className="text-[10px] font-bold text-[#667085] uppercase tracking-wider">Agent Remarks</span>
                        <p className="text-slate-800 font-medium">{selectedRec.notes}</p>
                      </div>
                    )}

                    {/* Structured Transcript */}
                    <div className="p-4 rounded-xl bg-white border border-[#E4E7EC] shadow-xs space-y-2.5">
                      <span className="text-[10px] font-bold text-[#667085] uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-2">
                        <FileText className="h-3.5 w-3.5 text-slate-400" />
                        Verbatim Transcript
                      </span>
                      {selectedRec.transcript ? (
                        <div className="space-y-2 text-slate-800 leading-relaxed font-sans max-h-60 overflow-y-auto pr-1">
                          {selectedRec.transcript.split("\n").map((line, idx) => (
                            <p key={idx} className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs">
                              {line}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[#667085] italic py-2">No verbatim transcript recorded for this conversation.</p>
                      )}
                    </div>
                  </div>
                )}

                {/* ── TAB 4: TIMELINE ─────────────────────────────────────────── */}
                {activeTab === "events" && (
                  <div className="space-y-2 text-xs">
                    {selectedRec.events && selectedRec.events.length > 0 ? (
                      <div className="relative pl-4 space-y-3.5 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                        {selectedRec.events.map((evt: any, i: number) => (
                          <div key={i} className="relative pl-2.5">
                            <div className="absolute -left-[19px] top-1.5 h-2.5 w-2.5 rounded-full bg-blue-600 ring-4 ring-white shadow-xs" />
                            <div className="p-3 rounded-xl bg-white border border-[#E4E7EC] shadow-xs">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="font-bold text-slate-900">{evt.title || evt.event || "Call Event"}</span>
                                <span className="text-[#667085] font-mono text-[10px]">{evt.timestamp || evt.created_at?.slice(11, 19) || ""}</span>
                              </div>
                              {evt.description && (
                                <p className="text-[#667085] text-[11px] mt-1 font-medium">{evt.description}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-[#667085]">
                        <Clock className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-semibold text-xs text-slate-700">No event log captured</p>
                        <p className="text-[11px] text-[#667085] mt-0.5">Call events will appear here in chronological order.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Single Recording Deletion Confirmation Modal ─────────────────── */}
      {recordingToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md rounded-2xl bg-white border border-[#E4E7EC] p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-rose-700">
              <div className="h-10 w-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#111827]">Delete Call Recording?</h3>
                <p className="text-xs text-[#667085]">Permanent Asset & Record Removal</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed font-medium">
              Are you sure you want to delete this recording? This action will permanently remove the audio file from Cloudinary/storage and unlink it from the call log.
            </p>

            {/* Recording Summary Preview */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[#667085]">Customer:</span>
                <span className="font-bold text-slate-900">{recordingToDelete.customer_name || "Customer"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#667085]">Phone:</span>
                <span className="font-mono text-slate-800">{recordingToDelete.masked_phone || "****"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#667085]">Call ID:</span>
                <span className="font-mono text-[11px] text-slate-700 truncate max-w-[200px]">{recordingToDelete.call_id}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#667085]">Duration:</span>
                <span className="font-mono font-bold text-blue-700">{formatSeconds(recordingToDelete.duration_seconds || recordingToDelete.duration || 0)}</span>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#E4E7EC]">
              <button
                onClick={() => setRecordingToDelete(null)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                onClick={confirmDeleteSingle}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm shadow-rose-600/30 transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isDeleting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                <span>{isDeleting ? "Deleting..." : "Yes, Delete Recording"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Batch Recordings Deletion Confirmation Modal ───────────────────── */}
      {showBatchDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md rounded-2xl bg-white border border-[#E4E7EC] p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-rose-700">
              <div className="h-10 w-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#111827]">Delete {selectedIds.size} Selected Recordings?</h3>
                <p className="text-xs text-[#667085]">Bulk Asset & Database Cleanup</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed font-medium">
              You are about to permanently delete <strong className="text-slate-900 font-bold">{selectedIds.size}</strong> call recordings. All corresponding Cloudinary media files and database records will be erased.
            </p>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#E4E7EC]">
              <button
                onClick={() => setShowBatchDeleteModal(false)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                onClick={confirmBatchDelete}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm shadow-rose-600/30 transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isDeleting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                <span>{isDeleting ? "Deleting..." : `Delete ${selectedIds.size} Recordings`}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Storage Maintenance & Orphan Cleanup Modal ──────────────────────── */}
      {showCleanupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md rounded-2xl bg-white border border-[#E4E7EC] p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-rose-700">
              <div className="h-10 w-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center">
                <Trash2 className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#111827]">Storage & Maintenance Utilities</h3>
                <p className="text-xs text-[#667085]">Admin Maintenance Tools</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed font-medium">
              Choose an administrative storage cleanup tool below:
            </p>

            <div className="space-y-2">
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Scan & Clean Orphan Files</h4>
                  <p className="text-[11px] text-[#667085]">Purges physical files with no database index.</p>
                </div>
                <button
                  onClick={handleCleanupOrphans}
                  disabled={cleaningOrphans}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {cleaningOrphans ? "Cleaning..." : "Run Cleanup"}
                </button>
              </div>

              <div className="p-3 rounded-xl border border-rose-200 bg-rose-50/50 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-rose-900">Purge Failed Recordings</h4>
                  <p className="text-[11px] text-rose-700">Removes records that failed processing.</p>
                </div>
                <button
                  onClick={handlePurgeFailed}
                  disabled={cleaningOrphans}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50 shrink-0"
                >
                  Purge Failed
                </button>
              </div>
            </div>

            {cleanupResult && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs space-y-1 text-emerald-900">
                <div className="text-emerald-700 font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Cleanup Completed
                </div>
                <div>Deleted files count: <span className="font-mono font-bold text-slate-900">{cleanupResult.orphans_cleaned_count}</span></div>
                <div>Reclaimed space: <span className="font-mono font-bold text-slate-900">{cleanupResult.reclaimed_mb} MB</span></div>
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#E4E7EC]">
              <button
                onClick={() => setShowCleanupModal(false)}
                disabled={cleaningOrphans}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
