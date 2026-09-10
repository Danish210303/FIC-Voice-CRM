import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { CustomSelect } from "./CustomSelect";
import CustomDateTimePicker from "./CustomDateTimePicker";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Phone, PhoneCall, PhoneIncoming, PhoneOutgoing, MessageSquare, Mail, User, Users, MapPin, Clock,
  Sparkles, CheckCircle2, AlertCircle, Send, Activity, ChevronDown, ChevronUp,
  Edit3, ExternalLink, Loader2, Save, Play, Pause, Download, Volume2, RotateCcw, RotateCw,
  Trash2, Building2, Tag, Copy, Check, Radio, FileText, ArrowRight, ArrowUpRight,
  Shield, Headphones, Timer, Layers
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
  transfers_count?: number;
  first_call_at?: string | null;
  last_call_at?: string | null;
};

export type LeadDrawerData = {
  id: string; lead_id?: string; name: string; phone: string; email?: string;
  location?: string; status: string; pool_id?: string; assigned_agent_id?: string;
  priority?: "urgent" | "high" | "medium" | "low"; ai_score?: number;
  last_contact_at?: string; created_at?: string; notes?: string; intent?: string;
  suggestions?: string[];
  history?: { timestamp: string; action: string; actor: string; notes?: string }[];
};

interface LeadDetailsDrawerProps {
  lead: any; onClose: () => void;
  onUpdateDisposition: (leadId: string, status: string, notes: string, followUpDate?: string) => Promise<void>;
  users?: { id: string; name: string; employee_id?: string }[];
  pools?: { id: string; name: string }[];
  onCall?: (lead: any) => void;
  showToast: (msg: string, type: "success" | "error" | "info" | "warning") => void;
}

const TEMPLATES = [
  { id: "intro", label: "Welcome & Intro", text: "Hello {name}, following up on your inquiry with Forge CRM. How can we assist you today?" },
  { id: "demo", label: "Schedule Demo", text: "Hi {name}, would you like to schedule a 15-minute live product demo of our AI Voice CRM?" },
  { id: "offer", label: "Special Plan Offer", text: "Hi {name}, we have an exclusive tier plan offer available for your team. Let us connect!" }
];

const DISPOSITION_STATUS_OPTIONS = [
  { value: "new", label: "New Lead" },
  { value: "in_progress", label: "In Progress" },
  { value: "follow_up", label: "Follow-up Needed" },
  { value: "call_back", label: "Call Back" },
  { value: "follow_up_required", label: "Follow-up Required" },
  { value: "qualified", label: "Qualified" },
  { value: "interested", label: "Interested" },
  { value: "not_interested", label: "Not Interested" },
  { value: "converted", label: "Converted / Won" },
  { value: "closed", label: "Closed / Won" }
];

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

export default function LeadDetailsDrawer({ lead, onClose, onUpdateDisposition, users = [], pools = [], onCall, showToast }: LeadDetailsDrawerProps) {
  const { user } = useAuth();
  const canDelete =
    user?.role === "admin" ||
    user?.role === "team_leader" ||
    user?.role === "supervisor" ||
    String(user?.role || "").toLowerCase().includes("admin") ||
    String(user?.role || "").toLowerCase().includes("supervisor") ||
    String(user?.role || "").toLowerCase().includes("leader");

  const [activeTab, setActiveTab] = useState<"overview" | "disposition" | "timeline">("overview");
  const [status, setStatus] = useState(lead?.status || "new");
  const [notes, setNotes] = useState(lead?.notes || "");
  const [followUpDate, setFollowUpDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notesError, setNotesError] = useState("");
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [waMessage, setWaMessage] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("intro");
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [customEmail, setCustomEmail] = useState(lead?.email || "");
  const [emailSubject, setEmailSubject] = useState("Follow up from Forge CRM");
  const [emailBody, setEmailBody] = useState(`Hi ${lead?.name || "Customer"},\n\nFollowing up regarding your lead inquiry with Forge CRM.\n\nBest regards,\nForge Team`);
  const [historyList, setHistoryList] = useState<any[]>([]);

  // ── BPO INTERACTION & CALL JOURNEY STATE ──
  const [bpoSummary, setBpoSummary] = useState<UserCallSummary | null>(null);
  const [callHistory, setCallHistory] = useState<UserCallItem[]>([]);
  const [activeLiveCall, setActiveLiveCall] = useState<UserCallItem | null>(null);
  const [liveDurationSeconds, setLiveDurationSeconds] = useState<number>(0);
  const [loadingBpo, setLoadingBpo] = useState<boolean>(false);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [callToDelete, setCallToDelete] = useState<UserCallItem | null>(null);
  const [isDeletingCall, setIsDeletingCall] = useState<boolean>(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [showLiveTranscript, setShowLiveTranscript] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const liveTimerRef = useRef<any>(null);

  // Helper to format seconds
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

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    showToast(`Copied ${label} to clipboard`, "success");
    setTimeout(() => setCopiedText(null), 2000);
  };

  // ── Fetch BPO Call History and Live Interaction ──
  const fetchLeadBpoData = useCallback(async (isSilent = false) => {
    if (!lead) return;
    const lookupKey = lead.id || lead._id || lead.lead_id || lead.phone;
    if (!lookupKey) return;

    if (!isSilent) setLoadingBpo(true);
    try {
      const res = await api.get(`/api/calls/user-history/${encodeURIComponent(lookupKey)}`);
      if (res && res.status === "success") {
        setBpoSummary(res.summary);
        const callsList: UserCallItem[] = res.calls || [];
        setCallHistory(callsList);

        // Check for an actively running call
        const active = callsList.find(c =>
          ["ringing", "in-progress", "connected", "on_hold", "calling", "transferred", "active"].includes(
            String(c.status || "").toLowerCase()
          )
        );

        if (active) {
          setActiveLiveCall(active);
          const startMs = active.started_at ? new Date(active.started_at).getTime() : Date.now();
          const diffSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
          setLiveDurationSeconds(diffSec);
        } else {
          setActiveLiveCall(null);
        }
      }
    } catch (err) {
      console.warn("[LEAD_BPO] Error loading BPO interaction data:", err);
    } finally {
      if (!isSilent) setLoadingBpo(false);
    }
  }, [lead]);

  // Initial load
  useEffect(() => {
    if (lead) {
      setStatus(lead.status || "new");
      setNotes(lead.notes || "");
      setCustomEmail(lead.email || "");
      setNotesError("");
      setWaMessage(TEMPLATES[0].text.replace("{name}", lead.name || "Customer"));
      const initialHistory = Array.isArray(lead.history) && lead.history.length > 0
        ? lead.history
        : [
            {
              timestamp: lead.created_at || new Date().toISOString(),
              action: "Created in CRM",
              actor: "System Automation",
              notes: `Source: ${lead.source || "Manual Dialer"}`
            }
          ];
      setHistoryList([...initialHistory]);
      fetchLeadBpoData(false);
    }
  }, [lead, fetchLeadBpoData]);

  // Active call live ticking timer
  useEffect(() => {
    if (activeLiveCall) {
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
      liveTimerRef.current = setInterval(() => {
        setLiveDurationSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (liveTimerRef.current) {
        clearInterval(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    }
    return () => {
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    };
  }, [activeLiveCall]);

  // Real-time WebSocket timeline & call update listener
  useEffect(() => {
    const handleActivityEvent = (evt: CustomEvent) => {
      const data = evt.detail;
      if (!data || !lead) return;
      const currentLeadId = lead.id || lead._id || lead.lead_id;
      const isTarget = data.lead_id === currentLeadId || data.lead_code === currentLeadId || (Array.isArray(data.lead_ids) && data.lead_ids.includes(currentLeadId));

      if (isTarget && data.history_entry) {
        setHistoryList((prev) => {
          const exists = prev.some(
            item => item.timestamp === data.history_entry.timestamp && item.action === data.history_entry.action
          );
          if (exists) return prev;
          return [data.history_entry, ...prev];
        });
      }
    };

    const handleWsEvent = (event: MessageEvent) => {
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (!data || !lead) return;

        const currentLeadId = String(lead.id || lead._id || lead.lead_id || "");
        const currentPhone = (lead.phone || "").replace(/\D/g, "");
        const eventLeadId = String(data.lead_id || data.user_id || data.customer_id || "");
        const eventPhone = String(data.phone || "").replace(/\D/g, "");

        const isMatch =
          eventLeadId === currentLeadId ||
          (currentPhone && eventPhone && (eventPhone.includes(currentPhone) || currentPhone.includes(eventPhone)));

        if (isMatch) {
          fetchLeadBpoData(true);
        }
      } catch {
        // ignore parse error
      }
    };

    window.addEventListener("lead_activity_updated", handleActivityEvent as EventListener);
    window.addEventListener("message", handleWsEvent);
    return () => {
      window.removeEventListener("lead_activity_updated", handleActivityEvent as EventListener);
      window.removeEventListener("message", handleWsEvent);
    };
  }, [lead, fetchLeadBpoData]);

  useEffect(() => {
    document.body.classList.add("lead-modal-active");
    return () => {
      document.body.classList.remove("lead-modal-active");
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  if (!lead) return null;

  const assignedAgent = lead.assigned_agent_id ? users.find(u => u.id === lead.assigned_agent_id || u.employee_id === lead.assigned_agent_id) : undefined;
  const poolObj = pools.find(p => p.id === lead.pool_id || p.name === lead.pool_id);
  const cleanPhone = (lead.phone || "").replace(/\D/g, "");
  const aiScore = lead.ai_score || 85;

  const handleCall = () => { if (onCall) onCall(lead); window.location.href = `tel:${lead.phone}`; showToast(`Initiating call with ${lead.name}...`, "info"); };
  const handleTemplateChange = (tplId: string) => { setSelectedTemplate(tplId); const tpl = TEMPLATES.find(t => t.id === tplId); if (tpl) setWaMessage(tpl.text.replace("{name}", lead.name || "Customer")); };
  const handleSendWhatsApp = () => { const p = cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`; window.open(`https://wa.me/${p}?text=${encodeURIComponent(waMessage)}`, "_blank"); setShowWhatsAppModal(false); showToast(`Opened WhatsApp chat with ${lead.name}`, "success"); };
  const handleSendEmail = () => { const e = customEmail || lead.email; if (!e || e === "N/A") { showToast("Please specify a valid email address.", "warning"); return; } window.location.href = `mailto:${e}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`; setShowEmailModal(false); showToast(`Opening mail client for ${e}`, "info"); };

  const formatTimestamp = (ts: string) => {
    if (!ts) return "Just now";
    if (ts === "Today" || ts.includes("AM") || ts.includes("PM")) return ts;
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      return d.toLocaleString("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return ts;
    }
  };

  const handleSaveDisposition = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!notes.trim()) { setNotesError("Please enter notes before saving."); setActiveTab("disposition"); return; }
    if (notes.trim().length < 5) { setNotesError("Notes must be at least 5 characters."); setActiveTab("disposition"); return; }
    setIsSubmitting(true); setNotesError("");

    const newEntry = {
      timestamp: new Date().toISOString(),
      action: `Disposition Updated to ${status.replace(/_/g, " ").toUpperCase()}`,
      actor: `${user?.name || "User"} (${(user?.role || "agent").replace(/_/g, " ").toUpperCase()})`,
      notes: notes.trim()
    };

    try { 
      await onUpdateDisposition(lead.id || lead._id || lead.lead_id, status, notes, followUpDate || undefined);
      setHistoryList(prev => [newEntry, ...prev]);
      showToast(`Disposition updated successfully!`, "success"); 
      onClose(); 
    }
    catch (err: any) { showToast(`Failed: ${err.message || "Server error"}`, "error"); }
    finally { setIsSubmitting(false); }
  };

  // Audio Playback Handler
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
        showToast("Click play to listen to recording", "info");
      });
    }
  };

  // Delete Call Handler
  const handleConfirmDeleteCall = async () => {
    if (!callToDelete) return;
    const targetCallId = callToDelete.id;
    setIsDeletingCall(true);
    try {
      try {
        await api.delete(`/api/calls/${targetCallId}`);
      } catch (err: any) {
        if (err?.status === 404 || String(err?.message || "").includes("404") || String(err?.message || "").includes("Not Found")) {
          try {
            await api.delete(`/api/recordings/${targetCallId}`);
          } catch {
            console.warn(`[DELETE] Fallback removed locally: ${targetCallId}`);
          }
        } else {
          throw err;
        }
      }

      setCallHistory(prev => prev.filter(c => c.id !== targetCallId));
      if (activeLiveCall?.id === targetCallId) setActiveLiveCall(null);
      if (expandedCallId === targetCallId) setExpandedCallId(null);
      if (playingCallId === targetCallId && audioRef.current) {
        audioRef.current.pause();
        setPlayingCallId(null);
      }

      // Adjust summary
      setBpoSummary(prev => {
        if (!prev) return prev;
        const remaining = callHistory.filter(c => c.id !== targetCallId);
        const inb = remaining.filter(c => c.direction === "inbound").length;
        const out = remaining.filter(c => c.direction === "outbound").length;
        const sec = remaining.reduce((acc, c) => acc + (c.duration_seconds || 0), 0);
        return {
          ...prev,
          total_calls: remaining.length,
          inbound_calls: inb,
          outbound_calls: out,
          total_talk_time_seconds: sec,
          total_talk_time_formatted: formatSeconds(sec)
        };
      });

      showToast("Call record deleted successfully", "success");
      setCallToDelete(null);
    } catch (err: any) {
      showToast(err?.message || "Failed to delete call record", "error");
    } finally {
      setIsDeletingCall(false);
    }
  };

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "disposition", label: "Disposition" },
    { id: "timeline", label: "Timeline" }
  ] as const;

  // Most recent interaction or active interaction
  const primaryInteraction = activeLiveCall || (callHistory.length > 0 ? callHistory[0] : null);
  const isCurrentlyLive = Boolean(activeLiveCall);

  // Transfers total
  const totalTransfers = bpoSummary?.transfers_count ?? callHistory.reduce((acc, c) => acc + Math.max(0, (c.interactions?.length || 1) - 1), 0);

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[99999] flex items-center justify-center p-2 sm:p-4 font-sans overflow-hidden box-border">
        {/* Translucent Dark Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm cursor-pointer z-[99998]"
        />

        {/* Workspace Modal Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 8 }}
          transition={{ type: "spring", damping: 26, stiffness: 280 }}
          className="w-[min(980px,90vw)] h-[min(690px,84vh)] max-w-[980px] max-h-[84vh] min-h-[460px] flex flex-col bg-white dark:bg-[#0D1526] border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden relative z-[100000] box-border"
        >
          {/* Subtle Ambient Background Gradients */}
          <div className="absolute top-0 left-0 w-80 h-80 bg-[#2563EB]/5 dark:bg-[#2563EB]/10 blur-3xl rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-64 h-64 bg-[#FACC15]/5 dark:bg-[#FACC15]/8 blur-3xl rounded-full pointer-events-none translate-x-1/3 translate-y-1/3" />

          {/* 1. FIXED MODAL HEADER */}
          <div className="sticky top-0 z-20 shrink-0 bg-white/95 dark:bg-[#0D1526]/95 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800 px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Avatar with Status Indicator */}
                <div className="relative shrink-0">
                  <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#0F4FA8] via-[#1D4ED8] to-[#2563EB] text-white font-black text-xs sm:text-sm flex items-center justify-center shadow-xs border border-white dark:border-[#1E293B] select-none">
                    {lead.name?.[0]?.toUpperCase() || "L"}
                  </div>
                  {isCurrentlyLive ? (
                    <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-white dark:border-[#0D1526] shadow-[0_0_8px_rgba(16,185,129,0.9)] animate-ping" />
                  ) : (
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-white dark:border-[#0D1526] shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
                  )}
                </div>

                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white tracking-tight truncate leading-tight">
                      {maskLeadName(lead.name)}
                    </h2>
                    <span className="text-[9.5px] font-black text-[#0F4FA8] dark:text-[#FACC15] uppercase bg-amber-50 dark:bg-[#FACC15]/15 border border-amber-300/80 dark:border-[#FACC15]/30 px-2 py-0.5 rounded-full tracking-wider shadow-2xs">
                      {lead.status ? lead.status.replace(/_/g, " ").toUpperCase() : "QUALIFIED"}
                    </span>
                    {isCurrentlyLive && (
                      <span className="inline-flex items-center gap-1 text-[9.5px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500 text-white shadow-xs animate-pulse">
                        <Radio className="h-2.5 w-2.5 animate-spin" />
                        LIVE ON CALL
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-medium flex-wrap">
                    <span className="flex items-center gap-1 font-bold text-slate-800 dark:text-slate-200 text-[11.5px]">
                      <Phone className="h-3 w-3 text-[#0F4FA8] dark:text-blue-400" />
                      {maskPhoneNumber(lead.phone)}
                    </span>
                    <span className="font-mono text-[9.5px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 px-1.5 py-0.5 rounded tracking-wider">
                      {lead.lead_id || "LD295084"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-300/80 dark:border-emerald-500/30 px-2 py-0.5 rounded-full">
                      <Sparkles className="h-2.5 w-2.5 text-emerald-600" />
                      {aiScore}% AI Fit
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={onClose}
                className="h-7 w-7 flex items-center justify-center rounded-lg shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer"
                title="Close Modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 2. TABS BAR */}
          <div className="px-4 pt-2 shrink-0 bg-white dark:bg-[#0D1526]">
            <div className="h-[38px] p-0.5 rounded-lg bg-slate-100 dark:bg-[#172033] grid grid-cols-3 gap-1">
              {TABS.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`h-full rounded-md text-xs font-extrabold transition-all duration-200 ease-out cursor-pointer flex items-center justify-center active:scale-98 ${
                      isActive
                        ? "bg-gradient-to-r from-[#FACC15] to-[#EAB308] text-[#0F4FA8] font-black shadow-2xs border border-amber-300/60"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/10"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. SCROLLABLE CONTENT BODY */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-4 text-xs font-sans custom-scrollbar">

            {/* ── OVERVIEW TAB (Includes Contact Profile + Real-Time BPO Interaction Panel) ── */}
            {activeTab === "overview" && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="space-y-4"
              >
                {/* 1. Contact Profile Card */}
                <div className="bg-white dark:bg-[#131F35] rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-2xs overflow-hidden">
                  <div className="px-4.5 py-2.5 bg-slate-50 dark:bg-[#1e293b] border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-[#0F4FA8] dark:text-blue-400" />
                      <span>CONTACT PROFILE</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">
                      ID: {lead.lead_id || lead.id}
                    </span>
                  </div>

                  <div className="p-4.5 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3.5">
                    {/* Row 1: Phone, Email, Location */}
                    <div>
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                        PHONE
                      </span>
                      <span className="font-mono font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 text-[#0F4FA8] shrink-0" />
                        {maskPhoneNumber(lead.phone)}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                        EMAIL
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs truncate block">
                        {lead.email || "N/A"}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                        LOCATION
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        {lead.location || "N/A"}
                      </span>
                    </div>

                    {/* Row 2: Target Pool, Assigned Agent, Priority */}
                    <div>
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                        TARGET POOL
                      </span>
                      <span className="text-[10.5px] font-black text-[#0F4FA8] dark:text-[#FACC15] uppercase bg-blue-50 dark:bg-[#FACC15]/10 border border-blue-200/80 dark:border-[#FACC15]/25 px-2.5 py-0.5 rounded-full inline-block tracking-wider">
                        {poolObj?.name.replace(/_/g, " ") || "CUSTOMER SUPPORT"}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                        ASSIGNED AGENT
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white text-xs">
                        {assignedAgent?.name || "Sales Agent"}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                        PRIORITY
                      </span>
                      <span className={`text-[10.5px] font-black uppercase px-2.5 py-0.5 rounded-full inline-block border tracking-wider ${
                        lead.priority === "high" || lead.priority === "urgent"
                          ? "bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400"
                          : "bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300"
                      }`}>
                        {lead.priority || "MEDIUM"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. BPO SUMMARY CARDS RIBBON */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  {/* Total Calls */}
                  <div className="bg-slate-50 dark:bg-[#131F35] p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between shadow-2xs">
                    <span className="text-[9.5px] font-extrabold uppercase text-slate-500 dark:text-slate-400 flex items-center justify-between">
                      Total Calls
                      <PhoneCall className="h-3 w-3 text-blue-500" />
                    </span>
                    <div className="text-base font-black font-mono text-slate-900 dark:text-white mt-1">
                      {bpoSummary?.total_calls ?? callHistory.length}
                    </div>
                  </div>

                  {/* Inbound */}
                  <div className="bg-emerald-50/70 dark:bg-emerald-950/20 p-2.5 rounded-xl border border-emerald-200/70 dark:border-emerald-900/50 flex flex-col justify-between shadow-2xs">
                    <span className="text-[9.5px] font-extrabold uppercase text-emerald-700 dark:text-emerald-400 flex items-center justify-between">
                      Inbound
                      <PhoneIncoming className="h-3 w-3 text-emerald-600" />
                    </span>
                    <div className="text-base font-black font-mono text-emerald-700 dark:text-emerald-400 mt-1">
                      {bpoSummary?.inbound_calls ?? callHistory.filter(c => c.direction === "inbound").length}
                    </div>
                  </div>

                  {/* Outbound */}
                  <div className="bg-blue-50/70 dark:bg-blue-950/20 p-2.5 rounded-xl border border-blue-200/70 dark:border-blue-900/50 flex flex-col justify-between shadow-2xs">
                    <span className="text-[9.5px] font-extrabold uppercase text-blue-700 dark:text-blue-400 flex items-center justify-between">
                      Outbound
                      <PhoneOutgoing className="h-3 w-3 text-blue-600" />
                    </span>
                    <div className="text-base font-black font-mono text-blue-700 dark:text-blue-400 mt-1">
                      {bpoSummary?.outbound_calls ?? callHistory.filter(c => c.direction === "outbound").length}
                    </div>
                  </div>

                  {/* Total Talk Time */}
                  <div className="bg-amber-50/70 dark:bg-amber-950/20 p-2.5 rounded-xl border border-amber-200/70 dark:border-amber-900/50 flex flex-col justify-between shadow-2xs">
                    <span className="text-[9.5px] font-extrabold uppercase text-amber-800 dark:text-amber-400 flex items-center justify-between">
                      Talk Time
                      <Clock className="h-3 w-3 text-amber-600" />
                    </span>
                    <div className="text-base font-black font-mono text-amber-800 dark:text-amber-300 mt-1 truncate">
                      {bpoSummary?.total_talk_time_formatted ?? formatSeconds(callHistory.reduce((acc, c) => acc + (c.duration_seconds || 0), 0))}
                    </div>
                  </div>

                  {/* Agents Involved */}
                  <div className="bg-purple-50/70 dark:bg-purple-950/20 p-2.5 rounded-xl border border-purple-200/70 dark:border-purple-900/50 flex flex-col justify-between shadow-2xs">
                    <span className="text-[9.5px] font-extrabold uppercase text-purple-700 dark:text-purple-400 flex items-center justify-between">
                      Agents
                      <Users className="h-3 w-3 text-purple-600" />
                    </span>
                    <div className="text-base font-black font-mono text-purple-700 dark:text-purple-300 mt-1">
                      {bpoSummary?.agents_count ?? (new Set(callHistory.map(c => c.agent_id).filter(Boolean)).size || 1)}
                    </div>
                  </div>

                  {/* Pools Used */}
                  <div className="bg-indigo-50/70 dark:bg-indigo-950/20 p-2.5 rounded-xl border border-indigo-200/70 dark:border-indigo-900/50 flex flex-col justify-between shadow-2xs">
                    <span className="text-[9.5px] font-extrabold uppercase text-indigo-700 dark:text-indigo-400 flex items-center justify-between">
                      Pools
                      <Layers className="h-3 w-3 text-indigo-600" />
                    </span>
                    <div className="text-base font-black font-mono text-indigo-700 dark:text-indigo-300 mt-1">
                      {bpoSummary?.pools_count ?? (new Set(callHistory.map(c => c.pool_id).filter(Boolean)).size || 1)}
                    </div>
                  </div>

                  {/* Transfers */}
                  <div className="bg-slate-50 dark:bg-[#131F35] p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between shadow-2xs">
                    <span className="text-[9.5px] font-extrabold uppercase text-slate-600 dark:text-slate-400 flex items-center justify-between">
                      Transfers
                      <ArrowRight className="h-3 w-3 text-slate-500" />
                    </span>
                    <div className="text-base font-black font-mono text-slate-900 dark:text-white mt-1">
                      {totalTransfers}
                    </div>
                  </div>
                </div>

                {/* 3. REAL-TIME CURRENT INTERACTION PANEL */}
                <div className={`rounded-xl border transition-all duration-200 overflow-hidden shadow-2xs ${
                  isCurrentlyLive
                    ? "bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 ring-1 ring-emerald-400/30"
                    : "bg-white dark:bg-[#131F35] border-slate-200/90 dark:border-slate-800"
                }`}>
                  <div className="px-4.5 py-3 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                        isCurrentlyLive
                          ? "bg-emerald-500 text-white shadow-xs animate-pulse"
                          : "bg-blue-50 dark:bg-blue-950/50 text-[#0F4FA8] dark:text-blue-400 border border-blue-200/80"
                      }`}>
                        {isCurrentlyLive ? <Radio className="h-4 w-4" /> : <Headphones className="h-3.5 w-3.5" />}
                      </div>
                      <div>
                        <span className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-2">
                          <span>{isCurrentlyLive ? "REAL-TIME CURRENT INTERACTION" : "CURRENT / LAST INTERACTION"}</span>
                          {isCurrentlyLive && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500 text-white shadow-2xs">
                              <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                              LIVE ACTIVE CALL
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Live Duration Badge */}
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Timer className="h-3.5 w-3.5 text-blue-500" />
                        {isCurrentlyLive ? formatSeconds(liveDurationSeconds) : (primaryInteraction ? formatSeconds(primaryInteraction.duration_seconds) : "00:00")}
                      </span>
                      {primaryInteraction?.recording_url && (
                        <button
                          type="button"
                          onClick={() => handlePlayAudio(primaryInteraction)}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-200 dark:border-blue-800 flex items-center gap-1 transition cursor-pointer"
                        >
                          {playingCallId === primaryInteraction.id ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 fill-current" />}
                          <span>Audio</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {primaryInteraction ? (
                    <div className="p-4.5 space-y-3">
                      {/* Telemetry grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <span className="text-[10px] font-extrabold uppercase text-slate-400 block mb-0.5">Call Status</span>
                          <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md inline-block border ${
                            ["connected", "in-progress", "active"].includes(primaryInteraction.status?.toLowerCase())
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200"
                              : ["ringing", "calling"].includes(primaryInteraction.status?.toLowerCase())
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 animate-pulse"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200"
                          }`}>
                            {primaryInteraction.status}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] font-extrabold uppercase text-slate-400 block mb-0.5">Direction</span>
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 capitalize flex items-center gap-1">
                            {primaryInteraction.direction === "inbound" ? <PhoneIncoming className="h-3.5 w-3.5 text-emerald-600" /> : <PhoneOutgoing className="h-3.5 w-3.5 text-blue-600" />}
                            {primaryInteraction.direction}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] font-extrabold uppercase text-slate-400 block mb-0.5">Current Agent</span>
                          <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1 truncate">
                            <User className="h-3 w-3 text-purple-500 shrink-0" />
                            {primaryInteraction.agent_name || "Sales Agent"}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] font-extrabold uppercase text-slate-400 block mb-0.5">Queue / Pool</span>
                          <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1 truncate">
                            <Building2 className="h-3 w-3 text-indigo-500 shrink-0" />
                            {primaryInteraction.pool_name || "Customer Support"}
                          </span>
                        </div>
                      </div>

                      {/* Live conversation / transcript snapshot */}
                      {(primaryInteraction.transcript || primaryInteraction.transcript_list?.length) && (
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-extrabold uppercase text-slate-400 flex items-center gap-1">
                              <FileText className="h-3 w-3 text-blue-500" />
                              Conversation Transcript
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowLiveTranscript(!showLiveTranscript)}
                              className="text-[10px] font-extrabold text-[#0F4FA8] dark:text-blue-400 hover:underline cursor-pointer"
                            >
                              {showLiveTranscript ? "Hide Transcript" : "View Dialogue"}
                            </button>
                          </div>

                          {showLiveTranscript && (
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0D1526] border border-slate-200/80 dark:border-slate-800 max-h-40 overflow-y-auto font-mono text-[11px] space-y-1.5">
                              {primaryInteraction.transcript_list && primaryInteraction.transcript_list.length > 0 ? (
                                primaryInteraction.transcript_list.map((turn, tIdx) => (
                                  <div key={tIdx} className="leading-relaxed">
                                    <span className={`font-bold uppercase text-[9.5px] px-1.5 py-0.2 rounded mr-1.5 ${
                                      turn.speaker?.toLowerCase().includes("agent")
                                        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300"
                                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300"
                                    }`}>
                                      {turn.speaker}:
                                    </span>
                                    <span className="text-slate-700 dark:text-slate-300 font-sans">{turn.text}</span>
                                  </div>
                                ))
                              ) : (
                                <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-sans">
                                  {primaryInteraction.transcript}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-6 text-center text-slate-400 space-y-1">
                      <PhoneCall className="h-6 w-6 mx-auto opacity-50 text-slate-400 mb-1" />
                      <p className="font-extrabold text-xs text-slate-700 dark:text-slate-300">No Active Call Session</p>
                      <p className="text-[11px]">Click "Call" below to initiate an outbound AI or agent interaction with this customer.</p>
                    </div>
                  )}
                </div>

                {/* 4. AGENT + POOL JOURNEY (CHRONOLOGICAL MULTI-HOP VERTICAL TIMELINE) */}
                <div className="bg-white dark:bg-[#131F35] rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-2xs overflow-hidden">
                  <div className="px-4.5 py-3 bg-slate-50 dark:bg-[#1e293b] border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-[#0F4FA8] dark:text-blue-400" />
                      <span className="text-[11px] font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                        AGENT + POOL JOURNEY &amp; INTERACTION TIMELINE
                      </span>
                    </div>
                    <span className="text-[10px] font-extrabold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/15 border border-blue-200/80 dark:border-blue-500/30 px-2.5 py-0.5 rounded-full font-mono">
                      {callHistory.length} Calls Recorded
                    </span>
                  </div>

                  <div className="p-4.5 space-y-4">
                    {loadingBpo ? (
                      <div className="py-8 text-center space-y-2">
                        <Loader2 className="h-6 w-6 animate-spin text-blue-600 mx-auto" />
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Loading Customer Interaction Journey...</p>
                      </div>
                    ) : callHistory.length === 0 ? (
                      <div className="py-8 text-center text-slate-400 space-y-1.5">
                        <Clock className="h-6 w-6 mx-auto opacity-50" />
                        <p className="font-extrabold text-xs text-slate-700 dark:text-slate-300">No Call History for this Customer</p>
                        <p className="text-[11px] max-w-sm mx-auto">When calls or transfers occur for this customer, every agent and pool interaction hop will appear here.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {callHistory.map((call, idx) => {
                          const isExpanded = expandedCallId === call.id;
                          const isPlaying = playingCallId === call.id;
                          const hasTransfers = call.interactions && call.interactions.length > 1;

                          const timeFormatted = call.started_at
                            ? new Date(call.started_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                            : "Recent";

                          return (
                            <div
                              key={call.id || idx}
                              className={`rounded-xl border transition-all duration-200 overflow-hidden ${
                                isExpanded
                                  ? "bg-white dark:bg-[#0D1526] border-blue-300 dark:border-blue-500/50 shadow-sm ring-1 ring-blue-400/20"
                                  : "bg-slate-50/80 dark:bg-[#0D1526]/60 border-slate-200/80 dark:border-slate-800 hover:bg-slate-50"
                              }`}
                            >
                              {/* Call Row Header */}
                              <div
                                onClick={() => setExpandedCallId(isExpanded ? null : call.id)}
                                className="p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 cursor-pointer select-none"
                              >
                                {/* Left: Direction, Agent, Pool Journey string */}
                                <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                                  <span className="font-mono text-xs font-black text-slate-500 dark:text-slate-400">
                                    {timeFormatted}
                                  </span>

                                  <span className="text-slate-300 dark:text-slate-600">─</span>

                                  {/* Direction Badge */}
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                                    call.direction === "inbound"
                                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                      : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                                  }`}>
                                    {call.direction === "inbound" ? <PhoneIncoming className="h-2.5 w-2.5" /> : <PhoneOutgoing className="h-2.5 w-2.5" />}
                                    {call.direction}
                                  </span>

                                  <span className="text-slate-300 dark:text-slate-600">→</span>

                                  {/* Pool */}
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900 text-[10.5px] font-extrabold">
                                    <Building2 className="h-2.5 w-2.5" />
                                    {call.original_pool_name || call.pool_name}
                                  </span>

                                  <span className="text-slate-300 dark:text-slate-600">→</span>

                                  {/* Agent */}
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-white/10 text-slate-800 dark:text-slate-200 text-[10.5px] font-bold">
                                    <User className="h-2.5 w-2.5 text-purple-500" />
                                    {call.original_agent_name || call.agent_name}
                                  </span>

                                  {/* Transfer Hops Indicator */}
                                  {hasTransfers && (
                                    <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[9.5px] font-black uppercase flex items-center gap-1">
                                      <ArrowRight className="h-2.5 w-2.5" />
                                      {call.interactions.length - 1} Transfers
                                    </span>
                                  )}
                                </div>

                                {/* Right: Duration + Status + Delete Action */}
                                <div className="flex items-center gap-2.5 shrink-0 ml-auto md:ml-0">
                                  <span className="font-mono text-xs font-black text-slate-900 dark:text-white flex items-center gap-1">
                                    <Clock className="h-3 w-3 text-slate-400" />
                                    {call.duration_formatted || formatSeconds(call.duration_seconds)}
                                  </span>

                                  <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border ${
                                    call.outcome === "answered" || call.outcome === "qualified" || call.outcome === "completed"
                                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200"
                                      : call.outcome === "missed"
                                      ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border-rose-200"
                                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200"
                                  }`}>
                                    {call.outcome || call.status}
                                  </span>

                                  {canDelete && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setCallToDelete(call);
                                      }}
                                      className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                                      title="Delete Call Record"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}

                                  <button className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white">
                                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                  </button>
                                </div>
                              </div>

                              {/* Expandable Accordion: Transfer Hops, Audio Player, Transcript, Disposition */}
                              <AnimatePresence>
                                {isExpanded && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="p-4 border-t border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0D1526] space-y-4 text-xs"
                                  >
                                    {/* 1. Step-by-Step Multi-Hop Transfer Timeline */}
                                    {call.interactions && call.interactions.length > 0 && (
                                      <div className="space-y-2">
                                        <h4 className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                                          <Activity className="h-3 w-3 text-purple-500" />
                                          Transfer &amp; Routing Hops (Never Overwritten)
                                        </h4>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                          {call.interactions.map((hop, hIdx) => (
                                            <div
                                              key={hIdx}
                                              className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#131F35] border border-slate-200/80 dark:border-slate-800 space-y-1"
                                            >
                                              <div className="flex items-center justify-between">
                                                <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300">
                                                  Step {hop.step}: {hop.action}
                                                </span>
                                                <span className="text-[9px] font-mono text-slate-400">
                                                  {hop.timestamp ? new Date(hop.timestamp).toLocaleTimeString() : ""}
                                                </span>
                                              </div>
                                              <div className="text-[11px] font-bold text-slate-900 dark:text-white flex items-center gap-1">
                                                <User className="h-3 w-3 text-purple-500 shrink-0" />
                                                {hop.agent_name}
                                              </div>
                                              <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                                <Building2 className="h-3 w-3 text-indigo-500 shrink-0" />
                                                {hop.pool_name}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* 2. Recording Player */}
                                    {call.recording_url ? (
                                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#131F35] border border-slate-200/80 dark:border-slate-800 space-y-2">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] font-extrabold uppercase text-slate-600 dark:text-slate-300 flex items-center gap-1">
                                            <Volume2 className="h-3.5 w-3.5 text-blue-600" />
                                            Voice Recording Stream
                                          </span>
                                          <a
                                            href={call.recording_url}
                                            download
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-[10px] font-extrabold text-[#0F4FA8] dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                                          >
                                            <Download className="h-3 w-3" />
                                            Download Audio
                                          </a>
                                        </div>

                                        <div className="flex items-center gap-3">
                                          <button
                                            type="button"
                                            onClick={() => handlePlayAudio(call)}
                                            className="h-8 w-8 rounded-lg bg-[#0F4FA8] hover:bg-[#0B3C80] text-white flex items-center justify-center font-bold shadow-xs cursor-pointer active:scale-95 shrink-0"
                                          >
                                            {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
                                          </button>

                                          <div className="flex-1 space-y-1">
                                            <input
                                              type="range"
                                              min={0}
                                              max={isPlaying ? (audioDuration || call.duration_seconds || 100) : 100}
                                              step={0.1}
                                              value={isPlaying ? audioProgress : 0}
                                              onChange={(e) => {
                                                if (audioRef.current && isPlaying) {
                                                  audioRef.current.currentTime = Number(e.target.value);
                                                  setAudioProgress(Number(e.target.value));
                                                }
                                              }}
                                              className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[#0F4FA8]"
                                            />
                                            <div className="flex justify-between text-[10px] font-mono text-slate-500 font-bold">
                                              <span>{isPlaying ? formatSeconds(audioProgress) : "00:00"}</span>
                                              <span>{formatSeconds(call.duration_seconds)}</span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 text-[11px] text-slate-400 font-medium">
                                        No audio recording saved for this session.
                                      </div>
                                    )}

                                    {/* 3. Transcript Viewer */}
                                    {call.transcript && (
                                      <div className="space-y-1.5">
                                        <span className="text-[10px] font-extrabold uppercase text-slate-400 flex items-center gap-1">
                                          <FileText className="h-3 w-3 text-blue-500" />
                                          Speech Transcript
                                        </span>
                                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#131F35] border border-slate-200/80 dark:border-slate-800 text-[11px] leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap font-sans text-slate-800 dark:text-slate-200">
                                          {call.transcript}
                                        </div>
                                      </div>
                                    )}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── DISPOSITION TAB ── */}
            {activeTab === "disposition" && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="space-y-4"
              >
                <form onSubmit={handleSaveDisposition} className="bg-white dark:bg-[#131F35] rounded-xl p-4.5 border border-slate-200/90 dark:border-slate-800 shadow-2xs space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div className="h-7 w-7 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center">
                      <Edit3 className="h-3.5 w-3.5 text-[#0F4FA8] dark:text-blue-400" />
                    </div>
                    <span className="text-[11px] font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                      UPDATE DISPOSITION &amp; FOLLOW-UP
                    </span>
                  </div>

                  <div className="space-y-3.5">
                    <div>
                      <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">
                        Status Disposition
                      </label>
                      <CustomSelect
                        value={status}
                        onChange={setStatus}
                        options={DISPOSITION_STATUS_OPTIONS}
                        placeholder="Select Disposition"
                        triggerClassName="h-9 rounded-xl text-xs border-slate-200 dark:border-slate-700 dark:bg-[#0D1526]"
                      />
                    </div>

                    {(status === "follow_up" || status === "in_progress" || status === "call_back" || status === "follow_up_required") && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                        <CustomDateTimePicker
                          label="Follow-up Date & Time"
                          value={followUpDate}
                          onChange={setFollowUpDate}
                          placeholder="Select Follow-up Date & Time"
                        />
                      </motion.div>
                    )}

                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                            Notes / Call Summary
                          </label>
                          <span className={`text-[10px] font-mono font-bold ${notes.length > 450 ? "text-rose-500" : "text-slate-400"}`}>
                            {notes.length} / 500
                          </span>
                        </div>
                        <textarea
                          rows={3}
                          maxLength={500}
                          placeholder="Enter conversation notes or next steps..."
                          value={notes}
                          onChange={e => {
                            setNotes(e.target.value);
                            if (notesError) setNotesError("");
                          }}
                          className={`w-full bg-slate-50/80 dark:bg-[#0D1526] border rounded-xl p-3 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0F4FA8]/50 transition-all duration-200 resize-none ${
                            notesError ? "border-rose-400 dark:border-rose-500" : "border-slate-200 dark:border-slate-800"
                          }`}
                        />
                        {notesError && (
                          <p className="text-xs font-semibold text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                            {notesError}
                          </p>
                        )}
                      </div>
                    </div>
                  </form>
              </motion.div>
            )}

            {/* ── TIMELINE TAB ── */}
            {activeTab === "timeline" && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="space-y-4"
              >
                <div className="bg-white dark:bg-[#131F35] rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-2xs overflow-hidden">
                  <div className="px-4.5 py-3 bg-slate-50 dark:bg-[#1e293b] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-[#0F4FA8] dark:text-blue-400" />
                      <span className="text-[11px] font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                        ACTIVITY LOG &amp; HISTORY
                      </span>
                    </div>
                    <span className="text-[10px] font-extrabold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/15 border border-blue-200/80 dark:border-blue-500/30 px-2.5 py-0.5 rounded-full font-mono">
                      {historyList.length} Events
                    </span>
                  </div>

                  <div className="p-4.5">
                    <div className="relative pl-5 space-y-3.5 border-l-2 border-slate-200 dark:border-slate-800 ml-2">
                      {historyList.map((item: any, idx: number) => {
                        const isLatest = idx === 0;
                        return (
                          <div key={idx} className="relative group">
                            {/* Dot Icon */}
                            <div className={`absolute -left-[27px] top-2 h-3 w-3 rounded-full border-2 border-white dark:border-[#0D1526] shadow-2xs ${
                              isLatest ? "bg-[#2563EB] ring-2 ring-blue-500/40 animate-pulse" : "bg-slate-400 dark:bg-slate-600"
                            }`} />
                            <div className={`bg-slate-50/90 dark:bg-[#0D1526] border rounded-xl p-3 transition-all ${
                              isLatest ? "border-blue-300 dark:border-blue-500/40 bg-blue-50/30 dark:bg-blue-950/20" : "border-slate-200/80 dark:border-slate-800"
                            }`}>
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                                    {item.action}
                                  </span>
                                  {isLatest && (
                                    <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-blue-500 text-white tracking-widest animate-pulse">
                                      LIVE
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 shrink-0 font-mono">
                                  <Clock className="h-3 w-3 text-blue-500" />
                                  {formatTimestamp(item.timestamp)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[10.5px] font-medium text-slate-500 dark:text-slate-400 gap-2">
                                <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-semibold">
                                  <User className="h-3 w-3 text-slate-400" />
                                  {item.actor}
                                </span>
                                {item.notes && (
                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 italic truncate max-w-[280px]">
                                    "{item.notes}"
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

          </div>

          {/* 4. FIXED FOOTER BAR */}
          <div className="h-[52px] shrink-0 px-4 py-2 border-t border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0D1526] flex items-center justify-between gap-2.5 z-20 shadow-md">
            <div className="flex items-center gap-2">
              <button
                onClick={handleCall}
                title="Call Lead"
                className="h-[34px] px-3 flex items-center justify-center gap-1.5 rounded-lg text-[11.5px] font-extrabold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-600 hover:text-white transition-all cursor-pointer shadow-2xs"
              >
                <PhoneCall className="h-3.5 w-3.5 shrink-0" />
                <span>Call</span>
              </button>

              <button
                onClick={() => setShowWhatsAppModal(true)}
                title="WhatsApp"
                className="h-[34px] px-3 flex items-center justify-center gap-1.5 rounded-lg text-[11.5px] font-extrabold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-600 hover:text-white transition-all cursor-pointer shadow-2xs"
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span>WhatsApp</span>
              </button>

              <button
                onClick={() => setShowEmailModal(true)}
                title="Email"
                className="h-[34px] px-3 flex items-center justify-center gap-1.5 rounded-lg text-[11.5px] font-extrabold bg-blue-50 dark:bg-blue-950/40 text-[#0F4FA8] dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-[#0F4FA8] hover:text-white transition-all cursor-pointer shadow-2xs"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span>Email</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSaveDisposition()}
                disabled={isSubmitting}
                title="Save Disposition"
                className="h-[34px] px-4 flex items-center justify-center gap-1.5 rounded-lg text-[11.5px] font-extrabold bg-gradient-to-r from-[#0F4FA8] to-[#1D4ED8] hover:from-[#0B3C80] hover:to-[#1656B3] text-white shadow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
              >
                {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                <span>Save</span>
              </button>

              <button
                onClick={onClose}
                title="Close Modal"
                className="h-[34px] px-3.5 flex items-center justify-center gap-1.5 rounded-lg text-[11.5px] font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 transition-all cursor-pointer active:scale-95"
              >
                <X className="h-3.5 w-3.5" />
                <span>Close</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── DELETE CALL CONFIRMATION MODAL ── */}
      {callToDelete && (
        <div className="fixed inset-0 z-[100002] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 font-sans text-left">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-[#131F35] rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4 border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold shrink-0 border border-rose-100 dark:border-rose-500/20">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">Delete Call Record</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Are you sure you want to delete this call record?</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0D1526] border border-slate-200/80 dark:border-slate-800 space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-500">Direction &amp; Status:</span>
                <span className="font-extrabold capitalize text-slate-900 dark:text-white">
                  {callToDelete.direction} • {callToDelete.status}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-500">Agent:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{callToDelete.agent_name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-500">Duration:</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">{callToDelete.duration_formatted || formatSeconds(callToDelete.duration_seconds)}</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
              <span>This action cannot be undone. Only this single call record will be removed.</span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setCallToDelete(null)}
                disabled={isDeletingCall}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCall}
                disabled={isDeletingCall}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5 shadow-xs"
              >
                {isDeletingCall ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                <span>Delete Record</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* WHATSAPP MODAL */}
      {showWhatsAppModal && (
        <div className="fixed inset-0 z-[100001] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-[#131F35] rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-3.5 border border-slate-200 dark:border-slate-800">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/25 flex items-center justify-center">
                  <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-xs">Send WhatsApp Message</h3>
                  <p className="text-[10.5px] font-semibold text-slate-400">{lead.name} · {lead.phone}</p>
                </div>
              </div>
              <button onClick={() => setShowWhatsAppModal(false)} className="h-7 w-7 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/8 rounded-lg text-slate-400 cursor-pointer transition"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">Select Template</label>
                <div className="grid grid-cols-3 gap-2">
                  {TEMPLATES.map(t => (
                    <button key={t.id} type="button" onClick={() => handleTemplateChange(t.id)} className={`p-2 rounded-xl text-[10px] font-extrabold transition border cursor-pointer active:scale-95 ${selectedTemplate === t.id ? "bg-emerald-600 text-white border-emerald-600 shadow-xs" : "bg-slate-50 dark:bg-[#0D1526] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-100"}`}>{t.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">Message Preview</label>
                <textarea rows={3} value={waMessage} onChange={e => setWaMessage(e.target.value)} className="w-full bg-slate-50 dark:bg-[#0D1526] border border-slate-200 dark:border-white/10 rounded-xl p-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 font-medium resize-none" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowWhatsAppModal(false)} className="flex-1 py-2 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-xl font-extrabold text-xs transition cursor-pointer">Cancel</button>
                <button onClick={handleSendWhatsApp} className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold text-xs transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"><Send className="h-3.5 w-3.5" />Open WhatsApp</button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* EMAIL MODAL */}
      {showEmailModal && (
        <div className="fixed inset-0 z-[100001] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-[#131F35] rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-3.5 border border-slate-200 dark:border-slate-800">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 flex items-center justify-center">
                  <Mail className="h-3.5 w-3.5 text-[#0F4FA8] dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-xs">Send Email to Lead</h3>
                  <p className="text-[10.5px] font-semibold text-slate-400">{lead.name}</p>
                </div>
              </div>
              <button onClick={() => setShowEmailModal(false)} className="h-7 w-7 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/8 rounded-lg text-slate-400 cursor-pointer transition"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">Recipient Email</label>
                <input type="email" placeholder="Enter email address" value={customEmail} onChange={e => setCustomEmail(e.target.value)} className="w-full h-9 bg-slate-50 dark:bg-[#0D1526] border border-slate-200 dark:border-white/10 rounded-xl px-3 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0F4FA8]/50 transition" />
              </div>
              <div>
                <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">Subject</label>
                <input type="text" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} className="w-full h-9 bg-slate-50 dark:bg-[#0D1526] border border-slate-200 dark:border-white/10 rounded-xl px-3 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0F4FA8]/50 transition" />
              </div>
              <div>
                <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">Email Body</label>
                <textarea rows={3} value={emailBody} onChange={e => setEmailBody(e.target.value)} className="w-full bg-slate-50 dark:bg-[#0D1526] border border-slate-200 dark:border-white/10 rounded-xl p-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0F4FA8]/50 font-medium resize-none" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowEmailModal(false)} className="flex-1 py-2 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-xl font-extrabold text-xs transition cursor-pointer">Cancel</button>
                <button onClick={handleSendEmail} className="flex-1 py-2 bg-[#0F4FA8] hover:bg-[#0B3C80] text-white rounded-xl font-extrabold text-xs transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"><ExternalLink className="h-3.5 w-3.5" />Open Mail Client</button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
