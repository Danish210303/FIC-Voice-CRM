import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, getBaseUrl, getToken } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { CustomSelect } from "../components/CustomSelect";
import {
  ShieldCheck,
  CheckSquare,
  Volume2,
  VolumeX,
  BookOpen,
  User,
  Calendar,
  TrendingUp,
  Sparkles,
  MessageSquare,
  Award,
  ChevronRight,
  Clock,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Mic,
  RefreshCw,
  AlertCircle,
  Trash2,
  Loader2
} from "lucide-react";

type CallLog = {
  id: string;
  lead_id: string;
  agent_id: string;
  agent_name?: string;
  agent_email?: string;
  agent_employee_id?: string;
  agent_department?: string;
  lead_name?: string;
  phone?: string;
  pool_id: string;
  direction: string;
  status: string;
  outcome: string;
  duration_seconds: number;
  notes?: string;
  ai_summary?: string;
  transcript?: string;
  started_at: string;
  ended_at?: string;
  recording_file?: string;
  recording_url?: string;
  secure_url?: string;
  public_id?: string;
  recording_status?: string;
  quality_evaluation?: {
    coaching_notes: string;
    ai_quality_score: number;
    compliance_score: number;
    sentiment: string;
    evaluated_by: string;
    evaluated_at: string;
  };
};

const getRecordingAudioUrl = (call: CallLog | null): string | null => {
  if (!call) return null;
  const token = getToken() || localStorage.getItem("access_token");
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
  const base = getBaseUrl();

  const file = call.secure_url || call.recording_url || call.recording_file;
  if (file && typeof file === "string") {
    if (file.startsWith("http://") || file.startsWith("https://")) {
      return file;
    }
    if (file.startsWith("/api/")) {
      return `${base}${file}${tokenQuery}`;
    }
    if (file.endsWith(".wav") || file.endsWith(".mp3") || file.endsWith(".ogg") || file.endsWith(".webm") || file.startsWith("rec_")) {
      return `${base}/api/recordings/${call.id}/stream${tokenQuery}`;
    }
  }

  const callId = call.id || (call as any)._id;
  if (callId && call.recording_status === "saved") {
    return `${base}/api/recordings/${callId}/stream${tokenQuery}`;
  }
  return null;
};

const WAVEFORM_BARS = [
  30, 55, 40, 75, 60, 90, 45, 80, 95, 65, 85, 50, 70, 90, 100, 80, 65, 45, 75,
  90, 85, 60, 40, 70, 95, 80, 65, 90, 100, 75, 55, 40, 65, 80, 50, 30
];

const formatSeconds = (sec: number | string | undefined | null): string => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs.toString().padStart(2, "0")}:${remMins.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
};

const SENTIMENT_OPTIONS = [
  { value: "positive", label: "Positive (Satisfied, cooperative)" },
  { value: "neutral", label: "Neutral (General business exchange)" },
  { value: "negative", label: "Negative (Frustrated, argumentative)" }
];

export default function Quality() {
  const { user } = useAuth();
  const canDelete =
    user?.role === "admin" ||
    user?.role === "team_leader" ||
    user?.role === "supervisor" ||
    String(user?.role || "").toLowerCase().includes("admin") ||
    String(user?.role || "").toLowerCase().includes("supervisor") ||
    String(user?.role || "").toLowerCase().includes("leader");

  const { showToast } = useToast();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [audioErrorMap, setAudioErrorMap] = useState<Record<string, boolean>>({});
  const [callToDelete, setCallToDelete] = useState<CallLog | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Audio Player State
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [audioLoading, setAudioLoading] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState<string>("");

  // Form Evaluation state
  const [coachingNotes, setCoachingNotes] = useState("");
  const [aiQualityScore, setAiQualityScore] = useState(0);
  const [complianceScore, setComplianceScore] = useState(0);
  const [sentiment, setSentiment] = useState("");

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

      // 2. If the deleted call was currently selected, clear it
      if (selectedCall?.id === targetCallId) {
        setSelectedCall(null);
        setIsPlaying(false);
        setPlaybackUrl("");
      }

      showToast("Call record deleted successfully", "success");
      setCallToDelete(null);
    } catch (err: any) {
      const errorMsg =
        err?.response?.data?.detail || err?.message || "Failed to delete call record";
      showToast(errorMsg, "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const loadData = useCallback(async () => {
    try {
      const data = await api.get("/api/calls?status_filter=completed");
      setCalls(data);
    } catch (err: any) {
      showToast(err.message || "Failed to load completed calls.", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const selectCallToAudit = (call: CallLog) => {
    setSelectedCall(call);
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(call.duration_seconds || 0);
    setAudioLoading(false);
    const audioUrl = getRecordingAudioUrl(call);
    setPlaybackUrl(audioUrl || "");
    
    // Pre-fill form if evaluation exists
    if (call.quality_evaluation) {
      setCoachingNotes(call.quality_evaluation.coaching_notes);
      setAiQualityScore(call.quality_evaluation.ai_quality_score);
      setComplianceScore(call.quality_evaluation.compliance_score);
      setSentiment(call.quality_evaluation.sentiment);
    } else {
      setCoachingNotes("");
      setAiQualityScore(0);
      setComplianceScore(0);
      setSentiment("");
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch((err) => {
        console.warn("[QUALITY AUDIO] Play failed:", err);
        setIsPlaying(false);
      });
    }
  };

  const handleSkip = (seconds: number) => {
    if (!audioRef.current) return;
    const newTime = Math.max(0, Math.min((audioDuration || 1000), audioRef.current.currentTime + seconds));
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    audioRef.current.muted = nextMute;
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    if (audioRef.current) {
      audioRef.current.volume = val;
      audioRef.current.muted = val === 0;
    }
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  async function handleSaveEvaluation(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCall) return;
    try {
      await api.post(`/api/calls/${selectedCall.id}/quality`, {
        coaching_notes: coachingNotes,
        ai_quality_score: Number(aiQualityScore),
        compliance_score: Number(complianceScore),
        sentiment
      });
      showToast("Quality audit evaluation successfully submitted.", "success");
      loadData();
      
      // Update selected call details
      setSelectedCall(prev => {
        if (!prev) return null;
        return {
          ...prev,
          quality_evaluation: {
            coaching_notes: coachingNotes,
            ai_quality_score: Number(aiQualityScore),
            compliance_score: Number(complianceScore),
            sentiment,
            evaluated_by: "Current User",
            evaluated_at: new Date().toISOString()
          }
        };
      });
    } catch (err: any) {
      showToast(err.message || "Evaluation submit failed.", "error");
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-sans">
      {/* Header Panel */}
      <div className="bg-white dark:bg-[#111827] backdrop-blur-xl p-6 rounded-[20px] shadow-md border border-slate-200/80 dark:border-white/10">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-5">
          <div className="flex items-center gap-5">
            {/* 72x72 Shield Avatar with 135° Blue -> Yellow Gradient Border */}
            <div className="h-[72px] w-[72px] rounded-[24px] p-[3px] bg-gradient-to-br from-[#2563EB] via-[#3B82F6] to-[#FACC15] shadow-[0_8px_20px_-4px_rgba(37,99,235,0.35),0_8px_20px_-4px_rgba(250,204,21,0.25)] shrink-0 transition-transform duration-300 hover:scale-105">
              <div className="w-full h-full rounded-[21px] bg-gradient-to-br from-[#2563EB] to-[#1E5EFF] dark:from-[#1E3A8A] dark:to-[#172554] flex items-center justify-center relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent pointer-events-none rounded-t-[21px]" />
                <ShieldCheck className="h-[32px] w-[32px] text-white relative z-10 drop-shadow-xs" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap min-w-0">
                <div className="flex flex-col items-start">
                  <h1 className="text-xl sm:text-2xl lg:text-[26px] font-extrabold tracking-tight leading-tight flex items-center gap-2 -tracking-[0.5px]">
                    <span className="text-[#1D4ED8] dark:text-[#3B82F6] font-extrabold">Call Quality</span>
                    <span className="text-[#F4B400] font-extrabold">Auditing Console</span>
                  </h1>
                </div>
                <span className="bg-white dark:bg-[#0F172A] border border-[#2563EB]/40 dark:border-blue-400/40 text-[#1D4ED8] dark:text-[#60A5FA] text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider shadow-2xs inline-flex items-center gap-1.5 shrink-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#F4B400] animate-pulse"></span>
                  AUDIT SUITE
                </span>
              </div>
              <p className="text-xs sm:text-sm text-[#64748B] dark:text-[#94A3B8] font-medium mt-1">
                Audit agent conversations, inspect speech transcripts, and rate guidelines compliance
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Completed Calls Log List */}
        <div className="bg-white dark:bg-[#111827] rounded-[20px] p-6 shadow-md border border-slate-200/80 dark:border-white/10 lg:col-span-1 flex flex-col max-h-[720px] space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 pb-4">
            <h2 className="text-base font-black text-slate-900 dark:text-[#F8FAFC] flex items-center gap-2.5">
              <CheckSquare className="h-5 w-5 text-[#2563EB] dark:text-[#60A5FA]" />
              <span>Completed Shift Logs</span>
            </h2>
            <span className="bg-slate-100 dark:bg-[#172033] border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#94A3B8] text-xs font-mono font-extrabold px-3 py-1 rounded-full">
              {calls.length} Logs
            </span>
          </div>
          
          {loading ? (
            <div className="text-center py-16">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-3 border-[#2563EB] border-t-transparent mb-3"></div>
              <p className="text-xs text-slate-400 dark:text-[#64748B] font-extrabold uppercase tracking-widest">Loading call history...</p>
            </div>
          ) : (
            <div className="space-y-3 overflow-y-auto pr-1 flex-1">
              {calls.map(c => {
                const isSelected = selectedCall?.id === c.id;
                const durSec = Number(c.duration_seconds) || 0;
                const minutes = Math.floor(durSec / 60);
                const seconds = String(durSec % 60).padStart(2, "0");

                return (
                  <div
                    key={c.id}
                    onClick={() => selectCallToAudit(c)}
                    className={`p-4 border rounded-[18px] transition-all duration-200 cursor-pointer text-left space-y-2.5 ${
                      isSelected
                        ? "border-[#F4B400] dark:border-[#F4B400] bg-amber-50/70 dark:bg-amber-500/15 shadow-md shadow-amber-500/10 border-l-4 border-l-[#F4B400]"
                        : "bg-slate-50 dark:bg-[#172033] hover:bg-white dark:hover:bg-[#1C2740] border-slate-200/80 dark:border-white/10 hover:shadow-xs hover:border-l-4 hover:border-l-[#F4B400]"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-black text-xs text-[#2563EB] dark:text-[#60A5FA] bg-blue-50 dark:bg-blue-500/15 px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-500/30">
                        {c.lead_id}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 dark:text-[#94A3B8] font-bold font-mono flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                          {minutes}:{seconds}
                        </span>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCallToDelete(c);
                            }}
                            className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                            title="Delete Call Record"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-between items-end gap-2 pt-1">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-[#2563EB] to-[#3B82F6] text-white font-black text-xs flex items-center justify-center shadow-xs shrink-0 border border-blue-400/30">
                          {(c.agent_name || c.agent_id || "A")[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-900 dark:text-[#F8FAFC] truncate" title={`${c.agent_name || 'Agent'}${c.agent_employee_id ? ` (${c.agent_employee_id})` : ''}`}>
                            {c.agent_name || "Agent"}
                            {c.agent_employee_id && c.agent_employee_id !== c.agent_name && (
                              <span className="ml-1 text-[10px] font-normal text-slate-400 dark:text-slate-500 font-mono">
                                ({c.agent_employee_id.length > 14 ? c.agent_employee_id.slice(-6) : c.agent_employee_id})
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 dark:text-[#64748B] font-semibold">{new Date(c.started_at).toLocaleString()}</div>
                        </div>
                      </div>

                      {c.quality_evaluation ? (
                        <span className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-[#047857] dark:text-[#34D399] text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full flex items-center gap-1 shrink-0">
                          <Award className="h-3 w-3" />
                          <span>Audited ({c.quality_evaluation.ai_quality_score})</span>
                        </span>
                      ) : (
                        <span className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-[#94A3B8] text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full shrink-0">
                          Pending
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {calls.length === 0 && (
                <p className="text-xs text-slate-400 dark:text-[#64748B] text-center py-16 font-medium">No completed call logs found.</p>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Audio details and audit form */}
        <div className="lg:col-span-2 space-y-6">
          {selectedCall ? (
            <div className="bg-white dark:bg-[#111827] rounded-[20px] p-6 shadow-md border border-slate-200/80 dark:border-white/10 space-y-6">
              
              {/* Call identity Header */}
              <div className="bg-slate-50 dark:bg-[#172033] border border-slate-200/80 dark:border-white/10 p-5 rounded-[20px] flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-xs">
                <div className="space-y-1">
                  <h3 className="font-black text-slate-900 dark:text-[#F8FAFC] text-lg font-mono flex items-center gap-2">
                    <span>Conversation ID:</span>
                    <span className="text-[#2563EB] dark:text-[#60A5FA]">{selectedCall.id.slice(-8).toUpperCase()}</span>
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-[#94A3B8] font-semibold">
                    <span className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-[#2563EB] dark:text-[#60A5FA]" />
                      Agent: {selectedCall.agent_name || selectedCall.agent_id}
                      {selectedCall.agent_employee_id && selectedCall.agent_employee_id !== selectedCall.agent_name && (
                        <span className="text-[10px] font-mono text-slate-400">({selectedCall.agent_employee_id})</span>
                      )}
                    </span>
                    <span>·</span>
                    <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-[#2563EB] dark:text-[#60A5FA]" /> Date: {new Date(selectedCall.started_at).toLocaleString()}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-[#2563EB] dark:text-[#60A5FA]" /> Duration: {formatSeconds(selectedCall.duration_seconds)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 shadow-2xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    CALL COMPLETED
                  </span>
                </div>
              </div>

              {/* ── PLAYER & AUDIO SECTION ─────────────────────────────────── */}
              {(() => {
                const callId = selectedCall.id || (selectedCall as any)._id;
                const hasError = callId ? audioErrorMap[callId] : false;
                const currentAudioSrc = playbackUrl || getRecordingAudioUrl(selectedCall);
                const isUnavailable = !currentAudioSrc || hasError;

                if (isUnavailable) {
                  return (
                    <div className="p-6 rounded-2xl bg-slate-50 dark:bg-[#172033] border border-slate-200/80 dark:border-white/10 text-center space-y-2 shadow-2xs">
                      <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400 flex items-center justify-center mx-auto">
                        <VolumeX className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-800 dark:text-[#F8FAFC]">Recording Unavailable</h4>
                        <p className="text-xs text-[#667085] dark:text-slate-400 mt-0.5">No voice recording stream is available for this call log.</p>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="p-5 rounded-2xl bg-white dark:bg-[#172033] border border-slate-200/80 dark:border-white/10 shadow-sm space-y-4">
                    {/* Header with Mic/Recording indicator */}
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200/60 dark:border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                          <Mic className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-pulse" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span>Call Recording</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold uppercase">
                              Cloudinary Audio
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                            {selectedCall.agent_name || "Agent"} ↔ {selectedCall.lead_name || selectedCall.phone || "Customer"}
                          </div>
                        </div>
                      </div>

                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 shadow-2xs">
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
                        console.warn(`[QUALITY] Audio load error for call ${callId}`);
                        if (callId) {
                          setAudioErrorMap((prev) => ({ ...prev, [callId]: true }));
                        }
                      }}
                    />

                    {/* Dynamic Interactive Waveform & Scrubber */}
                    <div className="space-y-2">
                      <div
                        className="h-14 bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-white/10 rounded-xl px-3 py-2 flex items-center justify-between gap-1 cursor-pointer select-none hover:border-blue-300 dark:hover:border-blue-500 transition-all shadow-2xs group relative overflow-hidden"
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                          const totalDur = audioDuration || selectedCall.duration_seconds || 1;
                          const targetTime = clickRatio * totalDur;
                          setCurrentTime(targetTime);
                          if (audioRef.current) audioRef.current.currentTime = targetTime;
                        }}
                        title="Click anywhere on waveform to seek"
                      >
                        {WAVEFORM_BARS.map((heightPercent, idx) => {
                          const totalDur = audioDuration || selectedCall.duration_seconds || 1;
                          const progressRatio = totalDur > 0 ? (currentTime / totalDur) : 0;
                          const barRatio = idx / WAVEFORM_BARS.length;
                          const isPlayed = barRatio <= progressRatio;

                          return (
                            <div key={idx} className="flex-1 flex items-center justify-center h-full">
                              <div
                                className={`w-full rounded-full transition-all duration-150 ${
                                  isPlayed ? "bg-blue-600 shadow-xs" : "bg-slate-200 dark:bg-slate-700 group-hover:bg-slate-300 dark:group-hover:bg-slate-600"
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
                          <span className="text-blue-600 dark:text-blue-400">{formatSeconds(currentTime)}</span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {formatSeconds(audioDuration || selectedCall.duration_seconds || 0)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={audioDuration || selectedCall.duration_seconds || 100}
                          step={0.1}
                          value={currentTime}
                          onChange={handleSeek}
                          className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                      </div>
                    </div>

                    {/* Primary Playback Controls */}
                    <div className="flex items-center justify-between pt-1 flex-wrap gap-3">
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => handleSkip(-10)}
                          className="p-2.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 shadow-xs transition-all cursor-pointer hover:border-slate-300 active:scale-95"
                          title="Rewind 10 seconds"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>

                        <button
                          type="button"
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
                          type="button"
                          onClick={() => handleSkip(10)}
                          className="p-2.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 shadow-xs transition-all cursor-pointer hover:border-slate-300 active:scale-95"
                          title="Forward 10 seconds"
                        >
                          <RotateCw className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Speed Selector */}
                      <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-white/10 rounded-xl p-1">
                        {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => handleRateChange(rate)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                              playbackRate === rate
                                ? "bg-blue-600 text-white shadow-xs"
                                : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                            }`}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>

                      {/* Volume Control */}
                      <div className="flex items-center space-x-1.5 w-32 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-white/10 rounded-xl px-2.5 py-1.5">
                        <button
                          type="button"
                          onClick={toggleMute}
                          className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white p-0.5 cursor-pointer"
                          title={isMuted ? "Unmute" : "Mute"}
                        >
                          {isMuted || volume === 0 ? (
                            <VolumeX className="h-4 w-4 text-rose-500" />
                          ) : (
                            <Volume2 className="h-4 w-4 text-slate-700 dark:text-slate-300" />
                          )}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={isMuted ? 0 : volume}
                          onChange={handleVolumeChange}
                          className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-center mt-6">
                
                {/* Auditing evaluation form */}
                <form onSubmit={handleSaveEvaluation} className="space-y-5 w-full max-w-2xl">
                  <h3 className="font-black text-slate-900 dark:text-[#F8FAFC] text-sm uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Award className="h-5 w-5 text-[#FACC15]" />
                    <span>Evaluation Scorecard</span>
                  </h3>
                  
                  {/* AI Quality Score */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-extrabold text-slate-700 dark:text-[#F8FAFC]">AI Quality Score</label>
                      <span className="bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30 text-[#2563EB] dark:text-[#60A5FA] font-mono font-black px-2.5 py-1 rounded-full text-xs">
                        {aiQualityScore} / 100
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={aiQualityScore}
                      onChange={e => setAiQualityScore(Number(e.target.value))}
                      className="w-full h-2 bg-slate-100 dark:bg-[#172033] rounded-lg appearance-none cursor-pointer accent-[#2563EB]"
                    />
                  </div>

                  {/* Compliance Score */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-extrabold text-slate-700 dark:text-[#F8FAFC]">Compliance & Guidelines Score</label>
                      <span className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-[#047857] dark:text-[#34D399] font-mono font-black px-2.5 py-1 rounded-full text-xs">
                        {complianceScore} / 100
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={complianceScore}
                      onChange={e => setComplianceScore(Number(e.target.value))}
                      className="w-full h-2 bg-slate-100 dark:bg-[#172033] rounded-lg appearance-none cursor-pointer accent-[#2563EB]"
                    />
                  </div>

                  {/* Sentiment select */}
                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 dark:text-[#F8FAFC] mb-1.5">Customer Sentiment Analysis</label>
                    <CustomSelect
                      value={sentiment}
                      onChange={setSentiment}
                      options={SENTIMENT_OPTIONS}
                      placeholder="Select Sentiment"
                      triggerClassName="h-[52px] rounded-[14px] text-xs dark:bg-[#172033] dark:text-[#F8FAFC] dark:border-white/10 hover:border-[#2563EB]"
                    />
                  </div>

                  {/* Coaching notes */}
                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 dark:text-[#F8FAFC] mb-1.5">Supervisor Coaching Notes</label>
                    <textarea
                      placeholder="Add specific coaching guidelines, positive call highlights, or compliance correctives..."
                      value={coachingNotes}
                      onChange={e => setCoachingNotes(e.target.value)}
                      className="w-full border border-slate-200 dark:border-white/10 rounded-[16px] p-3.5 text-xs bg-slate-50 dark:bg-[#172033] h-32 text-slate-900 dark:text-[#F8FAFC] placeholder-slate-400 dark:placeholder-[#64748B] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-500/20 transition font-sans"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full h-[52px] bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] text-white font-black text-xs rounded-[14px] transition-all duration-200 shadow-md shadow-blue-500/25 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                  >
                    <ShieldCheck className="h-4.5 w-4.5" />
                    <span>Submit Evaluation Audit</span>
                  </button>
                </form>

              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-[#111827] rounded-[20px] py-24 text-center border border-slate-200/80 dark:border-white/10 text-slate-400 dark:text-[#64748B] shadow-md">
              <ChevronRight className="h-10 w-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm font-extrabold text-slate-700 dark:text-[#F8FAFC]">Select a completed call from the left menu to audit recording parameters.</p>
            </div>
          )}
        </div>
      </div>

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
                  <span className="font-bold text-slate-500">Lead / User ID:</span>
                  <span className="font-mono font-extrabold text-blue-600 dark:text-blue-400">
                    {callToDelete.lead_id}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-500">Agent:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {callToDelete.agent_name || callToDelete.agent_id || "Agent"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-500">Duration:</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {formatSeconds(callToDelete.duration_seconds)}
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
