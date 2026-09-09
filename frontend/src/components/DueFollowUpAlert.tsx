import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useFollowUps } from "../context/FollowUpContext";
import { Phone, Clock, AlertTriangle, X, CheckCircle, RotateCcw } from "lucide-react";

export default function DueFollowUpAlert() {
  const { activeDueFollowUp, snoozeFollowUp, completeFollowUp, dismissDueAlert } = useFollowUps();
  const navigate = useNavigate();

  if (!activeDueFollowUp) return null;

  const handleDial = () => {
    const rawPhone = activeDueFollowUp.customer_phone.replace(/\D/g, "");
    dismissDueAlert();
    navigate(`/dialer?phone=${rawPhone}&leadId=${activeDueFollowUp.customer_id || activeDueFollowUp.lead_id || ""}&name=${encodeURIComponent(activeDueFollowUp.customer_name)}`);
  };

  const handleSnooze = async (mins: number) => {
    await snoozeFollowUp(activeDueFollowUp.id, mins);
  };

  const handleComplete = async () => {
    await completeFollowUp(activeDueFollowUp.id, undefined, "completed", "Marked complete directly from alert");
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        className="fixed top-14 right-6 z-50 max-w-md w-full bg-white border-2 border-amber-400 rounded-2xl shadow-2xl p-5 overflow-hidden"
      >
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500 animate-pulse" />

        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center shrink-0">
              <Clock className="h-5 w-5 animate-spin" style={{ animationDuration: "6s" }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300">
                  ● DUE NOW
                </span>
                <span className="text-xs font-semibold text-slate-500">BPO Follow-Up</span>
              </div>
              <h3 className="text-base font-extrabold text-slate-900 mt-0.5">
                {activeDueFollowUp.customer_name}
              </h3>
            </div>
          </div>

          <button
            onClick={dismissDueAlert}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
            title="Dismiss Alert"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 p-3 rounded-xl bg-amber-50/70 border border-amber-200/80 space-y-1.5 text-xs text-slate-700">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-slate-500">Phone:</span>
            <span className="font-mono font-bold text-slate-900">{activeDueFollowUp.customer_phone}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-semibold text-slate-500">Reason:</span>
            <span className="font-medium text-slate-900 text-right truncate max-w-[220px]">{activeDueFollowUp.reason}</span>
          </div>
          {activeDueFollowUp.pool_name && (
            <div className="flex justify-between items-center">
              <span className="font-semibold text-slate-500">Pool / Queue:</span>
              <span className="font-medium text-slate-900">{activeDueFollowUp.pool_name}</span>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <button
            onClick={handleDial}
            className="flex-1 h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition active:scale-95 cursor-pointer"
          >
            <Phone className="h-3.5 w-3.5" />
            <span>Call Customer Now</span>
          </button>

          <button
            onClick={() => handleSnooze(10)}
            className="h-9 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
            title="Snooze 10 Mins"
          >
            <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
            <span>Snooze 10m</span>
          </button>

          <button
            onClick={handleComplete}
            className="h-9 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
            title="Mark Completed"
          >
            <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
            <span>Complete</span>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
