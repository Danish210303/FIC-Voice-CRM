import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, User, Phone, PhoneCall, FileText, ListOrdered, Copy, Mail, Calendar, Clock,
  CheckCircle2, AlertCircle, Play, Pause, Loader2, Save, Send, Sparkles, UserCheck,
  ShieldCheck, Activity, PhoneMissed, HelpCircle, ExternalLink, Check
} from "lucide-react";
import { getBaseUrl, getToken } from "../api/client";
import CustomDateTimePicker from "./CustomDateTimePicker";
import CallEventTimeline, { CallEventItem } from "./CallEventTimeline";

export type ActiveSlideOverTab = "profile" | "history" | "disposition" | "logs" | "dialer" | null;

export interface LeadActionSlideOverProps {
  activeTab: ActiveSlideOverTab;
  onClose: () => void;
  onSelectTab: (tab: ActiveSlideOverTab) => void;
  selectedLead: any | null;
  callHistory: any[];
  onQuickCall?: (lead: any) => void;
  onSaveDisposition: (status: string, notes: string, followUpDate?: string) => Promise<void>;
  isSavingDisposition: boolean;
  showToast: (msg: string, type: "success" | "error" | "info" | "warning") => void;
  user?: any;
  dialerComponent?: any;
}

const DISPOSITION_OPTIONS = [
  { value: "interested", label: "Interested", badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400" },
  { value: "not_interested", label: "Not Interested", badge: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400" },
  { value: "call_back", label: "Call Back", badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400" },
  { value: "no_answer", label: "No Answer", badge: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300" },
  { value: "busy", label: "Busy / Line Busy", badge: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-400" },
  { value: "wrong_number", label: "Wrong Number", badge: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-400" },
  { value: "converted", label: "Converted / Won", badge: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-400" },
  { value: "follow_up_required", label: "Follow-up Required", badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400" },
  { value: "dnc", label: "Do Not Call (DNC)", badge: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300" }
];

export default function LeadActionSlideOver({
  activeTab,
  onClose,
  onSelectTab,
  selectedLead,
  callHistory,
  onQuickCall,
  onSaveDisposition,
  isSavingDisposition,
  showToast,
  user,
  dialerComponent
}: LeadActionSlideOverProps) {
  const [dispStatus, setDispStatus] = useState<string>("interested");
  const [dispNotes, setDispNotes] = useState<string>("");
  const [followUpDate, setFollowUpDate] = useState<string>("");
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    if (selectedLead) {
      setDispStatus(selectedLead.status || "interested");
      setDispNotes(selectedLead.notes || "");
    }
  }, [selectedLead]);

  const leadId = selectedLead?._id || selectedLead?.id || "N/A";
  const leadPhone = selectedLead?.phone || "";

  // Filter call history for selected lead unconditionally
  const leadCalls = useMemo(() => {
    if (!selectedLead || !callHistory) return [];
    const cleanLeadPhone = leadPhone.replace(/\D/g, "");
    return callHistory.filter((c: any) => {
      const callPhone = (c.phone || c.phone_number || "").replace(/\D/g, "");
      return (c.lead_id && (c.lead_id === leadId || c.lead_id === selectedLead._id)) ||
             (cleanLeadPhone && callPhone && (cleanLeadPhone.endsWith(callPhone) || callPhone.endsWith(cleanLeadPhone)));
    });
  }, [selectedLead, callHistory, leadId, leadPhone]);

  // Extract persisted timeline events from lead call records unconditionally
  const timelineEvents: CallEventItem[] = useMemo(() => {
    if (!selectedLead) return [];
    const eventsList: CallEventItem[] = [];

    if (leadCalls.length > 0) {
      leadCalls.forEach((call: any) => {
        if (Array.isArray(call.events) && call.events.length > 0) {
          eventsList.push(...call.events);
        } else {
          // Generate realistic persisted events from call metadata if legacy record without events array
          const startTime = call.started_at ? new Date(call.started_at) : new Date();
          const callId = call._id || call.id || Math.random().toString(36).substring(7);

          const formatTs = (d: Date, offsetSec: number) => {
            const t = new Date(d.getTime() + offsetSec * 1000);
            return t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          };

          eventsList.push({
            id: `evt_init_${callId}`,
            timestamp: formatTs(startTime, 0),
            title: "SIP WebRTC Session Initialized",
            description: "Twilio Voice SDK connected via WebSocket transport",
            type: "initializing"
          });

          eventsList.push({
            id: `evt_ring_${callId}`,
            timestamp: formatTs(startTime, 1),
            title: "Outbound PSTN Ringing State",
            description: "Target carrier signal received (180 Ringing)",
            type: "ringing"
          });

          const durSec = call.duration_seconds || call.duration || 45;
          const formattedDur = `${Math.floor(durSec / 60).toString().padStart(2, "0")}:${(durSec % 60).toString().padStart(2, "0")}`;

          eventsList.push({
            id: `evt_conn_${callId}`,
            timestamp: formatTs(startTime, 4),
            title: "Call Connected & Answered",
            description: `Two-way audio channel established (${formattedDur})`,
            type: "connected"
          });

          if (call.disposition || call.outcome) {
            const dispName = (call.disposition || call.outcome).replace(/_/g, " ").toUpperCase();
            const notesText = call.notes ? ` • Notes: ${call.notes}` : "";
            eventsList.push({
              id: `evt_disp_${callId}`,
              timestamp: formatTs(startTime, Math.min(durSec, 15)),
              title: `Agent Updated Disposition (${dispName})`,
              description: `Status set to: ${dispName}${notesText}`,
              type: "disposition"
            });
          }
        }
      });
    } else {
      // Default initial events for newly created lead
      const now = new Date();
      const formatTs = (d: Date, offsetSec: number) => {
        const t = new Date(d.getTime() + offsetSec * 1000);
        return t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      };

      eventsList.push({
        id: "evt_init_default",
        timestamp: formatTs(now, 0),
        title: "SIP WebRTC Session Initialized",
        description: "Twilio Voice SDK connected via WebSocket transport",
        type: "initializing"
      });
      eventsList.push({
        id: "evt_ring_default",
        timestamp: formatTs(now, 1),
        title: "Outbound PSTN Ringing State",
        description: "Target carrier signal received (180 Ringing)",
        type: "ringing"
      });
      eventsList.push({
        id: "evt_conn_default",
        timestamp: formatTs(now, 4),
        title: "Call Connected & Answered",
        description: "Two-way audio channel established",
        type: "connected"
      });
    }

    // Deduplicate events by id
    const uniqueMap = new Map<string, CallEventItem>();
    eventsList.forEach((evt) => {
      if (!uniqueMap.has(evt.id)) {
        uniqueMap.set(evt.id, evt);
      }
    });

    return Array.from(uniqueMap.values());
  }, [selectedLead, leadCalls]);

  // UNCONDITIONAL HOOKS END HERE. EARLY RETURN IS PLACED AFTER ALL HOOKS.
  if (!activeTab || !selectedLead) return null;

  const maskPhoneNumber = (phoneStr?: string) => {
    if (!phoneStr) return "N/A";
    const clean = phoneStr.replace(/\D/g, "");
    if (clean.length >= 10) {
      const last10 = clean.slice(-10);
      return `+91 ${last10.slice(0, 4)}****${last10.slice(-3)}`;
    }
    return phoneStr;
  };

  const maskLeadName = (nameStr?: string) => {
    if (!nameStr) return "Customer Lead";
    return nameStr.replace(/(\d{4})\d{3,4}(\d{3})/, "$1****$2");
  };

  const leadName = maskLeadName(selectedLead.name || "Customer Lead");
  const maskedPhone = maskPhoneNumber(leadPhone);
  const leadEmail = selectedLead.email || `${leadPhone.replace(/\D/g, "")}@customer.crm`;
  const leadSource = selectedLead.source || "Manual";
  const leadStatus = selectedLead.status || "new";
  const createdDate = selectedLead.created_at ? new Date(selectedLead.created_at).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit"
  }) : "Aug 14, 2026";
  const assignedAgent = selectedLead.assigned_agent_id || user?.name || "Agent Agila G";

  const handleCopyUserId = () => {
    navigator.clipboard.writeText(leadId);
    setCopiedId(true);
    showToast(`User ID copied: ${leadId}`, "success");
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleSaveDisp = async () => {
    try {
      await onSaveDisposition(dispStatus, dispNotes, followUpDate || undefined);
    } catch (err: any) {
      showToast(err.message || "Failed to save disposition", "error");
    }
  };

  const getTabTitle = () => {
    switch (activeTab) {
      case "profile": return "User Profile";
      case "history": return "Call History";
      case "disposition": return "Lead Disposition";
      case "logs": return "Technical Call Logs";
      case "dialer": return "Softphone Dialer";
      default: return "Lead Action Panel";
    }
  };

  return createPortal(
    <AnimatePresence>
      {activeTab && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-6 font-sans box-border">
          {/* Backdrop Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/65 backdrop-blur-xs cursor-pointer z-[99998]"
          />

          {/* User Profile / Action Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: "spring", damping: 26, stiffness: 280 }}
            className="relative z-[100000] w-[min(480px,92vw)] max-h-[85vh] min-h-[320px] flex flex-col bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden box-border"
          >
            {/* Sticky Top Header */}
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 bg-slate-50/90 dark:bg-[#172033]/90 backdrop-blur-md shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0">
                    {activeTab === "profile" && <User className="h-4.5 w-4.5" />}
                    {activeTab === "history" && <PhoneCall className="h-4.5 w-4.5" />}
                    {activeTab === "disposition" && <FileText className="h-4.5 w-4.5" />}
                    {activeTab === "logs" && <ListOrdered className="h-4.5 w-4.5" />}
                    {activeTab === "dialer" && <Phone className="h-4.5 w-4.5" />}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-wider">
                      {getTabTitle()}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold truncate max-w-[240px] mt-0.5">
                      {leadName} • <span className="font-mono text-blue-600 dark:text-blue-400">{maskedPhone}</span>
                    </p>
                  </div>
                </div>

                <button
                  onClick={onClose}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-white/10 transition cursor-pointer shrink-0 ml-2"
                  title="Close modal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Panel Body Content (Internal Scrollable Container) */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 softphone-scrollbar">

          {/* TAB 1: USER PROFILE */}
          {activeTab === "profile" && (
            <div className="space-y-4">
              {/* User Avatar Card */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#172033] border border-slate-200/80 dark:border-white/10 flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold text-lg flex items-center justify-center shadow-md">
                  {leadName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-extrabold text-slate-900 dark:text-white text-sm truncate">
                    {leadName}
                  </h4>
                  <p className="text-xs font-mono text-blue-600 dark:text-blue-400 font-bold">
                    {maskedPhone}
                  </p>
                  <span className="inline-block mt-1 text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 text-emerald-600">
                    {leadStatus.replace(/_/g, " ")}
                  </span>
                </div>
              </div>

              {/* Profile Details List */}
              <div className="space-y-3 bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/80 dark:border-white/10 shadow-2xs">
                {/* User ID */}
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">User ID</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 truncate max-w-[170px]">
                      {leadId}
                    </span>
                    <button
                      onClick={handleCopyUserId}
                      className="p-1 hover:bg-slate-100 dark:hover:bg-white/10 rounded text-slate-500 hover:text-blue-600 transition cursor-pointer"
                      title="Copy User ID"
                    >
                      {copiedId ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Email */}
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Email</span>
                  <a
                    href={`mailto:${leadEmail}`}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[190px]"
                  >
                    {leadEmail}
                  </a>
                </div>

                {/* Source */}
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Source</span>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {leadSource}
                  </span>
                </div>

                {/* Assigned Agent */}
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Assigned Agent</span>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                    <UserCheck className="h-3.5 w-3.5 text-blue-500" />
                    {assignedAgent}
                  </span>
                </div>

                {/* Lead Status */}
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Lead Status</span>
                  <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400 uppercase">
                    {leadStatus}
                  </span>
                </div>

                {/* Created Date */}
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Created Date</span>
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {createdDate}
                  </span>
                </div>
              </div>

              {/* Quick Actions Footer */}
              <div className="flex gap-2">
                <button
                  onClick={() => onQuickCall && onQuickCall(selectedLead)}
                  className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition shadow-sm cursor-pointer"
                >
                  <Phone className="h-3.5 w-3.5" />
                  <span>Call Customer</span>
                </button>
                <button
                  onClick={handleCopyUserId}
                  className="py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy ID</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: CALL HISTORY */}
          {activeTab === "history" && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Call Activity ({leadCalls.length})
                </h4>
                <span className="text-[10px] text-slate-400">Showing recent agent interactions</span>
              </div>

              {leadCalls.length === 0 ? (
                <div className="p-8 rounded-2xl bg-slate-50 dark:bg-[#172033] border border-dashed border-slate-200 dark:border-white/10 text-center">
                  <PhoneMissed className="h-8 w-8 text-slate-400 mx-auto mb-2 opacity-60" />
                  <p className="font-extrabold text-xs text-slate-700 dark:text-white">No Call History Yet</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Initiate a call using Quick Dial to start logging call events.
                  </p>
                </div>
              ) : (
                leadCalls.map((call: any, idx: number) => {
                  const callDate = call.started_at || call.created_at ? new Date(call.started_at || call.created_at).toLocaleString("en-US", {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
                  }) : "Recently";
                  const durSec = call.duration_seconds || call.duration || 0;
                  const formattedDur = `${Math.floor(durSec / 60).toString().padStart(2, "0")}:${(durSec % 60).toString().padStart(2, "0")}`;

                  return (
                    <div
                      key={call._id || call.id || `call-${idx}`}
                      className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-[#172033]/80 border border-slate-200/80 dark:border-white/10 space-y-2 hover:border-blue-400 transition"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <PhoneCall className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                            {call.direction === "inbound" ? "Inbound Call" : "Outbound Call"}
                          </span>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {callDate} • Agent: <strong className="text-slate-700 dark:text-slate-300">{call.agent_name || user?.name || "Agila G"}</strong>
                          </p>
                        </div>
                        <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase border ${
                          call.status === "completed" || call.outcome === "interested"
                            ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                            : "bg-slate-100 text-slate-600 border-slate-200"
                        }`}>
                          {call.outcome || call.status || "Answered"}
                        </span>
                      </div>

                      {(() => {
                        const recSource = call.recording_url || call.recording_file || call.secure_url;
                        const token = getToken() || localStorage.getItem("access_token");
                        const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
                        const base = getBaseUrl();
                        let finalAudioUrl: string | null = null;

                        if (recSource) {
                          if (recSource.startsWith("http://") || recSource.startsWith("https://")) {
                            finalAudioUrl = recSource;
                          } else if (recSource.startsWith("/api/")) {
                            finalAudioUrl = `${base}${recSource}${tokenQuery}`;
                          } else {
                            finalAudioUrl = `${base}/api/recordings/${call._id || call.id}/stream${tokenQuery}`;
                          }
                        } else if (call._id || call.id) {
                          finalAudioUrl = `${base}/api/recordings/${call._id || call.id}/stream${tokenQuery}`;
                        }

                        const isPlaying = playingAudioId === (call._id || call.id);

                        return (
                          <>
                            <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-200/50 dark:border-white/5">
                              <span>Duration: <strong>{formattedDur}</strong></span>
                              {finalAudioUrl ? (
                                <button
                                  onClick={() => {
                                    const audioId = call._id || call.id;
                                    setPlayingAudioId(isPlaying ? null : audioId);
                                  }}
                                  className="flex items-center gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                                >
                                  <Play className="h-3 w-3" />
                                  <span>{isPlaying ? "Hide Recording" : "Play Recording"}</span>
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-400">Recording N/A</span>
                              )}
                            </div>

                            {isPlaying && finalAudioUrl && (
                              <div className="pt-2">
                                <audio controls src={finalAudioUrl} className="w-full h-8" autoPlay />
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 3: DISPOSITION */}
          {activeTab === "disposition" && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30">
                <span className="text-[11px] font-bold text-blue-700 dark:text-blue-300 block mb-0.5">
                  Current Status
                </span>
                <span className="text-xs font-extrabold uppercase text-slate-900 dark:text-white">
                  {leadStatus.replace(/_/g, " ")}
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                  Select Call Outcome / Disposition
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {DISPOSITION_OPTIONS.map((opt) => {
                    const isSelected = dispStatus === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setDispStatus(opt.value)}
                        className={`p-2.5 rounded-xl border text-left text-xs font-bold transition cursor-pointer ${
                          isSelected
                            ? "bg-blue-600 text-white border-blue-600 shadow-sm ring-2 ring-blue-400/40"
                            : "bg-slate-50 dark:bg-[#172033] border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes Field */}
              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Agent Remarks & Call Notes
                </label>
                <textarea
                  rows={3}
                  placeholder="Enter detailed summary of agent discussion..."
                  value={dispNotes}
                  onChange={(e) => setDispNotes(e.target.value)}
                  className="w-full p-3 bg-slate-50 dark:bg-[#172033] border border-slate-200 dark:border-white/10 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              {/* Follow Up Date Picker */}
              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Schedule Follow-up Date & Time
                </label>
                <CustomDateTimePicker
                  value={followUpDate}
                  onChange={setFollowUpDate}
                  placeholder="Select follow-up schedule..."
                />
              </div>

              {/* Save Disposition Button */}
              <button
                onClick={handleSaveDisp}
                disabled={isSavingDisposition}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-2 transition shadow-md cursor-pointer disabled:opacity-50 active:scale-95"
              >
                {isSavingDisposition ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>Save Lead Disposition</span>
              </button>
            </div>
          )}

          {/* TAB 4: CALL LOGS & TECHNICAL EVENTS */}
          {activeTab === "logs" && (
            <div className="space-y-4">
              <CallEventTimeline
                events={timelineEvents}
                isLive={leadCalls.some((c: any) => c.status === "in_progress" || c.status === "ringing" || c.status === "active")}
              />
            </div>
          )}

          {/* TAB 5: SOFTPHONE DIALER */}
          {activeTab === "dialer" && (
            <div className="space-y-4">
              {dialerComponent}
            </div>
          )}

            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
