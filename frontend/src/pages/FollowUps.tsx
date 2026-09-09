import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useFollowUps, FollowUpItem } from "../context/FollowUpContext";
import { useAuth } from "../context/AuthContext";
import CreateFollowUpModal from "../components/CreateFollowUpModal";
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertOctagon,
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
} from "lucide-react";

export default function FollowUps() {
  const { followUps, stats, loading, fetchFollowUps, fetchStats, completeFollowUp, updateFollowUp } = useFollowUps();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<"all" | "upcoming" | "due" | "completed" | "missed">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedFollowUp, setSelectedFollowUp] = useState<FollowUpItem | null>(null);
  const [rescheduleModalItem, setRescheduleModalItem] = useState<FollowUpItem | null>(null);
  const [rescheduleDateTime, setRescheduleDateTime] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [completeModalItem, setCompleteModalItem] = useState<FollowUpItem | null>(null);
  const [completionNotes, setCompletionNotes] = useState("");

  useEffect(() => {
    fetchFollowUps(activeTab, searchTerm);
  }, [activeTab, fetchFollowUps]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchFollowUps(activeTab, searchTerm);
  };

  const handleDial = (fu: FollowUpItem) => {
    const rawPhone = fu.customer_phone.replace(/\D/g, "");
    navigate(`/dialer?phone=${rawPhone}&leadId=${fu.customer_id || fu.lead_id || ""}&name=${encodeURIComponent(fu.customer_name)}`);
  };

  const handleSaveReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescheduleModalItem || !rescheduleDateTime) return;
    await updateFollowUp(rescheduleModalItem.id, {
      follow_up_datetime: rescheduleDateTime,
      reschedule_reason: rescheduleReason || "Agent Rescheduled",
    });
    setRescheduleModalItem(null);
    setRescheduleDateTime("");
    setRescheduleReason("");
  };

  const handleSaveCompletion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completeModalItem) return;
    await completeFollowUp(completeModalItem.id, undefined, "completed", completionNotes);
    setCompleteModalItem(null);
    setCompletionNotes("");
  };

  const formatDisplayDateTime = (dtStr: string) => {
    if (!dtStr) return "Not set";
    try {
      const d = new Date(dtStr);
      return d.toLocaleString("en-IN", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return dtStr;
    }
  };

  const getRelativeTime = (dtStr: string, status: string) => {
    if (!dtStr) return "";
    try {
      const target = new Date(dtStr).getTime();
      const now = Date.now();
      const diffMins = Math.round((target - now) / (1000 * 60));

      if (status === "completed") return "Completed";
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

  const filteredItems = useMemo(() => {
    return followUps.filter((item) => {
      if (activeTab === "upcoming" && item.status !== "scheduled") return false;
      if (activeTab === "due" && item.status !== "due") return false;
      if (activeTab === "completed" && item.status !== "completed") return false;
      if (activeTab === "missed" && item.status !== "missed") return false;

      if (!searchTerm) return true;
      const q = searchTerm.toLowerCase();
      return (
        item.customer_name.toLowerCase().includes(q) ||
        item.customer_phone.includes(q) ||
        item.reason.toLowerCase().includes(q) ||
        item.agent_name.toLowerCase().includes(q) ||
        item.pool_name.toLowerCase().includes(q)
      );
    });
  }, [followUps, activeTab, searchTerm]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full font-sans pb-12">
      {/* ── 1. HEADER ── */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-2xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
            <Calendar className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-slate-900 tracking-tight">BPO Follow-Up Reminders</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                Scheduled Queue
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Automated reminder engine • Real-time status sync • Timezone: IST (UTC+05:30)
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

      {/* ── 2. 4 KPI METRIC CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Due Now */}
        <div
          onClick={() => setActiveTab("due")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer select-none ${
            activeTab === "due"
              ? "bg-amber-500/10 border-amber-400 ring-2 ring-amber-400 shadow-md"
              : "bg-white border-slate-200/80 hover:border-amber-300 hover:shadow-xs"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-amber-700">Due Now</span>
            <div className="h-8 w-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Clock className="h-4 w-4 animate-spin" style={{ animationDuration: "8s" }} />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-amber-900 mt-2 flex items-baseline gap-2">
            {stats.due_now || 0}
            {stats.due_now > 0 && (
              <span className="text-[11px] font-bold text-amber-700 flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" /> Action Needed
              </span>
            )}
          </div>
          <p className="text-[11px] text-amber-600/90 font-medium mt-1">Scheduled callbacks ready to dial</p>
        </div>

        {/* Upcoming */}
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
          <p className="text-[11px] text-blue-600/90 font-medium mt-1">Scheduled for future timestamps</p>
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
          <p className="text-[11px] text-emerald-600/90 font-medium mt-1">Follow-ups successfully finished</p>
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
            <span className="text-xs font-black uppercase tracking-wider text-rose-700">Missed Follow-Ups</span>
            <div className="h-8 w-8 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
              <AlertOctagon className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-rose-900 mt-2">{stats.missed || 0}</div>
          <p className="text-[11px] text-rose-600/90 font-medium mt-1">Passed grace period without call</p>
        </div>
      </div>

      {/* ── 3. SEARCH & TAB BAR ── */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto">
          {(
            [
              { id: "all", label: "All Items", count: stats.total },
              { id: "due", label: "Due Now", count: stats.due_now },
              { id: "upcoming", label: "Upcoming", count: stats.upcoming },
              { id: "completed", label: "Completed", count: stats.completed },
              { id: "missed", label: "Missed", count: stats.missed },
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

      {/* ── 4. FOLLOW-UPS DATA TABLE ── */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-black uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-3.5 px-4">Customer / Contact</th>
                <th className="py-3.5 px-4">Agent & Pool</th>
                <th className="py-3.5 px-4">Scheduled Time</th>
                <th className="py-3.5 px-4">Reason & Notes</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Related Call</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filteredItems.map((item) => {
                const relativeLabel = getRelativeTime(item.follow_up_datetime, item.status);
                const isDue = item.status === "due";
                const isMissed = item.status === "missed";
                const isCompleted = item.status === "completed";

                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50/80 transition ${
                      isDue ? "bg-amber-50/30" : isMissed ? "bg-rose-50/20" : ""
                    }`}
                  >
                    {/* Customer */}
                    <td className="py-3.5 px-4">
                      <div className="font-extrabold text-slate-900 text-xs">{item.customer_name}</div>
                      <div className="font-mono text-[11px] font-bold text-slate-500 mt-0.5">{item.customer_phone}</div>
                      {item.customer_id && (
                        <div className="text-[10px] text-slate-400 font-mono">ID: {item.customer_id.slice(-8)}</div>
                      )}
                    </td>

                    {/* Agent & Pool */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-800 flex items-center gap-1.5">
                        <User className="h-3 w-3 text-slate-400" />
                        <span>{item.agent_name}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 font-medium flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                        <span>{item.pool_name}</span>
                      </div>
                    </td>

                    {/* Scheduled Time */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 font-mono text-xs">
                        {formatDisplayDateTime(item.follow_up_datetime)}
                      </div>
                      <span
                        className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 ${
                          isDue
                            ? "bg-amber-100 text-amber-800 border border-amber-300 animate-pulse"
                            : isMissed
                            ? "bg-rose-100 text-rose-800 border border-rose-300"
                            : isCompleted
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {relativeLabel}
                      </span>
                    </td>

                    {/* Reason */}
                    <td className="py-3.5 px-4 max-w-xs">
                      <div className="font-bold text-slate-900 truncate">{item.reason}</div>
                      {item.notes && <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{item.notes}</p>}
                    </td>

                    {/* Status Badge */}
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-black uppercase tracking-wider ${
                          isDue
                            ? "bg-amber-50 text-amber-700 border border-amber-300"
                            : isMissed
                            ? "bg-rose-50 text-rose-700 border border-rose-300"
                            : isCompleted
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-300"
                            : "bg-blue-50 text-blue-700 border border-blue-300"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isDue
                              ? "bg-amber-500 animate-ping"
                              : isMissed
                              ? "bg-rose-500"
                              : isCompleted
                              ? "bg-emerald-500"
                              : "bg-blue-500"
                          }`}
                        />
                        {item.status.replace("_", " ")}
                      </span>
                    </td>

                    {/* Related Call */}
                    <td className="py-3.5 px-4">
                      {item.related_call_id ? (
                        <div className="space-y-0.5">
                          <span className="font-mono text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                            Call #{item.related_call_id.slice(-6).toUpperCase()}
                          </span>
                          {item.completion_outcome && (
                            <div className="text-[10.5px] font-bold text-slate-600 uppercase">
                              Outcome: {item.completion_outcome}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px] italic">No call linked</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {!isCompleted && (
                          <button
                            onClick={() => handleDial(item)}
                            className="h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 transition active:scale-95 shadow-2xs cursor-pointer"
                            title="Dial Customer"
                          >
                            <Phone className="h-3 w-3" />
                            <span>Dial</span>
                          </button>
                        )}

                        {!isCompleted && (
                          <button
                            onClick={() => {
                              setRescheduleModalItem(item);
                              setRescheduleDateTime(item.follow_up_datetime.slice(0, 16));
                            }}
                            className="h-8 px-2.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-xs transition active:scale-95 cursor-pointer"
                            title="Reschedule Follow-Up"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}

                        {!isCompleted && (
                          <button
                            onClick={() => setCompleteModalItem(item)}
                            className="h-8 px-2.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-xs transition active:scale-95 cursor-pointer"
                            title="Mark Completed"
                          >
                            <Check className="h-3 w-3" />
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

      {/* ── CREATE MODAL ── */}
      <CreateFollowUpModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => fetchFollowUps(activeTab, searchTerm)}
      />

      {/* ── RESCHEDULE MODAL ── */}
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
                <label className="block font-bold text-slate-700 mb-1">New Date & Time *</label>
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

      {/* ── COMPLETE MODAL ── */}
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
    </div>
  );
}
