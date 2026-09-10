import React, { useMemo } from "react";
import {
  ClipboardCheck,
  Phone,
  Clock,
  Calendar,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  User
} from "lucide-react";
import { getCurrentISTInputs, isFutureISTDateTime } from "../utils/dateUtils";

export interface WrapUpLead {
  _id?: string;
  name?: string;
  phone?: string;
  email?: string;
  status?: string;
}

export interface WrapUpPanelProps {
  lead?: WrapUpLead | null;
  phone?: string;
  maskedPhone?: string;
  callDuration?: number;
  callDirection?: "inbound" | "outbound" | string;
  wrapUpDuration: number;
  disposition: string;
  setDisposition: (disposition: string) => void;
  followUpDate: string;
  setFollowUpDate: (date: string) => void;
  followUpTime: string;
  setFollowUpTime: (time: string) => void;
  notes: string;
  setNotes: (notes: string) => void;
  isSavingOutcome: boolean;
  onSaveAndNext: () => void | Promise<void>;
  formatTime: (secs: number) => string;
}

interface DispositionOption {
  val: string;
  label: string;
  activeCls: string;
  description: string;
}

const DISPOSITION_CHIPS: DispositionOption[] = [
  {
    val: "interested",
    label: "Interested",
    activeCls: "bg-emerald-600 text-white border-emerald-700 shadow-sm ring-2 ring-emerald-500/30",
    description: "Prospect is interested in offer"
  },
  {
    val: "not_interested",
    label: "Not Interested",
    activeCls: "bg-rose-600 text-white border-rose-700 shadow-sm ring-2 ring-rose-500/30",
    description: "Prospect declined"
  },
  {
    val: "call_back",
    label: "Call Back",
    activeCls: "bg-amber-600 text-white border-amber-700 shadow-sm ring-2 ring-amber-500/30",
    description: "Schedule follow-up appointment"
  },
  {
    val: "converted",
    label: "Converted",
    activeCls: "bg-blue-600 text-white border-blue-700 shadow-sm ring-2 ring-blue-500/30",
    description: "Deal closed / qualified"
  },
  {
    val: "no_answer",
    label: "No Answer",
    activeCls: "bg-slate-700 text-white border-slate-800 shadow-sm ring-2 ring-slate-500/30",
    description: "Ringing / unanswered"
  },
  {
    val: "dnc",
    label: "DNC",
    activeCls: "bg-purple-700 text-white border-purple-800 shadow-sm ring-2 ring-purple-500/30",
    description: "Do Not Call registry"
  }
];

export const WrapUpPanel: React.FC<WrapUpPanelProps> = ({
  lead,
  phone = "",
  maskedPhone = "",
  callDuration = 0,
  callDirection = "outbound",
  wrapUpDuration = 0,
  disposition,
  setDisposition,
  followUpDate,
  setFollowUpDate,
  followUpTime,
  setFollowUpTime,
  notes,
  setNotes,
  isSavingOutcome,
  onSaveAndNext,
  formatTime
}) => {
  const MAX_NOTES_LEN = 300;

  // Validation: valid disposition selected + if call_back then requires future follow-up date and time in Asia/Kolkata
  const isFormValid = useMemo(() => {
    if (!disposition) return false;
    if (disposition === "call_back") {
      if (!followUpDate.trim() || !followUpTime.trim()) return false;
      return isFutureISTDateTime(followUpDate, followUpTime);
    }
    return true;
  }, [disposition, followUpDate, followUpTime]);

  const isPastDateTime = useMemo(() => {
    if (disposition === "call_back" && followUpDate.trim() && followUpTime.trim()) {
      return !isFutureISTDateTime(followUpDate, followUpTime);
    }
    return false;
  }, [disposition, followUpDate, followUpTime]);

  const handleSelectDisposition = (val: string) => {
    setDisposition(val);
    if (val === "call_back") {
      if (!followUpDate || !followUpTime) {
        const nextHour = getCurrentISTInputs(60);
        if (!followUpDate) setFollowUpDate(nextHour.date);
        if (!followUpTime) setFollowUpTime(nextHour.time);
      }
    }
  };

  const displayPhone = maskedPhone || phone || "Unknown Phone";
  const displayName = lead?.name || "Customer Lead";
  const todayStr = getCurrentISTInputs().date;


  return (
    <div className="w-full bg-white dark:bg-[#0f172a] rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-3.5 sm:p-4 space-y-3 font-sans transition-all">
      {/* 1. Compact Header: Title & Realtime Live Timer */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <ClipboardCheck className="h-3.5 w-3.5" />
          </div>
          <div>
            <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider leading-none">
              After-Call Work
            </h3>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
              Enterprise BPO Wrap-Up
            </span>
          </div>
        </div>

        {/* Realtime Live Wrap-Up Timer */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60 shadow-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
          <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
          <span>{formatTime(wrapUpDuration)}</span>
        </div>
      </div>

      {/* 2. Compact Call Summary Card */}
      <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-full bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <User className="w-3 h-3" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-900 dark:text-white text-[11px] truncate leading-tight">
              {displayName}
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-1">
              <Phone className="w-2.5 h-2.5 opacity-70" />
              <span>{displayPhone}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right">
            <span className="block text-[9px] uppercase font-bold text-slate-400 tracking-wider">
              Duration
            </span>
            <span className="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300">
              {formatTime(callDuration)}
            </span>
          </div>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase bg-emerald-100/70 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
            {callDirection}
          </span>
        </div>
      </div>

      {/* 3. Call Disposition Primary Grid (3×2) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase tracking-wider">
            Call Disposition <span className="text-rose-500">*</span>
          </label>
          <span className="text-[10px] text-slate-400">
            {disposition ? DISPOSITION_CHIPS.find(d => d.val === disposition)?.label : "Select 1 Outcome"}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {DISPOSITION_CHIPS.map(chip => {
            const isSelected = disposition === chip.val;
            return (
              <button
                key={chip.val}
                type="button"
                onClick={() => handleSelectDisposition(chip.val)}
                className={`h-9 px-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer text-center truncate flex items-center justify-center gap-1 ${
                  isSelected
                    ? chip.activeCls
                    : "bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700/50"
                }`}
                title={chip.description}
              >
                {isSelected && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                <span className="truncate">{chip.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Conditional Follow-up Section: ONLY for "Call Back" */}
      {disposition === "call_back" && (
        <div className="p-2.5 rounded-lg bg-amber-500/5 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 space-y-2 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Schedule Call Back <span className="text-rose-500">*</span>
            </span>
            <span className="text-[9px] text-amber-600/80 dark:text-amber-400/70">
              Required for Callback (IST)
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-0.5">
                Date (Asia/Kolkata)
              </label>
              <input
                type="date"
                min={todayStr}
                value={followUpDate}
                onChange={e => setFollowUpDate(e.target.value)}
                className={`w-full h-8 px-2 bg-white dark:bg-slate-800 border rounded-md text-xs font-semibold text-slate-900 dark:text-white outline-none transition ${
                  isPastDateTime ? "border-rose-500 focus:border-rose-600" : "border-slate-200 dark:border-slate-700 focus:border-amber-500"
                }`}
              />
            </div>
            <div>
              <label className="block text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-0.5">
                Time (IST)
              </label>
              <input
                type="time"
                value={followUpTime}
                onChange={e => setFollowUpTime(e.target.value)}
                className={`w-full h-8 px-2 bg-white dark:bg-slate-800 border rounded-md text-xs font-semibold text-slate-900 dark:text-white outline-none transition ${
                  isPastDateTime ? "border-rose-500 focus:border-rose-600" : "border-slate-200 dark:border-slate-700 focus:border-amber-500"
                }`}
              />
            </div>
          </div>

          {isPastDateTime && (
            <p className="text-[10px] text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1 pt-0.5">
              <AlertCircle className="w-3 h-3 shrink-0" />
              Scheduled time must be in the future (Asia/Kolkata).
            </p>
          )}
        </div>
      )}

      {/* 5. Customer Notes */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Customer Notes
          </label>
          <span className="text-[9px] font-mono text-slate-400">
            {notes.length}/{MAX_NOTES_LEN}
          </span>
        </div>
        <textarea
          placeholder="Log customer response, reason, or next steps..."
          value={notes}
          maxLength={MAX_NOTES_LEN}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          className="w-full p-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-lg text-xs font-medium text-slate-900 dark:text-white resize-none outline-none focus:border-slate-400 dark:focus:border-slate-600 transition placeholder:text-slate-400"
        />
      </div>

      {/* 6. Sticky Full-Width Save & Next Lead Action Button */}
      <div className="pt-1">
        <button
          type="button"
          onClick={onSaveAndNext}
          disabled={!isFormValid || isSavingOutcome}
          className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
        >
          {isSavingOutcome ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Saving Disposition...</span>
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              <span>Save Disposition &amp; Next Lead →</span>
            </>
          )}
        </button>

        {!isFormValid && !isSavingOutcome && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium text-center mt-1 flex items-center justify-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {!disposition
              ? "Select a disposition outcome to proceed"
              : isPastDateTime
              ? "Please select a valid future date & time in Asia/Kolkata"
              : "Select follow-up date and time for Call Back"}
          </p>
        )}
      </div>
    </div>
  );
};
