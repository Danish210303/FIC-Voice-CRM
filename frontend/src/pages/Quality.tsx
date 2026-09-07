import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { CustomSelect } from "../components/CustomSelect";
import {
  ShieldCheck,
  CheckSquare,
  Volume2,
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
  Pause
} from "lucide-react";

type CallLog = {
  id: string;
  lead_id: string;
  agent_id: string;
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
  quality_evaluation?: {
    coaching_notes: string;
    ai_quality_score: number;
    compliance_score: number;
    sentiment: string;
    evaluated_by: string;
    evaluated_at: string;
  };
};

const SENTIMENT_OPTIONS = [
  { value: "positive", label: "Positive (Satisfied, cooperative)" },
  { value: "neutral", label: "Neutral (General business exchange)" },
  { value: "negative", label: "Negative (Frustrated, argumentative)" }
];

export default function Quality() {
  const { showToast } = useToast();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);
  const [loading, setLoading] = useState(true);

  // Form Evaluation state
  const [coachingNotes, setCoachingNotes] = useState("");
  const [aiQualityScore, setAiQualityScore] = useState(0);
  const [complianceScore, setComplianceScore] = useState(0);
  const [sentiment, setSentiment] = useState("");

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
                const minutes = Math.floor(c.duration_seconds / 60);
                const seconds = String(c.duration_seconds % 60).padStart(2, "0");

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
                      <span className="text-xs text-slate-500 dark:text-[#94A3B8] font-bold font-mono flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        {minutes}:{seconds}
                      </span>
                    </div>

                    <div className="flex justify-between items-end gap-2 pt-1">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-[#2563EB] to-[#3B82F6] text-white font-black text-xs flex items-center justify-center shadow-xs shrink-0 border border-blue-400/30">
                          {c.agent_id ? c.agent_id[0].toUpperCase() : "A"}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-900 dark:text-[#F8FAFC] truncate">Agent: {c.agent_id}</div>
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
              
              {/* Call identity & Audio player panel */}
              <div className="bg-slate-50 dark:bg-[#172033] border border-slate-200/80 dark:border-white/10 p-5 rounded-[20px] flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-xs">
                <div className="space-y-1">
                  <h3 className="font-black text-slate-900 dark:text-[#F8FAFC] text-lg font-mono flex items-center gap-2">
                    <span>Conversation ID:</span>
                    <span className="text-[#2563EB] dark:text-[#60A5FA]">{selectedCall.id.slice(-8).toUpperCase()}</span>
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-[#94A3B8] font-semibold">
                    <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-[#2563EB] dark:text-[#60A5FA]" /> Agent: {selectedCall.agent_id}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-[#2563EB] dark:text-[#60A5FA]" /> Date: {new Date(selectedCall.started_at).toLocaleString()}</span>
                  </div>
                </div>
                
                {/* Audio player */}
                {selectedCall.recording_file && selectedCall.recording_file.startsWith('http') ? (
                  <div className="flex items-center gap-3.5 bg-white dark:bg-[#111827] border border-slate-200 dark:border-white/10 px-4 py-2.5 rounded-[16px] shadow-sm self-start md:self-center">
                    <audio controls src={selectedCall.recording_file} className="w-64 h-10" />
                  </div>
                ) : (
                  <div className="flex items-center gap-3.5 bg-white dark:bg-[#111827] border border-slate-200 dark:border-white/10 px-4 py-2.5 rounded-[16px] shadow-sm self-start md:self-center text-xs font-bold text-slate-500">
                    <span className="flex items-center gap-2"><Volume2 className="h-4 w-4" /> No Recording Available</span>
                  </div>
                )}
              </div>

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
    </div>
  );
}
