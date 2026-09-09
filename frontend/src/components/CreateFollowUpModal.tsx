import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useFollowUps } from "../context/FollowUpContext";
import { useAuth } from "../context/AuthContext";
import { Calendar, Clock, X, User, Phone, Tag, AlignLeft, Shield, Sparkles, Check } from "lucide-react";

interface CreateFollowUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultLead?: {
    id?: string;
    lead_id?: string;
    name?: string;
    phone?: string;
    pool_id?: string;
  };
  onSuccess?: () => void;
}

const PRESET_OPTIONS = [
  { label: "+15 Min", getIso: () => new Date(Date.now() + 15 * 60 * 1000).toISOString() },
  { label: "+1 Hour", getIso: () => new Date(Date.now() + 60 * 60 * 1000).toISOString() },
  { label: "+3 Hours", getIso: () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() },
  {
    label: "Tomorrow 10 AM",
    getIso: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(10, 0, 0, 0);
      return d.toISOString();
    },
  },
  {
    label: "Tomorrow 3 PM",
    getIso: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(15, 0, 0, 0);
      return d.toISOString();
    },
  },
  {
    label: "In 2 Days",
    getIso: () => {
      const d = new Date();
      d.setDate(d.getDate() + 2);
      d.setHours(11, 0, 0, 0);
      return d.toISOString();
    },
  },
];

const REASON_PRESETS = [
  "Callback Requested by Customer",
  "Interested — Proposal Discussion",
  "Payment / Document Verification",
  "Pricing & Discount Inquiry",
  "Technical Query / Demo",
  "No Answer — Retry Follow-Up",
  "Supervisor Escalation",
];

export default function CreateFollowUpModal({
  isOpen,
  onClose,
  defaultLead,
  onSuccess,
}: CreateFollowUpModalProps) {
  const { createFollowUp } = useFollowUps();
  const { user } = useAuth();

  // Helper to get local date & time strings
  const getInitialDateTime = () => {
    const now = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    return {
      date: `${yyyy}-${mm}-${dd}`,
      time: `${hh}:${min}`,
    };
  };

  const initialDT = getInitialDateTime();
  const [customerName, setCustomerName] = useState(defaultLead?.name || "");
  const [customerPhone, setCustomerPhone] = useState(defaultLead?.phone || "");
  const [date, setDate] = useState(initialDT.date);
  const [time, setTime] = useState(initialDT.time);
  const [reason, setReason] = useState(REASON_PRESETS[0]);
  const [customReason, setCustomReason] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handlePresetClick = (getIso: () => string) => {
    const d = new Date(getIso());
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    setDate(`${yyyy}-${mm}-${dd}`);
    setTime(`${hh}:${min}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerPhone.trim()) {
      alert("Customer phone number is required.");
      return;
    }

    try {
      setIsSubmitting(true);
      const combinedDateTime = `${date}T${time}:00`;
      const finalReason = reason === "Other" ? (customReason || "Follow-up") : reason;

      const payload = {
        customer_id: defaultLead?.id || defaultLead?.lead_id || "",
        lead_id: defaultLead?.id || defaultLead?.lead_id || "",
        customer_name: customerName.trim() || "Customer",
        customer_phone: customerPhone.trim(),
        agent_id: String(user?.id || ""),
        pool_id: defaultLead?.pool_id || (user as any)?.pool_id || "general",
        follow_up_datetime: combinedDateTime,
        reason: finalReason,
        notes: notes.trim(),
        priority,
        time_zone: "Asia/Kolkata",
      };

      const result = await createFollowUp(payload);
      if (result) {
        if (onSuccess) onSuccess();
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden"
        >
          {/* Header */}
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-slate-900">Schedule BPO Follow-Up</h2>
                <p className="text-xs text-slate-500 font-medium">Auto-creates reminder & notification task</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
            {/* Customer Details */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Customer Name</label>
                <div className="relative">
                  <User className="h-3.5 w-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Customer Name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none font-medium text-slate-900 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Phone Number *</label>
                <div className="relative">
                  <Phone className="h-3.5 w-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="10-digit phone"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none font-mono font-bold text-slate-900 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Quick Presets */}
            <div>
              <label className="block font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                <span>Quick Time Presets</span>
                <span className="text-[11px] font-normal text-slate-400">Timezone: IST (UTC+05:30)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_OPTIONS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handlePresetClick(p.getIso)}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 font-semibold text-[11px] border border-slate-200/80 transition cursor-pointer active:scale-95"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date and Time Selector */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Follow-Up Date *</label>
                <div className="relative">
                  <Calendar className="h-3.5 w-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none font-semibold text-slate-900 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Follow-Up Time *</label>
                <div className="relative">
                  <Clock className="h-3.5 w-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="time"
                    required
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none font-semibold text-slate-900 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Follow-Up Reason</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none font-semibold text-slate-900 text-xs"
              >
                {REASON_PRESETS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                <option value="Other">Other (Custom Reason)</option>
              </select>
            </div>

            {reason === "Other" && (
              <div>
                <label className="block font-bold text-slate-700 mb-1">Specify Reason</label>
                <input
                  type="text"
                  placeholder="Enter custom reason..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none font-medium text-slate-900 text-xs"
                />
              </div>
            )}

            {/* Priority */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Priority</label>
              <div className="grid grid-cols-4 gap-2">
                {(["low", "medium", "high", "urgent"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`py-1.5 rounded-xl font-bold text-[11px] capitalize border transition cursor-pointer ${
                      priority === p
                        ? p === "urgent"
                          ? "bg-rose-50 border-rose-400 text-rose-700 ring-2 ring-rose-200"
                          : p === "high"
                          ? "bg-orange-50 border-orange-400 text-orange-700 ring-2 ring-orange-200"
                          : "bg-blue-50 border-blue-400 text-blue-700 ring-2 ring-blue-200"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Additional Notes</label>
              <textarea
                rows={2}
                placeholder="Specific customer context, discussion points, or special instructions..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none font-medium text-slate-900 text-xs"
              />
            </div>

            {/* Submit Buttons */}
            <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition shadow-sm cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? "Scheduling..." : "Save Follow-Up"}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
