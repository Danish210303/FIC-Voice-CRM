import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { usePresence, getStatusBadgeDetails } from "../context/PresenceContext";
import { api, getWsUrl } from "../api/client";
import { useToast } from "../context/ToastContext";
import { motion, AnimatePresence } from "framer-motion";
import { plivoWebRTC } from "../services/plivoWebRTC";
import { audioRecorder } from "../services/audioRecorder";
import { CustomPauseIcon } from "../components/CustomPauseIcon";
import { CustomSelect } from "../components/CustomSelect";
import LeadFilterModal from "../components/LeadFilterModal";
import LeadActionSlideOver, { ActiveSlideOverTab } from "../components/LeadActionSlideOver";
import CallEventTimeline, { CallEventItem, CallEventType } from "../components/CallEventTimeline";
import PauseBreakModal from "../components/PauseBreakModal";
import ShiftSummaryModal from "../components/ShiftSummaryModal";
import EarlyLogoutWarningModal from "../components/EarlyLogoutWarningModal";
import { WrapUpPanel } from "../components/WrapUpPanel";
import { useFollowUps } from "../context/FollowUpContext";
import { isFutureISTDateTime, getCurrentISTInputs } from "../utils/dateUtils";
import {
  Phone,
  PhoneCall,
  PhoneOff,
  PhoneForwarded,
  PhoneIncoming,
  PhoneOutgoing,
  Mic,
  MicOff,
  Pause,
  Play,
  Volume2,
  VolumeX,
  User,
  History,
  CheckCircle2,
  XCircle,
  Smartphone,
  X,
  Hash,
  MessageSquare,
  ListOrdered,
  Save,
  Loader2,
  Headphones,
  Ear,
  Sparkles,
  Bot,
  Search,
  Filter,
  RefreshCw,
  Star,
  ArrowRight,
  UserCheck,
  AlertCircle,
  Calendar,
  Clock,
  ChevronRight,
  ChevronDown,
  Coffee,
  Check,
  Share2,
  Send,
  Zap,
  TrendingUp,
  Sliders,
  PhoneMissed,
  FileText,
  Activity
} from "lucide-react"; // Verified single import of icons

type CallStatus =
  | "ready"
  | "dialing"
  | "ringing"
  | "answering"
  | "connecting_media"
  | "connected"
  | "hold"
  | "wrapup"
  | "completed"
  | "busy"
  | "no-answer"
  | "failed";

type AgentStatus = "ready" | "on_call" | "wrap_up" | "break";
type Tab = "outbound" | "inbound" | "supervisor" | "history";

const STATUS_FILTER_OPTIONS = [
  { value: "All", label: "All Statuses" },
  { value: "new", label: "New Leads" },
  { value: "pending", label: "Pending" },
  { value: "follow_up_required", label: "Follow Up Required" },
  { value: "closed", label: "Closed / Converted" }
];

const DISPOSITION_OPTIONS = [
  { value: "interested", label: "Interested" },
  { value: "not_interested", label: "Not Interested" },
  { value: "call_back", label: "Call Back" },
  { value: "no_answer", label: "No Answer" },
  { value: "busy", label: "Busy / Line Busy" },
  { value: "wrong_number", label: "Wrong Number" },
  { value: "converted", label: "Converted / Won" },
  { value: "follow_up_required", label: "Follow-up Required" },
  { value: "dnc", label: "Do Not Call (DNC)" }
];

type ActiveCall = {
  _id: string;
  lead_name?: string;
  phone?: string;
  agent_id: string;
  status: string;
  call_state: string;
  started_at: string;
};

type Lead = {
  _id: string;
  name: string;
  phone: string;
  source: string;
  campaign_id?: string;
  priority?: string;
  status: string;
  updated_at?: string;
  created_at: string;
  assigned_agent_id?: string;
  supervisor_id?: string;
  pool_id?: string;
  notes?: string;
};

type CallHistoryItem = {
  id?: string;
  _id?: string;
  lead_id?: string;
  phone?: string;
  phone_number?: string;
  lead_name?: string;
  agent_name?: string;
  direction?: string;
  duration_seconds?: number;
  duration?: number;
  outcome?: string;
  status?: string;
  disposition?: string;
  started_at?: string;
  ended_at?: string;
  created_at?: string;
  notes?: string;
  recording_url?: string;
  events?: CallEventItem[];
};

export default function Dialer() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { fetchFollowUps, fetchStats: fetchFollowUpStats } = useFollowUps();
  const {
    myStatus,
    pauseReason,
    myPresence,
    wsConnected,
    isSubmittingStatus,
    isCheckedInToday,
    setPresenceStatus,
    netWorkingSeconds,
    grossLoginSeconds,
    totalBreakSeconds,
    activeBreakSeconds,
    readySeconds,
    talkSeconds,
    ringingSeconds,
    updateCallTelemetry,
    setupSeconds,
    disposeSeconds,
    waitingSeconds,
    activeWaitingSeconds,
    totalWaitingSeconds,
    currentWaitingSeconds,
    stopCount,
    isShiftTargetReached,
    shiftTargetSeconds,
  } = usePresence();

  const [showPauseModal, setShowPauseModal] = useState<boolean>(false);
  const [showShiftSummaryModal, setShowShiftSummaryModal] = useState<boolean>(false);
  const [showEarlyLogoutWarningModal, setShowEarlyLogoutWarningModal] = useState<boolean>(false);

  const handleGoOfflineClick = () => {
    if (myStatus === "offline") {
      setShowShiftSummaryModal(true);
      return;
    }
    if (!isShiftTargetReached) {
      setShowEarlyLogoutWarningModal(true);
    } else {
      setShowShiftSummaryModal(true);
    }
  };

  const handleConfirmOffline = async (forceOffline: boolean = true) => {
    try {
      await setPresenceStatus("offline", undefined, forceOffline);
      showToast("Shift completed. Agent status set to Offline.", "info");
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || "Complete your 8-hour working period before going offline.";
      showToast(msg, "error");
    }
  };

  const formatSecsToHMS = (totalSeconds: number) => {
    if (!totalSeconds || isNaN(totalSeconds)) return "00:00:00";
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const loginTimeStr = myPresence?.login_at
    ? new Date(myPresence.login_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : (myPresence?.status === "offline" ? "Offline" : "Not Logged In");

  const loginHoursVal = formatSecsToHMS(grossLoginSeconds);
  const readyTimeFormatted = formatSecsToHMS(readySeconds);
  const pauseTimeFormatted = formatSecsToHMS(totalBreakSeconds);
  const remainingTimeFormatted = formatSecsToHMS(Math.max(0, 28800 - grossLoginSeconds));
  const isCompleted8Hrs = grossLoginSeconds >= 28800;

  const callSetupTimeFormatted = formatSecsToHMS(setupSeconds);
  const totalCallTimeFormatted = formatSecsToHMS(talkSeconds);
  const disposeTimeFormatted = formatSecsToHMS(disposeSeconds);
  const waitingTimeFormatted = formatSecsToHMS(totalWaitingSeconds);
  const currentWaitingFormatted = formatSecsToHMS(currentWaitingSeconds);

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

  const [activeTab, setActiveTab] = useState<Tab>("outbound");

  // AGENT STATE
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("ready");

  // OUTBOUND / INBOUND DIALER MODE STATE
  const [dialerMode, setDialerMode] = useState<"outbound" | "inbound">("outbound");
  const [outboundPhone, setOutboundPhone] = useState("");
  const [callMode, setCallMode] = useState<"human" | "ai">("human");
  const [callStatus, setCallStatus] = useState<CallStatus>("ready");
  const [isDialing, setIsDialing] = useState(false);
  const isDialingRef = useRef(false);
  const callEndReasonRef = useRef<string>("");
  const [isCreatingLead, setIsCreatingLead] = useState(false);
  const [quickCallingLeadId, setQuickCallingLeadId] = useState<string | null>(null);

  // ACTIVE CALL STATE
  const [currentCallId, setCurrentCallId] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [showInCallKeypad, setShowInCallKeypad] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);

  // WRAPUP / AFTER-CALL WORK STATE
  const [disposition, setDisposition] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");
  const [notes, setNotes] = useState("");
  const [isSavingOutcome, setIsSavingOutcome] = useState(false);
  const [isMuteLoading, setIsMuteLoading] = useState(false);
  const [isHoldLoading, setIsHoldLoading] = useState(false);
  const [isHoldProcessing, setIsHoldProcessing] = useState(false);

  // INCOMING & INBOUND ACD QUEUE STATE
  type QueuedInboundCall = {
    id: string;
    phone: string;
    name: string;
    queuedAt: number;
    department?: string;
  };
  const [incomingCall, setIncomingCall] = useState<{
    id: string;
    phone: string;
    name: string;
    campaign?: string;
    timestamp?: string;
  } | null>(null);
  const [inboundQueue, setInboundQueue] = useState<QueuedInboundCall[]>([]);
  const [queueWaitSeconds, setQueueWaitSeconds] = useState<number>(0);
  const [autoAnswerEnabled, setAutoAnswerEnabled] = useState<boolean>(false);
  const [ringingDuration, setRingingDuration] = useState<number>(0);
  const [wrapUpDuration, setWrapUpDuration] = useState<number>(0);
  const processedCallIdsRef = useRef<Set<string>>(new Set());
  const autoDialTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoDialLockRef = useRef<string>("");
  const handleDialRef = useRef<() => void>();

  const ringingStartTimeRef = useRef<number | null>(null);
  const answeredStartTimeRef = useRef<number | null>(null);
  const wrapUpStartTimeRef = useRef<number | null>(null);
  const myStatusRef = useRef(myStatus);
  useEffect(() => {
    myStatusRef.current = myStatus;
  }, [myStatus]);
  // WebRTC & Media Diagnostics State
  const [webrtcState, setWebrtcState] = useState<string>("IDLE");
  const [mediaDiagnostics, setMediaDiagnostics] = useState<any>(plivoWebRTC.getDiagnostics());
  const [showDebugPanel, setShowDebugPanel] = useState<boolean>(false);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState<string>("default");
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string>("default");

  useEffect(() => {
    const handleWebRTCState = (e: any) => {
      const { state, diagnostics } = e.detail || {};
      if (state) setWebrtcState(state);
      if (diagnostics) setMediaDiagnostics(diagnostics);

      if ((state === "CONNECTED" || state === "CONNECTING_MEDIA") && (callStatusRef.current === "answering" || callStatusRef.current === "dialing" || callStatusRef.current === "ringing")) {
        setCallStatus("connecting_media");
        console.log("[PLIVO] CALL ANSWERED - MEDIA CONNECTING");
      }
      if (state === "MEDIA_CONNECTED" && (callStatusRef.current === "answering" || callStatusRef.current === "connecting_media" || callStatusRef.current === "dialing" || callStatusRef.current === "ringing")) {
        setCallStatus("connected");
        setAgentStatus("on_call");
        if (!answeredStartTimeRef.current) answeredStartTimeRef.current = Date.now();
        setCallDuration(0);
        setRingingDuration(0);
        console.log("[PLIVO] MEDIA CONNECTED - AUDIO STREAM LIVE");
      }
      if (state === "HOLD") {
        setCallStatus("hold");
      } else if (state === "RESUMED") {
        setCallStatus("connected");
      }
    };

    const handleMediaConnected = (e: any) => {
      console.log("[PLIVO] WebRTC media stream active:", e.detail);
      if (callStatusRef.current !== "wrapup" && callStatusRef.current !== "completed" && callStatusRef.current !== "ready") {
        setCallStatus("connected");
        setAgentStatus("on_call");
        if (!answeredStartTimeRef.current) answeredStartTimeRef.current = Date.now();
        setCallDuration(0);
        setRingingDuration(0);
      }
    };

    window.addEventListener("plivo_webrtc_state_change", handleWebRTCState);
    window.addEventListener("plivo_webrtc_media_connected", handleMediaConnected);

    plivoWebRTC.getAudioDevices().then(({ inputs, outputs }) => {
      setAudioInputDevices(inputs);
      setAudioOutputDevices(outputs);
    });

    plivoWebRTC.initializeMicrophone().then(() => {
      plivoWebRTC.initialize();
    });

    return () => {
      window.removeEventListener("plivo_webrtc_state_change", handleWebRTCState);
      window.removeEventListener("plivo_webrtc_media_connected", handleMediaConnected);
    };
  }, []);

  const callStatusRef = useRef(callStatus);
  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  // Manual dialer requires explicit user click on the Call button (no auto-dial on typing)
  useEffect(() => {
    if (autoDialTimerRef.current) {
      clearTimeout(autoDialTimerRef.current);
      autoDialTimerRef.current = null;
    }
  }, [outboundPhone]);

  const totalRingingSecs = ringingSeconds || 0;
  const ringingTimeFormatted = formatSecsToHMS(totalRingingSecs);

  // Ringing Duration is now calculated authoritatively via PresenceContext
  // No local intervals needed.

  // Web Audio Ringtone Player for Incoming Plivo Calls
  const ringAudioCtxRef = useRef<AudioContext | null>(null);
  const ringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRingtone = useCallback(() => {
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
    if (ringAudioCtxRef.current) {
      try {
        ringAudioCtxRef.current.close();
      } catch {}
      ringAudioCtxRef.current = null;
    }
  }, []);

  const startRingtone = useCallback(() => {
    try {
      stopRingtone();
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      ringAudioCtxRef.current = ctx;

      const playToneBurst = () => {
        if (!ringAudioCtxRef.current || ringAudioCtxRef.current.state === "closed") return;
        try {
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const gain = ctx.createGain();

          osc1.type = "sine";
          osc2.type = "sine";
          osc1.frequency.value = 440;
          osc2.frequency.value = 480;

          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);

          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(ctx.destination);

          osc1.start(ctx.currentTime);
          osc2.start(ctx.currentTime);
          osc1.stop(ctx.currentTime + 1.8);
          osc2.stop(ctx.currentTime + 1.8);
        } catch {}
      };

      playToneBurst();
      ringIntervalRef.current = setInterval(playToneBurst, 3000);
    } catch (err) {
      console.warn("Ringtone playback notice:", err);
    }
  }, [stopRingtone]);

  useEffect(() => {
    if (callStatus === "ringing") {
      startRingtone();
    } else {
      stopRingtone();
    }
    return () => {
      stopRingtone();
    };
  }, [callStatus, startRingtone, stopRingtone]);

  // Call Duration is now calculated authoritatively via PresenceContext
  // No local intervals needed.

  // SUPERVISOR STATE
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const isSupervisor = user?.role === "admin" || user?.role === "team_leader";

  // ASSIGNED LEADS STATE
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoadingLeads, setIsLoadingLeads] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadDirection, setLeadDirection] = useState<"outbound" | "inbound">("outbound");

  // ADVANCED LEAD FILTER STATE
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [filterUserId, setFilterUserId] = useState("");
  const [filterPhone, setFilterPhone] = useState("");
  const [filterSource, setFilterSource] = useState("All");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [filterAgent, setFilterAgent] = useState("");

  // FLOATING RAIL & SLIDE-OVER STATE
  const [activeSlideOver, setActiveSlideOver] = useState<ActiveSlideOverTab>(null);
  const [isSavingSlideOverDisp, setIsSavingSlideOverDisp] = useState(false);

  // CALL METHOD & SIM SELECTION MODAL STATE
  const [showCallMethodModal, setShowCallMethodModal] = useState(false);
  const [selectedCallMethod, setSelectedCallMethod] = useState<"human" | "ai">("human");
  const [selectedSim, setSelectedSim] = useState<"sim1" | "sim2">("sim1");

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterUserId.trim()) count++;
    if (filterPhone.trim()) count++;
    if (statusFilter !== "All") count++;
    if (filterSource !== "All") count++;
    if (filterStartDate) count++;
    if (filterEndDate) count++;
    if (filterAgent.trim()) count++;
    return count;
  }, [filterUserId, filterPhone, statusFilter, filterSource, filterStartDate, filterEndDate, filterAgent]);

  const resetAllFilters = useCallback(() => {
    setSearchQuery("");
    setFilterUserId("");
    setFilterPhone("");
    setStatusFilter("All");
    setFilterSource("All");
    setFilterStartDate("");
    setFilterEndDate("");
    setFilterAgent("");
  }, []);

  // CALL HISTORY STATE
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySearchQuery, setHistorySearchQuery] = useState("");

  // DERIVED TELEMETRY & METRICS (INITIALIZED AFTER ALL STATES)
  const totalCallsHandled = isCheckedInToday
    ? (myPresence?.total_calls_handled !== undefined && myPresence?.total_calls_handled !== null
        ? myPresence.total_calls_handled
        : 0)
    : 0;

  const shiftLogPercentage = totalCallsHandled > 0 ? "100% Shift Log" : "0% Shift Log";

  const avgHandlingTimeFormatted = useMemo(() => {
    const totalHandled = totalCallsHandled || 1;
    const totalSecs = (myPresence?.talk_seconds || 0) + (myPresence?.dispose_seconds || 0) + (myPresence?.ringing_seconds || 0);
    const avgSecs = Math.floor(totalSecs / Math.max(1, totalHandled));
    const mins = Math.floor(avgSecs / 60);
    const secs = avgSecs % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, [myPresence, totalCallsHandled]);

  // Live 1-second ticker for accurate timestamp-based timer calculations
  const [nowTicker, setNowTicker] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTicker(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // BPO AGENT STATUS SELECTOR STATE
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutsideStatus(e: MouseEvent) {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setIsStatusMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutsideStatus);
    return () => document.removeEventListener("mousedown", handleClickOutsideStatus);
  }, []);

  // Clean / sanitize mobile number helper
  const sanitizeMobileNumber = useCallback((val: string): string => {
    if (!val) return "";
    let cleaned = val.trim();
    while (cleaned.startsWith("+91") || cleaned.startsWith("91 ") || cleaned.startsWith("+ 91")) {
      if (cleaned.startsWith("+91")) cleaned = cleaned.slice(3);
      else if (cleaned.startsWith("91 ")) cleaned = cleaned.slice(3);
      else if (cleaned.startsWith("+ 91")) cleaned = cleaned.slice(4);
      cleaned = cleaned.trim();
    }
    cleaned = cleaned.replace(/\D/g, "");
    if (cleaned.length === 12 && cleaned.startsWith("91")) {
      cleaned = cleaned.slice(2);
    }
    return cleaned.slice(0, 10);
  }, []);

  const isValidMobile = useMemo(() => {
    const clean = outboundPhone.replace(/\D/g, "");
    if (clean.length === 10) return true;
    if (clean.length === 12 && clean.startsWith("91")) return true;
    return /^[6-9]\d{9}$/.test(outboundPhone);
  }, [outboundPhone]);

  const validationMessage = useMemo(() => {
    if (outboundPhone.length === 0) return "";
    if (!/^[6-9]/.test(outboundPhone)) {
      return "Indian mobile numbers must start with 6-9";
    }
    if (outboundPhone.length < 10) {
      return `${outboundPhone.length}/10 digits entered`;
    }
    if (!isValidMobile) {
      return "Enter valid 10-digit Indian mobile number";
    }
    return "";
  }, [outboundPhone, isValidMobile]);

  // FETCH DATA
  const fetchLeads = useCallback(async () => {
    setIsLoadingLeads(true);
    try {
      const res = await api.get("/api/leads?paginate=false");
      const list = Array.isArray(res) ? res : (res?.items || res?.leads || []);
      setLeads(list);
    } catch (err: any) {
      console.error("[Dialer] fetchLeads error:", err);
    } finally {
      setIsLoadingLeads(false);
    }
  }, []);

  const fetchCallHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await api.get("/api/calls");
      const list = Array.isArray(res) ? res : (res?.calls || res?.items || []);
      setCallHistory(list);
    } catch (err: any) {
      console.error("[Dialer] fetchCallHistory error:", err);
      setHistoryError(err.message || "Failed to load recent call history.");
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  // Audio Recording Lifecycle: Start recording when connected, finalize & upload when call ends
  useEffect(() => {
    if (callStatus === "connected" && currentCallId) {
      const localStream = plivoWebRTC.getLocalStream();
      const remoteStream = plivoWebRTC.getRemoteStream();
      audioRecorder.startRecording(localStream, currentCallId, remoteStream).catch((err) => {
        console.warn("[DIALER] Failed to start audio recorder:", err);
      });
    } else if (callStatus === "wrapup" || callStatus === "completed") {
      if (currentCallId) {
        audioRecorder.stopAndUpload(currentCallId, callDuration || 0, {
          lead_id: selectedLead?._id,
          agent_id: user?.id,
          outcome: notes ? "disposition_pending" : "answered"
        }).then((res) => {
          if (res?.secure_url) {
            fetchCallHistory();
          }
        }).catch((err) => {
          console.warn("[DIALER] Failed to upload audio recording:", err);
        });
      }
    }
  }, [callStatus, currentCallId, callDuration, selectedLead, user, notes, fetchCallHistory]);

  useEffect(() => {
    fetchLeads();
    fetchCallHistory();

    const checkActiveSession = async () => {
      try {
        const activeRes = await api.get("/api/calls/active").catch(() => null);
        const active = Array.isArray(activeRes)
          ? activeRes[0]
          : (activeRes?.calls?.[0] || activeRes?.items?.[0] || (activeRes && typeof activeRes === "object" && (activeRes.id || activeRes._id) ? activeRes : null));
        if (active && (active.id || active._id)) {
          const startedAt = active.ringing_started_at || active.started_at || active.startedAt || active.created_at;
          const startedTs = startedAt ? new Date(startedAt).getTime() : 0;
          const isStale = (Date.now() - startedTs) > 1800000; // Older than 30 mins

          if (isStale) {
            await api.post(`/api/calls/${active.id || active._id}/manual-end`, {
              call_id: active.id || active._id,
              outcome: "no_answer",
              duration_seconds: 0,
              notes: "Stale ghost session auto-closed on load"
            }).catch(() => {});
            setCallStatus("ready");
            setAgentStatus("ready");
          } else {
            const callId = active.id || active._id;
            setCurrentCallId(callId);
            if (active.phone) {
              setOutboundPhone(sanitizeMobileNumber(active.phone));
            }
            if (active.direction === "inbound") {
              setDialerMode("inbound");
            } else {
              setDialerMode("outbound");
            }

            const rawCallStatus = (active.call_status || active.status || "").toLowerCase();
            if (rawCallStatus === "wrap_up" || rawCallStatus === "wrapup") {
              const wrapTs = active.wrap_up_started_at || active.dispositionStartedAt || active.ended_at;
              wrapUpStartTimeRef.current = wrapTs ? new Date(wrapTs).getTime() : Date.now();
              setCallStatus("wrapup");
              setAgentStatus("wrap_up");
              setWrapUpDuration(Math.max(0, Math.floor((Date.now() - wrapUpStartTimeRef.current) / 1000)));
            } else if (active.connected_at || rawCallStatus === "connected" || rawCallStatus === "in-progress" || rawCallStatus === "in_call") {
              const connTs = active.connected_at ? new Date(active.connected_at).getTime() : Date.now();
              answeredStartTimeRef.current = connTs;
              setCallStatus(active.call_state === "hold" ? "hold" : "connected");
              setAgentStatus("on_call");
              setCallDuration(Math.max(0, Math.floor((Date.now() - connTs) / 1000)));
            } else if (rawCallStatus === "ringing" || rawCallStatus === "dialing" || rawCallStatus === "live") {
              const ringTs = active.ringing_started_at ? new Date(active.ringing_started_at).getTime() : (startedTs || Date.now());
              ringingStartTimeRef.current = ringTs;
              setCallStatus("ringing");
              setAgentStatus("on_call");
              setRingingDuration(Math.max(0, Math.floor((Date.now() - ringTs) / 1000)));
            }
          }
        } else {
          setCallStatus("ready");
          setAgentStatus("ready");
        }
      } catch (err) {
        setCallStatus("ready");
        setAgentStatus("ready");
      }
    };
    checkActiveSession();

    const handleMessageData = (data: any) => {
      if (!data) return;
      if (data.event === "leads_updated") {
        fetchLeads();
        fetchCallHistory();
      }
      if (data.event === "vapi_call_status") {
        const st = (data.call_status || "").toLowerCase();
        if (st === "ringing") {
          setCallStatus("ringing");
        } else if (st === "connected" || st === "in-progress") {
          setCallStatus("connected");
          setAgentStatus("on_call");
          if (!answeredStartTimeRef.current) answeredStartTimeRef.current = Date.now();
        } else if (st === "ended" || st === "completed") {
          setCallStatus("wrapup");
          setAgentStatus("wrap_up");
          wrapUpStartTimeRef.current = Date.now();
          fetchCallHistory();
        }
      }

      if (data.event === "inbound_call_auto_answered") {
        const cleanPhone = (data.phone || "9876543210").replace(/\D/g, "").slice(-10);
        setCurrentCallId(data.call_id);
        setOutboundPhone(cleanPhone);
        setDialerMode("inbound");
        setCallStatus("connected");
        setAgentStatus("on_call");
        answeredStartTimeRef.current = Date.now();
        setCallDuration(0);
        setIsMuted(false);
        setIsSpeaker(false);
        setIsDialing(false);
        isDialingRef.current = false;
        setInboundQueue(prev => prev.filter(c => c.id !== data.call_id && c.phone !== cleanPhone));
        showToast(`Inbound Call Connected: Call from ${data.lead_name || 'Customer'} (+91 ${cleanPhone})`, "success");
      }
      if (data.event === "FOLLOW_UP_AUTO_CALLING" || data.type === "FOLLOW_UP_AUTO_CALLING") {
        const cleanPhone = (data.phone || "9876543210").replace(/\D/g, "").slice(-10);
        if (data.call_id) setCurrentCallId(data.call_id);
        setOutboundPhone(cleanPhone);
        if (data.lead_id || data.customer_name) {
          setSelectedLead({
            _id: data.lead_id || `lead_${Date.now()}`,
            name: data.customer_name || "Customer Lead",
            phone: cleanPhone,
            status: "in_call",
            pool_id: data.pool_id || "general"
          } as any);
        }
        setDialerMode("outbound");
        setCallStatus("connected");
        setAgentStatus("on_call");
        answeredStartTimeRef.current = Date.now();
        setCallDuration(0);
        setIsMuted(false);
        setIsSpeaker(false);
        setIsDialing(false);
        isDialingRef.current = false;
        showToast(`🔄 Scheduled Auto-Callback Connected: ${data.customer_name || 'Customer'} (+91 ${cleanPhone})`, "info");
      }
      if (data.event === "inbound_call_queued") {
        const cleanPhone = (data.phone || "9876543210").replace(/\D/g, "").slice(-10);
        const newQueued: QueuedInboundCall = {
          id: data.call_id || `acd_inc_${Date.now()}`,
          phone: cleanPhone,
          name: data.lead_name || "Banking Customer",
          queuedAt: Date.now(),
          department: data.pool_id || "Banking Customer Care"
        };
        setInboundQueue(prev => [...prev.filter(c => c.id !== newQueued.id), newQueued]);
        showToast(`📥 Inbound Call Queued (Position #${data.queue_position || 1})`, "warning");
      }
      if (data.event === "agent_status_changed" || data.event === "agent.status.changed" || data.type === "agent_status_changed") {
        const st = (data.status || data.raw_status || "").toLowerCase();
        if (st) {
          setAgentStatus(st === "wrapup" ? "wrap_up" : (st as any));
        }
      }
      const evtName = (data.event || data.type || "").toLowerCase();

      // 1. CALL RINGING & INBOUND CALL
      if (evtName === "call_created" || evtName === "call_ringing" || evtName === "inbound_call" || evtName === "incoming_call") {
        const callId = data.call_id || data.id;
        const rawPhone = data.caller_number || data.phone || data.number;
        const cleanPhone = rawPhone ? String(rawPhone).replace(/\D/g, "").slice(-10) : "";
        const displayPhone = cleanPhone || "Unknown Caller";
        const custName = data.customer_name || data.lead_name || data.name || (cleanPhone ? `Customer (${cleanPhone})` : "Unknown Caller");
        const campName = data.campaign || data.queue || data.pool_id || "Customer Care";
        const timeStamp = data.ringing_started_at || data.timestamp || new Date().toISOString();
        const ringTs = Date.parse(timeStamp) || Date.now();

        if (callId) setCurrentCallId(callId);
        ringingStartTimeRef.current = ringTs;

        if (evtName === "inbound_call" || evtName === "incoming_call") {
          if (!processedCallIdsRef.current.has(callId || cleanPhone)) {
            processedCallIdsRef.current.add(callId || cleanPhone);
            if (myStatusRef.current === "ready" && (callStatusRef.current === "ready" || callStatusRef.current === "wrapup")) {
              setIncomingCall({
                id: callId || `inc_${Date.now()}`,
                phone: displayPhone,
                name: custName,
                campaign: campName,
                timestamp: timeStamp
              });
              setOutboundPhone(cleanPhone || "9876543210");
              setDialerMode("inbound");
              setCallStatus("ringing");
              setRingingDuration(Math.max(0, Math.floor((Date.now() - ringTs) / 1000)));
              showToast(`📞 Incoming Call from ${custName} (${displayPhone})`, "info");
            }
          }
        } else {
          setCallStatus("ringing");
          setRingingDuration(Math.max(0, Math.floor((Date.now() - ringTs) / 1000)));
        }
      }

      // 2. CALL CONNECTED / ANSWERED
      if (evtName === "call_connected" || evtName === "call_accepted") {
        if (data.call_id) setCurrentCallId(data.call_id);
        const connTs = data.connected_at ? new Date(data.connected_at).getTime() : Date.now();
        answeredStartTimeRef.current = connTs;
        setCallStatus("connected");
        setAgentStatus("on_call");
        setIsMuted(false);
        setCallDuration(Math.max(0, Math.floor((Date.now() - connTs) / 1000)));
      }

      // 3. CALL HOLD & RESUME
      if (evtName === "call_hold" || (data.event === "manual_call_action" && data.action === "hold")) {
        setCallStatus("hold");
      }
      if (evtName === "call_resume" || (data.event === "manual_call_action" && data.action === "resume")) {
        setCallStatus("connected");
      }

      // 4. CALL TRANSFER
      if (evtName === "call_transfer") {
        setShowTransferModal(true);
      }

      // 5. CALL ENDED & WRAP-UP STARTED
      if (evtName === "call_ended" || evtName === "call_wrap_up_started" || evtName === "agent.wrapup.started" || evtName === "agent_wrapup_started") {
        if (data.call_id || data.callId) setCurrentCallId(data.call_id || data.callId);
        const wrapTs = data.wrap_up_started_at || data.dispositionStartedAt || data.ended_at || data.timestamp;
        wrapUpStartTimeRef.current = wrapTs ? new Date(wrapTs).getTime() : Date.now();
        setCallStatus("wrapup");
        setAgentStatus("wrap_up");
        setActiveTab("outbound");
        setWrapUpDuration(Math.max(0, Math.floor((Date.now() - wrapUpStartTimeRef.current) / 1000)));
        fetchCallHistory();
      }

      // 6. DISPOSITION SAVED / WRAP-UP COMPLETED
      if (evtName === "call_disposition_saved" || evtName === "agent.wrapup.completed" || evtName === "agent_wrapup_completed" || (evtName === "call_completed" && data.disposition)) {
        setCallStatus("ready");
        setAgentStatus("ready");
        setCurrentCallId(null);
        ringingStartTimeRef.current = null;
        answeredStartTimeRef.current = null;
        wrapUpStartTimeRef.current = null;
        setCallDuration(0);
        setRingingDuration(0);
        setWrapUpDuration(0);
        fetchCallHistory();
        fetchLeads();
      }

      if (evtName === "call_rejected") {
        setIncomingCall(null);
        ringingStartTimeRef.current = null;
        setCallStatus("ready");
        setAgentStatus("ready");
        showToast("Call rejected", "info");
      }

      if (data.event === "call_status_update") {
        const status: string = (data.call_status || "").toLowerCase();
        if (status === "busy" || status === "no-answer" || status === "no_answer" || status === "failed") {
          callEndReasonRef.current = status;
          setCallStatus("ready");
          setAgentStatus("ready");
          isDialingRef.current = false;
          setIsDialing(false);
          ringingStartTimeRef.current = null;
          showToast(`Call could not connect: ${status.toUpperCase()}`, "warning");
        } else if (status === "in-progress" || status === "answered") {
          const connTs = data.connected_at ? new Date(data.connected_at).getTime() : Date.now();
          answeredStartTimeRef.current = connTs;
          setCallStatus("connected");
          setAgentStatus("on_call");
          isDialingRef.current = false;
          setIsDialing(false);
          setCallDuration(Math.max(0, Math.floor((Date.now() - connTs) / 1000)));
        } else if (status === "ringing" || status === "initiated") {
          setCallStatus("ringing");
          if (!ringingStartTimeRef.current) ringingStartTimeRef.current = Date.now();
        } else if (status === "completed" || status === "canceled" || status === "hangup") {
          const cur = callStatusRef.current;
          if (cur === "connected" || cur === "hold" || cur === "ringing" || cur === "dialing") {
            wrapUpStartTimeRef.current = Date.now();
            setCallStatus("wrapup");
            setAgentStatus("wrap_up");
            isDialingRef.current = false;
            setIsDialing(false);
          }
        }
      }
    };

    const handleWsEvent = (e: Event) => {
      const customEvt = e as CustomEvent;
      if (customEvt.detail) {
        handleMessageData(customEvt.detail);
      }
    };

    const handlePlivoIncoming = (e: Event) => {
      const customEvt = e as CustomEvent;
      const { callerID, callerName, extraHeaders, callInfo } = customEvt.detail || {};
      const callId = extraHeaders?.["X-Call-Id"] || callInfo?.callUUID || `inc_${Date.now()}`;
      const phone = callerID || callerName || "Unknown";
      
      setIncomingCall({
        id: callId,
        phone: phone,
        name: callerName || phone,
        timestamp: new Date().toISOString()
      });
      setOutboundPhone(phone);
      setDialerMode("inbound");
      setCallStatus("ringing");
      setAgentStatus("on_call");
      ringingStartTimeRef.current = Date.now();
    };

    const handlePlivoRinging = () => {
      setCallStatus("ringing");
      if (!ringingStartTimeRef.current) {
        ringingStartTimeRef.current = Date.now();
      }
    };

    const handlePlivoMediaConnected = () => {
      const connTs = Date.now();
      if (!answeredStartTimeRef.current) {
        answeredStartTimeRef.current = connTs;
      }
      setCallStatus("connected");
      setAgentStatus("on_call");
      isDialingRef.current = false;
      setIsDialing(false);
      setCallDuration(Math.max(0, Math.floor((Date.now() - answeredStartTimeRef.current) / 1000)));
    };

    const handlePlivoFailed = (e: Event) => {
      const customEvt = e as CustomEvent;
      const reason = customEvt.detail?.reason || "Call failed or network error";
      showToast(`Call Failed: ${typeof reason === 'string' ? reason : 'Network/ICE error'}`, "error");
      setCallStatus("ready");
      setAgentStatus("ready");
      isDialingRef.current = false;
      setIsDialing(false);
      setRingingDuration(0);
      setCallDuration(0);
      ringingStartTimeRef.current = null;
      answeredStartTimeRef.current = null;
      autoDialLockRef.current = "";
      updateCallTelemetry({ ringing_seconds: 0, talk_seconds: 0 });
    };

    const handlePlivoTerminated = () => {
      wrapUpStartTimeRef.current = Date.now();
      setCallStatus("wrapup");
      setAgentStatus("wrap_up");
      isDialingRef.current = false;
      setIsDialing(false);
      setIncomingCall(null);
    };

    window.addEventListener("forge_global_ws_msg", handleWsEvent);
    window.addEventListener("plivo_webrtc_incoming", handlePlivoIncoming);
    window.addEventListener("plivo_webrtc_ringing", handlePlivoRinging);
    window.addEventListener("plivo_webrtc_media_connected", handlePlivoMediaConnected);
    window.addEventListener("plivo_webrtc_call_connected", handlePlivoMediaConnected);
    window.addEventListener("plivo_webrtc_failed", handlePlivoFailed);
    window.addEventListener("plivo_webrtc_ice_failed", handlePlivoFailed);
    window.addEventListener("plivo_webrtc_terminated", handlePlivoTerminated);

    return () => {
      window.removeEventListener("forge_global_ws_msg", handleWsEvent);
      window.removeEventListener("plivo_webrtc_incoming", handlePlivoIncoming);
      window.removeEventListener("plivo_webrtc_ringing", handlePlivoRinging);
      window.removeEventListener("plivo_webrtc_media_connected", handlePlivoMediaConnected);
      window.removeEventListener("plivo_webrtc_call_connected", handlePlivoMediaConnected);
      window.removeEventListener("plivo_webrtc_failed", handlePlivoFailed);
      window.removeEventListener("plivo_webrtc_ice_failed", handlePlivoFailed);
      window.removeEventListener("plivo_webrtc_terminated", handlePlivoTerminated);
    };
  }, [fetchLeads, fetchCallHistory, showToast]);

  // Timers: Live calculation from authoritative backend timestamps on every nowTicker tick
  useEffect(() => {
    if (callStatus === "dialing" || callStatus === "ringing") {
      if (ringingStartTimeRef.current) {
        setRingingDuration(Math.max(0, Math.floor((Date.now() - ringingStartTimeRef.current) / 1000)));
      }
    } else if (callStatus === "connected" || callStatus === "hold") {
      if (answeredStartTimeRef.current) {
        setCallDuration(Math.max(0, Math.floor((Date.now() - answeredStartTimeRef.current) / 1000)));
      }
    } else if (callStatus === "wrapup") {
      if (wrapUpStartTimeRef.current) {
        setWrapUpDuration(Math.max(0, Math.floor((Date.now() - wrapUpStartTimeRef.current) / 1000)));
      }
    }
  }, [nowTicker, callStatus]);

  // Today's Stats Calculation
  const todayStats = useMemo(() => {
    const now = new Date();
    const todayStr = now.toDateString();

    const todayCalls = callHistory.filter((c) => {
      const dt = c.started_at || c.created_at;
      if (!dt) return false;
      return new Date(dt).toDateString() === todayStr;
    });

    const total = todayCalls.length;
    const connected = todayCalls.filter(c => ["answered", "connected", "qualified", "completed"].includes((c.outcome || c.status || "").toLowerCase())).length;
    const noAnswer = todayCalls.filter(c => ["no_answer", "no-answer"].includes((c.outcome || c.status || "").toLowerCase())).length;
    const busy = todayCalls.filter(c => ["busy"].includes((c.outcome || c.status || "").toLowerCase())).length;
    const followUps = todayCalls.filter(c => ["follow_up_required", "call_back", "follow_up"].includes((c.outcome || c.status || "").toLowerCase())).length;
    const converted = todayCalls.filter(c => ["converted", "qualified"].includes((c.outcome || c.status || "").toLowerCase())).length;

    return { total, connected, noAnswer, busy, followUps, converted };
  }, [callHistory]);

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      // 1. Search Query (Name, Phone or User ID)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const nameMatch = (l.name || "").toLowerCase().includes(q);
        const phoneMatch = (l.phone || "").toLowerCase().includes(q);
        const idMatch = (l._id || (l as any).id || "").toLowerCase().includes(q);
        if (!nameMatch && !phoneMatch && !idMatch) return false;
      }

      // 2. User ID / Lead ID
      if (filterUserId.trim()) {
        const targetId = filterUserId.toLowerCase().trim();
        const leadId = (l._id || (l as any).id || "").toLowerCase();
        if (!leadId.includes(targetId)) return false;
      }

      // 3. Phone Number Filter
      if (filterPhone.trim()) {
        const cleanTarget = filterPhone.replace(/\D/g, "");
        const cleanLeadPhone = (l.phone || "").replace(/\D/g, "");
        if (!cleanLeadPhone.includes(cleanTarget)) return false;
      }

      // 4. Status Filter
      if (statusFilter !== "All" && statusFilter.toLowerCase() !== "all") {
        const s = (l.status || "").toLowerCase();
        const sf = statusFilter.toLowerCase();
        const matchStatus = s === sf || (sf === "pending" && (s === "new" || s === "pending" || s === "follow_up_required"));
        if (!matchStatus) return false;
      }

      // 5. Source Filter
      if (filterSource !== "All" && filterSource.toLowerCase() !== "all") {
        if ((l.source || "Manual").toLowerCase() !== filterSource.toLowerCase()) return false;
      }

      // 6. Agent Filter
      if (filterAgent.trim()) {
        const qAgent = filterAgent.toLowerCase().trim();
        const agentId = (l.assigned_agent_id || "").toLowerCase();
        if (!agentId.includes(qAgent)) return false;
      }

      // 7. Date Range Filter
      if (filterStartDate) {
        const start = new Date(filterStartDate).getTime();
        const created = new Date(l.created_at || Date.now()).getTime();
        if (created < start) return false;
      }
      if (filterEndDate) {
        const end = new Date(filterEndDate).getTime() + 86400000;
        const created = new Date(l.created_at || Date.now()).getTime();
        if (created > end) return false;
      }

      return true;
    });
  }, [
    leads, searchQuery, filterUserId, filterPhone, statusFilter,
    filterSource, filterStartDate, filterEndDate, filterAgent
  ]);

  const outboundLeadsCount = useMemo(() => {
    return filteredLeads.filter((l: any) => !(l.direction === "inbound" || (l.source && l.source.toLowerCase().includes("inbound")) || l.type === "inbound")).length;
  }, [filteredLeads]);

  const inboundLeadsCount = useMemo(() => {
    return filteredLeads.filter((l: any) => (l.direction === "inbound" || (l.source && l.source.toLowerCase().includes("inbound")) || l.type === "inbound")).length;
  }, [filteredLeads]);

  const displayedLeads = useMemo(() => {
    return filteredLeads.filter((l: any) => {
      const isInbound = (l.direction === "inbound" || (l.source && l.source.toLowerCase().includes("inbound")) || l.type === "inbound");
      return leadDirection === "inbound" ? isInbound : !isInbound;
    });
  }, [filteredLeads, leadDirection]);

  const handleSaveSlideOverDisposition = async (status: string, notes: string, followUpDate?: string) => {
    if (!selectedLead?._id) return;
    setIsSavingSlideOverDisp(true);
    try {
      await api.patch(`/api/leads/${selectedLead._id}/disposition`, {
        status,
        notes,
        follow_up_date: followUpDate
      });

      if (followUpDate || status === "call_back" || status === "follow_up_required") {
        try {
          await api.post("/api/follow-ups", {
            customer_id: selectedLead._id,
            lead_id: selectedLead._id,
            customer_name: selectedLead.name || "Customer",
            customer_phone: selectedLead.phone || outboundPhone,
            agent_id: user?.id,
            pool_id: selectedLead.pool_id,
            call_id: currentCallId || undefined,
            follow_up_datetime: followUpDate,
            time_zone: "Asia/Kolkata",
            reason: notes || `Follow-up (${status.replace(/_/g, " ").toUpperCase()})`,
            notes
          });
        } catch (fue) {
          // Backend patch already handles internal creation fallback
        }
      }

      if (currentCallId) {
        // Upload audio recording if not already uploaded
        audioRecorder.stopAndUpload(currentCallId, callDuration || 0, {
          lead_id: selectedLead._id,
          agent_id: user?.id,
          outcome: status,
          notes,
          follow_up_date: followUpDate
        }).catch(() => {});

        await api.post(`/api/calls/${currentCallId}/manual-end`, {
          call_id: currentCallId,
          outcome: status,
          duration_seconds: callDuration || 0,
          notes,
          follow_up_date: followUpDate
        });
      }

      showToast(`Disposition saved: ${status.replace(/_/g, " ").toUpperCase()}`, "success");
      fetchLeads();
      fetchCallHistory();
      fetchFollowUps("all");
      fetchFollowUpStats();
    } catch (err: any) {
      showToast(err.message || "Failed to save disposition", "error");
    } finally {
      setIsSavingSlideOverDisp(false);
    }
  };

  // Select Lead Handler
  const handleSelectLead = (lead: Lead) => {
    setSelectedLead(lead);
    const cleanPhone = sanitizeMobileNumber(lead.phone);
    setOutboundPhone(cleanPhone);
    setActiveSlideOver("profile");
  };

  const handleUpdateLeadDisposition = async (leadId: string, status: string, notes: string, followUpDate?: string) => {
    try {
      await api.patch(`/api/leads/${leadId}/disposition`, { status, notes, follow_up_date: followUpDate });
      showToast("Lead disposition updated successfully", "success");
      fetchLeads();
    } catch (err: any) {
      showToast(err.message || "Failed to update lead disposition", "error");
    }
  };

  // Keypad Press Handler
  const handleKeypadPress = async (digit: string) => {
    if (callStatus === "ready") {
      if (/^[0-9]$/.test(digit) && outboundPhone.length < 10) {
        setOutboundPhone(prev => prev + digit);
      }
    } else if (callStatus === "connected" && currentCallId) {
      try {
        await api.post(`/api/calls/${currentCallId}/dtmf`, { digit });
      } catch (err: any) {
        showToast(err.message || "Failed to send DTMF", "error");
      }
    }
  };

  // INBOUND ACD ENGINE CONNECT & DISPATCH LOGIC
  const connectInboundCall = useCallback((callItem: QueuedInboundCall) => {
    const cleanPhone = sanitizeMobileNumber(callItem.phone) || "9876543210";
    const matched = leads.find(l => l.phone.replace(/\D/g, "").slice(-10) === cleanPhone);

    setCurrentCallId(callItem.id);
    setOutboundPhone(cleanPhone);
    if (matched) {
      setSelectedLead(matched);
    }
    setCallStatus("connected");
    setAgentStatus("on_call");
    setCallDuration(0);
    setIsMuted(false);
    setIsSpeaker(false);
    setIsDialing(false);
    isDialingRef.current = false;

    // Remove from queue if present
    setInboundQueue(prev => prev.filter(c => c.id !== callItem.id));
  }, [leads, sanitizeMobileNumber]);

  const handleInboundACDCall = useCallback(async (customPhone?: string, customName?: string) => {
    const targetPhone = customPhone || outboundPhone || "9876543210";
    const cleanPhone = sanitizeMobileNumber(targetPhone) || "9876543210";
    const matched = leads.find(l => l.phone.replace(/\D/g, "").slice(-10) === cleanPhone);
    const callerName = customName || matched?.name || `Banking Inbound Customer (${cleanPhone})`;

    try {
      const res = await api.post("/api/calls/inbound/acd", {
        phone: cleanPhone,
        name: callerName,
        pool_id: selectedLead?.pool_id || "banking_customer_care",
        auto_answer: autoAnswerEnabled
      });

      const data = res.data;
      if (data.status === "connected") {
        if (autoAnswerEnabled && agentStatus === "ready") {
          setCurrentCallId(data.call?._id || data.call_id);
          setOutboundPhone(cleanPhone);
          if (data.lead) setSelectedLead(data.lead);
          setCallStatus("connected");
          setAgentStatus("on_call");
          setCallDuration(0);
          setIsMuted(false);
          setIsSpeaker(false);
          setIsDialing(false);
          isDialingRef.current = false;
          showToast(`Inbound Call Connected: Call from ${data.lead?.name || callerName} (+91 ${cleanPhone})`, "success");
        } else {
          setIncomingCall({ id: data.call?._id || `inc_${Date.now()}`, phone: cleanPhone, name: data.lead?.name || callerName });
          setOutboundPhone(cleanPhone);
          if (data.lead) setSelectedLead(data.lead);
          setCallStatus("ringing");
          showToast(`Incoming Line Ringing: ${callerName} (+91 ${cleanPhone})`, "info");
        }
      } else if (data.status === "queued") {
        const newCall: QueuedInboundCall = {
          id: data.call_id || `acd_inc_${Date.now()}`,
          phone: cleanPhone,
          name: data.lead?.name || callerName,
          queuedAt: Date.now(),
          department: "Banking Customer Care"
        };
        setInboundQueue(prev => [...prev.filter(c => c.id !== newCall.id), newCall]);
        showToast(`Inbound Call Queued (Position #${data.queue_position || inboundQueue.length + 1})`, "warning");
      }
    } catch (err) {
      // Local fallback
      const newCall: QueuedInboundCall = {
        id: `acd_inc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        phone: cleanPhone,
        name: callerName,
        queuedAt: Date.now(),
        department: "Banking Customer Care"
      };

      setOutboundPhone(cleanPhone);
      if (matched) setSelectedLead(matched);

      if (agentStatus === "ready" && (callStatus === "ready" || callStatus === "wrapup")) {
        if (autoAnswerEnabled) {
          connectInboundCall(newCall);
          showToast(`Inbound Call Connected: Call from ${callerName} (+91 ${cleanPhone})`, "success");
        } else {
          setIncomingCall({ id: newCall.id, phone: cleanPhone, name: callerName });
          setCallStatus("ringing");
          showToast(`Incoming Line Ringing: ${callerName} (+91 ${cleanPhone})`, "info");
        }
      } else {
        setInboundQueue(prev => [...prev, newCall]);
        showToast(`Inbound Call Queued (Position #${inboundQueue.length + 1})`, "warning");
      }
    }
  }, [agentStatus, callStatus, outboundPhone, leads, inboundQueue.length, connectInboundCall, sanitizeMobileNumber, autoAnswerEnabled, selectedLead]);

  const updateAgentBPOStatus = async (newStatus: AgentStatus) => {
    setAgentStatus(newStatus);
    try {
      const res = await api.patch(`/api/users/status?status_val=${newStatus}`);
      if (res.data?.auto_connected_call) {
        showToast("Inbound Call Connected!", "success");
      } else {
        showToast(`Agent Status Updated: ${newStatus.replace("_", " ").toUpperCase()}`, "info");
      }
    } catch (err) {
      console.warn("Status patch warning:", err);
    }
  };

  const handleAnswerRingingCall = () => {
    plivoWebRTC.answer(incomingCall?.id);
    answeredStartTimeRef.current = Date.now();
    setCallStatus("answering");
    setAgentStatus("on_call");
    setCallDuration(0);
    showToast(`Inbound Call Accepted`, "success");
  };

  const handleRejectRingingCall = () => {
    plivoWebRTC.reject();
    setCallStatus("ready");
    setAgentStatus("ready");
    setIncomingCall(null);
    ringingStartTimeRef.current = null;
    showToast("Call rejected", "info");
  };

  // AUTO-CONNECT QUEUED CALL WHEN AGENT BECOMES READY (ONLY IF AUTO-ANSWER ENABLED BY AGENT)
  useEffect(() => {
    if (autoAnswerEnabled && agentStatus === "ready" && callStatus === "ready" && inboundQueue.length > 0) {
      const nextCall = inboundQueue[0];
      showToast(`Inbound Call Connected: ${nextCall.name} (+91 ${nextCall.phone})`, "success");
      connectInboundCall(nextCall);
    }
  }, [autoAnswerEnabled, agentStatus, callStatus, inboundQueue, connectInboundCall]);

  // QUEUE WAIT TIME TIMER
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (inboundQueue.length > 0) {
      interval = setInterval(() => {
        setQueueWaitSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setQueueWaitSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [inboundQueue.length]);

  // Manual Answer Fallback
  const handleInboundAnswer = () => {
    if (inboundQueue.length > 0) {
      connectInboundCall(inboundQueue[0]);
    } else {
      handleInboundACDCall(outboundPhone, selectedLead?.name);
    }
  };

  // Call Initiation
  const handleDial = useCallback(async (overrideMode?: "human" | "ai", simSlot: "sim1" | "sim2" = "sim1") => {
    if (!isValidMobile) return;
    if (isDialingRef.current || isDialing) return;
    if (callStatusRef.current !== "ready") return;

    const targetMode = overrideMode || callMode;
    setCallMode(targetMode);

    if (myStatus === "offline") {
      try {
        await setPresenceStatus("ready", undefined, true);
      } catch (err) {
        console.warn("[Dialer] Auto ready transition on dial:", err);
      }
    }

    isDialingRef.current = true;
    setIsDialing(true);
    callEndReasonRef.current = "";

    const cleanNumber = sanitizeMobileNumber(outboundPhone);
    const fullPhoneNumber = `+91${cleanNumber}`;
    const idempotencyKey = `${user?.id || 'agent'}_${cleanNumber}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    setIsCreatingLead(true);
    setCallStatus("dialing");
    setAgentStatus("on_call");
    setCallDuration(0);
    setIsMuted(false);
    setIsSpeaker(false);

    let matchedLead = selectedLead || leads.find(l => {
      const cleanL = l.phone.replace(/\D/g, "");
      const cleanTarget = fullPhoneNumber.replace(/\D/g, "");
      return cleanL === cleanTarget;
    });

    if (!matchedLead) {
      try {
        const res = await api.post("/api/leads", {
          name: `Manual Lead - ${cleanNumber}`,
          phone: fullPhoneNumber,
          pool_id: user?.pool_id || leads[0]?.pool_id || "6a6b40b7841e208e1cb69469",
          source: "Manual Dialer"
        });
        matchedLead = res;
        fetchLeads();
      } catch (err: any) {
        console.warn("[Dialer] Lead lookup/creation notice:", err);
      }
    }
    if (matchedLead) {
      setSelectedLead(matchedLead);
    }

    setIsCreatingLead(false);

    // AI Call Mode
    if (targetMode === "ai") {
      try {
        const res = await api.post("/api/calls/vapi-dial", {
          phone: fullPhoneNumber,
          name: matchedLead?.name || `Manual Lead - ${cleanNumber}`,
          pool_id: matchedLead?.pool_id || user?.pool_id || "general",
          idempotency_key: idempotencyKey,
          sim_slot: simSlot
        });
        setCurrentCallId(res.id || res._id || res.call_id || null);
        setCallStatus("connected");
        setAgentStatus("on_call");
        setCallDuration(0);
        setOutboundPhone(""); // Reset number ONLY after call request is successfully created
        autoDialLockRef.current = "";
        fetchLeads();
        fetchCallHistory();
        showToast(`Vapi AI Voice Agent call initiated on ${simSlot === "sim2" ? "SIM 2" : "SIM 1"}`, "success");
        return;
      } catch (err: any) {
        const msg = err?.response?.data?.detail || (typeof err.message === "string" ? err.message : "Vapi AI Call Failed");
        showToast(msg, "error");
        setCallStatus("ready");
        setAgentStatus("ready");
        autoDialLockRef.current = "";
        return;
      } finally {
        isDialingRef.current = false;
        setIsDialing(false);
      }
    }

    // Human Agent Call via Plivo WebRTC Browser SDK (Direct Web Microphone)
    try {
      const webrtcSuccess = await plivoWebRTC.makeCall(fullPhoneNumber);
      const res = await api.post("/api/calls/manual-dial", {
        phone: fullPhoneNumber,
        pool_id: matchedLead?.pool_id || user?.pool_id || "general",
        language: "english",
        agent_assign_mode: "manual",
        assigned_agent_id: user?.id,
        priority: "high",
        notes: "",
        initiate_pstn: !webrtcSuccess,
        idempotency_key: idempotencyKey,
        call_mode: targetMode,
        sim_slot: simSlot
      });
      setCurrentCallId(res.id || res._id || res.call_id || null);
      setCallStatus("ringing");
      ringingStartTimeRef.current = Date.now();
      setRingingDuration(0);
      autoDialLockRef.current = "";
      if (webrtcSuccess) {
        showToast(`In-browser WebRTC call initiated to ${fullPhoneNumber} via Plivo…`, "info");
      } else {
        showToast(`PSTN call initiated to ${fullPhoneNumber} via Plivo…`, "info");
      }
      fetchLeads();
      fetchCallHistory();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || (typeof err.message === "string" ? err.message : "Failed to start call");
      showToast(msg, "error");
      setCallStatus("ready");
      setAgentStatus("ready");
      autoDialLockRef.current = "";
    } finally {
      isDialingRef.current = false;
      setIsDialing(false);
    }
  }, [isValidMobile, isDialing, callMode, myStatus, setPresenceStatus, outboundPhone, selectedLead, leads, fetchLeads, user, fetchCallHistory, showToast, sanitizeMobileNumber]);

  handleDialRef.current = handleDial;

  const handleHangup = useCallback(() => {
    if (callStatus === "ready") return;

    try {
      plivoWebRTC.hangup();
    } catch (err) {
      console.warn("Plivo WebRTC hangup error:", err);
    }

    setIsMuted(false);
    setIsSpeaker(false);
    isDialingRef.current = false;
    setIsDialing(false);

    if (callStatus === "dialing" || callStatus === "ringing") {
      setCallStatus("ready");
      setAgentStatus("ready");
      setCallDuration(0);
      setRingingDuration(0);
      ringingStartTimeRef.current = null;
      answeredStartTimeRef.current = null;
      audioRecorder.stopRecording().catch(() => {});
      if (currentCallId) {
        api.post(`/api/calls/${currentCallId}/manual-end`, {
          call_id: currentCallId,
          outcome: "cancelled",
          duration_seconds: 0,
          notes: notes || "Call cancelled during ringing"
        }).catch((err) => console.warn("Backend cancel call notice:", err));
      }
    } else {
      setCallStatus("wrapup");
      setAgentStatus("wrap_up");
      setActiveTab("outbound");
      wrapUpStartTimeRef.current = Date.now();
      setWrapUpDuration(0);
      if (currentCallId) {
        audioRecorder.stopAndUpload(currentCallId, callDuration, {
          lead_id: selectedLead?._id,
          agent_id: user?.id,
          outcome: "answered",
          notes: notes || "Call ended by agent"
        }).then((res) => {
          if (res?.secure_url) {
            fetchCallHistory();
          }
        }).catch(() => {});

        api.post(`/api/calls/${currentCallId}/manual-end`, {
          call_id: currentCallId,
          outcome: "answered",
          duration_seconds: callDuration,
          notes: notes || "Call ended by agent"
        }).catch((err) => console.warn("Backend end-call notice:", err));
      }
    }
  }, [callStatus, currentCallId, callDuration, notes, selectedLead, user, fetchCallHistory]);

  // REAL-TIME CALL LIFECYCLE EVENT TRACKER
  const pushCallTimelineEvent = useCallback((
    type: CallEventType,
    title: string,
    description: string,
    dotColor?: string
  ) => {
    const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const eventItem: CallEventItem = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: timeStr,
      title,
      description,
      type,
      dotColor
    };

    if (currentCallId) {
      api.post(`/api/calls/${currentCallId}/events`, eventItem).catch(() => {});
      setCallHistory(prev => prev.map(c => {
        if (c.id === currentCallId || c._id === currentCallId) {
          const existingEvents = Array.isArray(c.events) ? c.events : [];
          return { ...c, events: [...existingEvents, eventItem] };
        }
        return c;
      }));
    }
  }, [currentCallId]);

  const handleMuteToggle = useCallback(async () => {
    if (callStatus !== "connected" && callStatus !== "hold") {
      showToast("Mute is only available during an active call", "warning");
      return;
    }
    if (isMuteLoading) return;

    const nextMuted = !isMuted;
    setIsMuteLoading(true);
    setIsMuted(nextMuted);

    // Apply directly to WebRTC microphone audio tracks
    plivoWebRTC.setMuted(nextMuted);

    pushCallTimelineEvent(
      "mute",
      nextMuted ? "Agent Muted Audio" : "Agent Unmuted Audio",
      nextMuted ? "Microphone input muted" : "Audio channel unmuted",
      "bg-orange-500 ring-4 ring-orange-100 dark:ring-orange-900/30"
    );

    try {
      if (currentCallId) {
        await api.post(`/api/calls/${currentCallId}/manual-action`, {
          action: nextMuted ? "mute" : "unmute"
        });
      }
      showToast(nextMuted ? "Microphone Muted" : "Microphone Active", "info");
    } catch (err: any) {
      console.warn("Backend mute sync notice:", err);
    } finally {
      setIsMuteLoading(false);
    }
  }, [isMuted, callStatus, currentCallId, isMuteLoading, pushCallTimelineEvent]);

  const handleHoldToggle = useCallback(async () => {
    if (callStatus !== "connected" && callStatus !== "hold") {
      showToast("Hold is only available during an active call", "warning");
      return;
    }
    if (isHoldLoading || isHoldProcessing) return;

    const isCurrentlyHold = callStatus === "hold";
    const targetAction = isCurrentlyHold ? "resume" : "hold";
    const prevStatus = callStatus;

    setIsHoldLoading(true);
    setIsHoldProcessing(true);

    // Apply directly to WebRTC audio pipeline
    plivoWebRTC.setHold(!isCurrentlyHold);

    try {
      if (currentCallId) {
        await api.post(`/api/calls/${currentCallId}/manual-action`, {
          action: targetAction
        });
      }
      const finalStatus = isCurrentlyHold ? "connected" : "hold";
      setCallStatus(finalStatus);
      pushCallTimelineEvent(
        "hold",
        isCurrentlyHold ? "Call Resumed" : "Call Placed on Hold",
        isCurrentlyHold ? "Audio channel resumed on Line 1" : "Call held on Line 1 by agent",
        isCurrentlyHold ? "bg-emerald-500 ring-4 ring-emerald-100 dark:ring-emerald-900/30" : "bg-orange-500 ring-4 ring-orange-100 dark:ring-orange-900/30"
      );
      showToast(isCurrentlyHold ? "Call Resumed" : "Call Placed on Hold", "success");
    } catch (err: any) {
      setCallStatus(prevStatus);
      plivoWebRTC.setHold(isCurrentlyHold);
      showToast(err.message || `Failed to ${targetAction} call session`, "error");
    } finally {
      setIsHoldLoading(false);
      setIsHoldProcessing(false);
    }
  }, [callStatus, currentCallId, isHoldLoading, isHoldProcessing, pushCallTimelineEvent]);

  const handleToggleSpeaker = useCallback(() => {
    const nextSpeaker = !isSpeaker;
    setIsSpeaker(nextSpeaker);
    plivoWebRTC.setSpeakerMuted(!nextSpeaker);
    showToast(nextSpeaker ? "Speaker Output Enabled" : "Speaker Output Muted", "info");
  }, [isSpeaker]);

  const handleTransferCall = async () => {
    if (!transferTarget.trim()) return;
    setIsTransferring(true);
    try {
      if (currentCallId) {
        await api.post(`/api/calls/${currentCallId}/transfer`, { target: transferTarget });
        pushCallTimelineEvent(
          "transfer",
          "Call Transfer Initiated",
          `Transferring live call session to extension/agent ${transferTarget}`,
          "bg-indigo-500 ring-4 ring-indigo-100 dark:ring-indigo-900/30"
        );
        showToast(`Call transfer initiated to ${transferTarget}`, "success");
        setShowTransferModal(false);
        setTransferTarget("");
      }
    } catch (err: any) {
      showToast(err.message || "Failed to transfer call", "error");
    } finally {
      setIsTransferring(false);
    }
  };

  // SAVE DISPOSITION & NEXT LEAD AUTO-SELECTION
  const handleSaveAndNext = async () => {
    if (!disposition) {
      showToast("Please select a call disposition before submitting", "warning");
      return;
    }

    if (disposition === "call_back") {
      if (!followUpDate || !followUpTime) {
        showToast("Please provide both follow-up date and time for Call Back", "warning");
        return;
      }
      if (!isFutureISTDateTime(followUpDate, followUpTime)) {
        showToast("Follow-up date & time must be in the future (Asia/Kolkata timezone)", "error");
        return;
      }
    }

    setIsSavingOutcome(true);
    try {
      const combinedFollowUp = followUpDate && followUpTime ? `${followUpDate} ${followUpTime}` : (followUpDate || "");

      // Step 1: Save call disposition in backend
      if (currentCallId) {
        await api.post(`/api/calls/${currentCallId}/disposition`, {
          disposition,
          duration_seconds: callDuration,
          notes,
          follow_up_date: followUpDate,
          follow_up_time: followUpTime
        });
      }

      // Step 2: Ensure persistent follow-up is saved and indexed in follow_ups collection
      if (disposition === "call_back" || followUpDate) {
        try {
          await api.post("/api/follow-ups", {
            customer_id: selectedLead?._id,
            lead_id: selectedLead?._id,
            customer_name: selectedLead?.name || "Customer",
            customer_phone: outboundPhone || selectedLead?.phone || "",
            agent_id: user?.id,
            pool_id: selectedLead?.pool_id,
            call_id: currentCallId || undefined,
            follow_up_datetime: combinedFollowUp,
            follow_up_date: followUpDate,
            follow_up_time: followUpTime,
            time_zone: "Asia/Kolkata",
            reason: notes || "Call Back Scheduled from Dialer",
            notes
          });
        } catch (fErr) {
          console.warn("[Dialer] Follow-up direct persistence notice:", fErr);
        }
      }


      // Step 2: Update lead status in real time if selected
      if (selectedLead?._id) {
        let newLeadStatus = "new";
        if (disposition === "interested" || disposition === "converted") newLeadStatus = "closed";
        else if (disposition === "not_interested") newLeadStatus = "closed";
        else if (disposition === "follow_up_required" || disposition === "call_back") newLeadStatus = "follow_up_required";
        else if (disposition === "dnc") newLeadStatus = "closed";

        try {
          await api.patch(`/api/leads/${selectedLead._id}/disposition`, {
            status: newLeadStatus,
            notes,
            follow_up_date: combinedFollowUp,
            follow_up_time: followUpTime
          });
        } catch (err) {
          console.warn("Lead patch warning:", err);
        }
      }

      showToast("Call disposition saved & session closed", "success");

      // Step 3: Find next assigned lead automatically
      const currentIdx = leads.findIndex(l => l._id === selectedLead?._id);
      let nextLead: Lead | null = null;
      if (currentIdx !== -1 && currentIdx < leads.length - 1) {
        nextLead = leads[currentIdx + 1];
      } else {
        // Find first pending/new lead
        nextLead = leads.find(l => l._id !== selectedLead?._id && (l.status === "new" || l.status === "pending")) || leads[0] || null;
      }

      // Reset state for next call
      setIncomingCall(null);
      setCallStatus("ready");
      setAgentStatus("ready");
      setCurrentCallId(null);
      setDisposition("");
      setNotes("");
      setFollowUpDate("");
      setFollowUpTime("");
      setCallDuration(0);
      setRingingDuration(0);
      setWrapUpDuration(0);
      ringingStartTimeRef.current = null;
      answeredStartTimeRef.current = null;
      wrapUpStartTimeRef.current = null;

      try {
        await setPresenceStatus("ready", undefined, true);
      } catch (e) {
        // ignore fallback
      }

      if (nextLead) {
        handleSelectLead(nextLead);
        showToast(`Next Lead Selected: ${nextLead.name}`, "info");
      } else {
        setSelectedLead(null);
        setOutboundPhone("");
      }

      fetchLeads();
      fetchCallHistory();
      fetchFollowUps("all");
      fetchFollowUpStats();
    } catch (err: any) {
      showToast(err.message || "Failed to save call disposition", "error");
    } finally {
      setIsSavingOutcome(false);
    }
  };

  const handleQuickCall = async (leadOrPhone: Lead | string) => {
    if (callStatus !== "ready" || isDialing || isDialingRef.current) return;

    let targetPhone = "";
    let targetName = "";
    let targetPoolId = "";
    let targetLeadId = "";

    if (typeof leadOrPhone === "string") {
      targetPhone = leadOrPhone;
    } else if (leadOrPhone && typeof leadOrPhone === "object") {
      targetPhone = leadOrPhone.phone;
      targetName = leadOrPhone.name;
      targetPoolId = leadOrPhone.pool_id || "";
      targetLeadId = leadOrPhone._id;
      setSelectedLead(leadOrPhone);
    }

    const sanitized = sanitizeMobileNumber(targetPhone);
    if (!sanitized || sanitized.length < 10) {
      showToast("Enter a valid 10-digit Indian mobile number before placing Quick Call", "error");
      return;
    }

    setOutboundPhone(sanitized);
    setCallMode("ai");
    setQuickCallingLeadId(targetLeadId || "active");
    setActiveSlideOver("dialer");
    isDialingRef.current = true;
    setIsDialing(true);
    setCallStatus("dialing");
    setAgentStatus("on_call");
    setCallDuration(0);
    setIsMuted(false);
    setIsSpeaker(false);

    const fullPhoneNumber = `+91${sanitized}`;
    const idempotencyKey = `quick_${user?.id || 'agent'}_${sanitized}_${Date.now()}`;

    try {
      const res = await api.post("/api/calls/vapi-dial", {
        phone: fullPhoneNumber,
        name: targetName || `Quick Lead - ${sanitized}`,
        pool_id: targetPoolId || user?.pool_id || "general",
        idempotency_key: idempotencyKey
      });

      if (res && res.success !== false) {
        const vapiCallId = res.callId || res.vapi_call_id || res.id || res._id || "vapi-call";
        setCurrentCallId(res.id || res._id || res.call_id || vapiCallId);
        setCallStatus("connected");
        setAgentStatus("on_call");
        setCallDuration(0);
        showToast(res.message || `Vapi AI Call connected (ID: ${vapiCallId})`, "success");
      } else {
        const errMsg = res?.details || res?.error || "Vapi Call creation failed";
        showToast(errMsg, "error");
        setCallStatus("ready");
        setAgentStatus("ready");
      }
    } catch (err: any) {
      showToast(err.message || "Failed to initiate Vapi Quick Call", "error");
      setCallStatus("ready");
      setAgentStatus("ready");
    } finally {
      setQuickCallingLeadId(null);
      isDialingRef.current = false;
      setIsDialing(false);
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const formatDate = (ds: string) => {
    if (!ds) return "N/A";
    return new Date(ds).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return "0s";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  const formatCallTime = (dateStr?: string) => {
    if (!dateStr) return "Just now";
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const timeFormatted = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) return `Today, ${timeFormatted}`;
      return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeFormatted}`;
    } catch {
      return dateStr;
    }
  };

  const filteredCallHistory = useMemo(() => {
    if (!historySearchQuery.trim()) return callHistory;
    const q = historySearchQuery.toLowerCase();
    return callHistory.filter((item) => {
      const phoneMatch = (item.phone || item.phone_number || "").toLowerCase().includes(q);
      const nameMatch = (item.lead_name || "").toLowerCase().includes(q);
      const outcomeMatch = (item.outcome || item.status || "").toLowerCase().includes(q);
      return phoneMatch || nameMatch || outcomeMatch;
    });
  }, [callHistory, historySearchQuery]);

  const renderOutcomeBadge = (outcomeStr?: string) => {
    const norm = (outcomeStr || "completed").toLowerCase();
    if (norm === "qualified" || norm === "answered" || norm === "connected" || norm === "converted" || norm === "interested") {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 inline-flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {norm.replace("_", " ")}
        </span>
      );
    }
    if (norm === "no_answer" || norm === "no-answer" || norm === "busy" || norm === "failed" || norm === "wrong_number") {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30 inline-flex items-center gap-1">
          <XCircle className="h-3 w-3" />
          {norm.replace("_", " ")}
        </span>
      );
    }
    if (norm === "not_interested" || norm === "dnc") {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-500/30 inline-flex items-center gap-1">
          {norm.replace("_", " ")}
        </span>
      );
    }
    if (norm === "follow_up_required" || norm === "call_back" || norm === "follow_up") {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30 inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {norm.replace("_", " ")}
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10 inline-flex items-center gap-1">
        {norm.replace("_", " ")}
      </span>
    );
  };

  // Render 3x4 Numeric Keypad
  const renderKeypad = () => (
    <div className="grid grid-cols-3 gap-2 w-full max-w-[260px] mx-auto my-2">
      {[
        { d: "1", l: "" }, { d: "2", l: "ABC" }, { d: "3", l: "DEF" },
        { d: "4", l: "GHI" }, { d: "5", l: "JKL" }, { d: "6", l: "MNO" },
        { d: "7", l: "PQRS" }, { d: "8", l: "TUV" }, { d: "9", l: "WXYZ" },
        { d: "*", l: "" }, { d: "0", l: "+" }, { d: "#", l: "" }
      ].map((key) => (
        <button
          key={key.d}
          type="button"
          onClick={() => handleKeypadPress(key.d)}
          disabled={callStatus !== "ready" && callStatus !== "connected"}
          className="h-11 w-full flex flex-col items-center justify-center rounded-xl bg-white dark:bg-[#1A2438] border border-slate-200 dark:border-white/10 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-500/10 active:scale-95 transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed select-none shadow-2xs"
        >
          <span className="text-base font-extrabold text-slate-900 dark:text-white leading-none">
            {key.d}
          </span>
          {key.l && (
            <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 tracking-wider leading-none mt-0.5 uppercase">
              {key.l}
            </span>
          )}
        </button>
      ))}
    </div>
  );

  // Helper to render softphone dialer inside slide-over drawer
  const renderDialerPanel = () => (
    <div className="w-full bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-white/10 p-4 flex flex-col justify-between shadow-xs">
      {/* Dialer Header */}
      <div className="w-full">
        <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 dark:border-white/10 mb-3">
          <div className="flex items-center gap-2">
            <PhoneCall className="h-4.5 w-4.5 text-amber-500" />
            <h2 className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
              MANUAL DIALER
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Microphone Connection Status Badge */}
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
              mediaDiagnostics?.micPermission && mediaDiagnostics?.localTrackLive
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                mediaDiagnostics?.micPermission && mediaDiagnostics?.localTrackLive ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
              }`} />
              <span>{mediaDiagnostics?.micPermission && mediaDiagnostics?.localTrackLive ? "Mic: Connected" : "Mic: Not available"}</span>
            </div>

            {/* Call Media Debug Panel Toggle */}
            <button
              type="button"
              onClick={() => setShowDebugPanel(!showDebugPanel)}
              className="p-1 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              title="Toggle Call Media Debug Panel"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </button>

            <span className={`text-[9px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider border ${
              agentStatus === "ready" ? "bg-emerald-50 text-emerald-600 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-400" :
              agentStatus === "on_call" ? "bg-amber-50 text-amber-600 border-amber-300 dark:bg-amber-500/15 dark:text-amber-400 animate-pulse" :
              agentStatus === "wrap_up" ? "bg-purple-50 text-purple-600 border-purple-300 dark:bg-purple-500/15 dark:text-purple-400" :
              "bg-rose-50 text-rose-600 border-rose-300 dark:bg-rose-500/15 dark:text-rose-400"
            }`}>
              {agentStatus === "ready" ? "READY" : agentStatus.replace("_", " ")}
            </span>
          </div>
        </div>

        {/* Audio Device Selection Dropdowns */}
        {showDebugPanel && (
          <div className="mb-3 p-2.5 bg-slate-50 dark:bg-[#172033] rounded-xl border border-slate-200 dark:border-white/10 space-y-2 text-xs">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Microphone Input</label>
              <select
                value={selectedAudioInput}
                onChange={(e) => {
                  setSelectedAudioInput(e.target.value);
                  plivoWebRTC.setAudioInputDevice(e.target.value);
                }}
                className="w-full h-7 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-white/10 text-xs px-2"
              >
                <option value="default">Default Microphone</option>
                {audioInputDevices.map((dev) => (
                  <option key={dev.deviceId} value={dev.deviceId}>
                    {dev.label || `Microphone ${dev.deviceId.slice(0, 5)}`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Speaker Output</label>
              <select
                value={selectedAudioOutput}
                onChange={(e) => {
                  setSelectedAudioOutput(e.target.value);
                  plivoWebRTC.setAudioOutputDevice(e.target.value);
                }}
                className="w-full h-7 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-white/10 text-xs px-2"
              >
                <option value="default">Default Speaker</option>
                {audioOutputDevices.map((dev) => (
                  <option key={dev.deviceId} value={dev.deviceId}>
                    {dev.label || `Speaker ${dev.deviceId.slice(0, 5)}`}
                  </option>
                ))}
              </select>
            </div>

            {/* CALL MEDIA DEBUG DRAWER */}
            <div className="pt-2 border-t border-slate-200 dark:border-white/10 font-mono text-[11px] space-y-1.5">
              <div className="flex items-center justify-between font-bold text-amber-500">
                <span>CALL MEDIA DEBUG</span>
                <span>WebRTC: {webrtcState}</span>
              </div>

              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                <div>Mic Perm: {mediaDiagnostics?.micPermission ? "✓ Granted" : "✗ Denied"}</div>
                <div>Local Stream: {mediaDiagnostics?.localStream ? "✓ Active" : "✗ None"}</div>
                <div>Local Track: {mediaDiagnostics?.localAudioTracks > 0 ? "✓ Live" : "✗ 0"}</div>
                <div>Remote Stream: {mediaDiagnostics?.remoteStream ? "✓ Received" : "⏳ Waiting"}</div>
                <div>Remote Track: {mediaDiagnostics?.remoteAudioTracks > 0 ? "✓ Live" : "⏳ 0"}</div>
                <div>Playback: {mediaDiagnostics?.audioElementPlaying ? "✓ Playing" : "⏳ Ready"}</div>
              </div>
            </div>
          </div>
        )}

        {/* Selected Customer Info */}
        {selectedLead && (
          <div className="mb-2.5 p-2.5 bg-blue-50/70 dark:bg-blue-500/10 rounded-xl border border-blue-200 dark:border-blue-500/20">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-wider">Selected Customer</p>
                <p className="text-xs font-extrabold text-slate-900 dark:text-white mt-0.5">{selectedLead.name}</p>
                <p className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300">{maskPhoneNumber(selectedLead.phone)}</p>
              </div>
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                {selectedLead.source || "Manual"}
              </span>
            </div>
          </div>
        )}

        {/* Mobile Number Input Box */}
        <div className="mb-2.5">
          <label className="block text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
            TARGET MOBILE NUMBER
          </label>
          <div className="relative h-[46px] flex items-center bg-slate-50/90 dark:bg-[#172033] border border-slate-200 dark:border-white/10 rounded-xl px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
            <input
              type="text"
              inputMode="numeric"
              maxLength={10}
              value={outboundPhone}
              onChange={(e) => {
                if (callStatus !== "ready") return;
                setOutboundPhone(sanitizeMobileNumber(e.target.value));
              }}
              readOnly={callStatus !== "ready"}
              placeholder="Enter 10-digit number"
              className="w-full bg-transparent text-center font-mono font-extrabold text-base text-slate-900 dark:text-white outline-none tracking-widest placeholder:text-slate-400 placeholder:text-xs placeholder:font-sans placeholder:font-medium placeholder:tracking-normal"
            />
            {callStatus === "ready" && outboundPhone.length > 0 && (
              <button
                type="button"
                onClick={() => setOutboundPhone("")}
                className="h-6 w-6 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/60 flex items-center justify-center cursor-pointer transition shrink-0 ml-1"
                title="Clear number"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mt-1 text-center">
            {outboundPhone.length > 0 && !isValidMobile ? (
              <p className="text-[10px] font-bold text-rose-500 flex items-center justify-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span>Must be 10 digits starting with 6-9</span>
              </p>
            ) : (
              <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                Enter 10-digit mobile number
              </p>
            )}
          </div>
        </div>

        {/* Keypad */}
        {callStatus === "ready" && renderKeypad()}

        {/* Calling / Ringing */}
        {(callStatus === "dialing" || callStatus === "ringing") && (
          <div className="my-5 text-center">
            <div className="relative h-16 w-16 mx-auto mb-2">
              <div className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping" />
              <div className="relative h-16 w-16 rounded-full bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                {callStatus === "dialing" ? (
                  <Loader2 className="h-8 w-8 text-white animate-spin" />
                ) : (
                  <Phone className="h-8 w-8 text-white animate-bounce" />
                )}
              </div>
            </div>
            <p className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
              {callStatus === "dialing" ? "Initiating Call..." : "Ringing Customer..."}
            </p>
            <p className="text-xs font-mono font-bold text-slate-500 mt-0.5">{maskPhoneNumber(outboundPhone)}</p>
          </div>
        )}

        {/* Connected / Hold */}
        {(callStatus === "connected" || callStatus === "hold") && (
          <div className="my-3 text-center">
            <div className={`h-14 w-14 rounded-full mx-auto flex items-center justify-center mb-1.5 border-2 ${
              callStatus === "hold"
                ? "bg-amber-500/10 border-amber-500 text-amber-500"
                : "bg-emerald-500/10 border-emerald-500 text-emerald-500"
            }`}>
              {callStatus === "hold" ? <Pause className="h-7 w-7 animate-pulse" /> : <User className="h-7 w-7" />}
            </div>
            <p className="text-xs font-extrabold text-slate-900 dark:text-white">
              {callStatus === "hold" ? "Call On Hold" : "Connected Live"}
            </p>
            <p className="text-base font-black font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
              {formatTime(callDuration)}
            </p>

            {showInCallKeypad && renderKeypad()}
          </div>
        )}

        {/* Wrap-up Disposition */}
        {callStatus === "wrapup" && (
          <WrapUpPanel
            lead={selectedLead}
            phone={outboundPhone}
            maskedPhone={maskPhoneNumber(outboundPhone || selectedLead?.phone)}
            callDuration={callDuration}
            callDirection={dialerMode}
            wrapUpDuration={wrapUpDuration}
            disposition={disposition}
            setDisposition={setDisposition}
            followUpDate={followUpDate}
            setFollowUpDate={setFollowUpDate}
            followUpTime={followUpTime}
            setFollowUpTime={setFollowUpTime}
            notes={notes}
            setNotes={setNotes}
            isSavingOutcome={isSavingOutcome}
            onSaveAndNext={handleSaveAndNext}
            formatTime={formatTime}
          />
        )}
      </div>

      {/* Action Buttons Bar */}
      <div className="w-full mt-2 pt-2 border-t border-slate-100 dark:border-white/10">
        {callStatus === "ready" && (
          <button
            type="button"
            onClick={() => setShowCallMethodModal(true)}
            disabled={!isValidMobile || isCreatingLead || isDialing}
            className="w-full h-[46px] bg-[#10B981] hover:bg-[#059669] text-white rounded-xl font-extrabold text-sm shadow-xs transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
          >
            {isDialing || isCreatingLead ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Starting Call...
              </>
            ) : (
              <>
                <Phone className="h-4 w-4 fill-current" /> Call Customer
              </>
            )}
          </button>
        )}

        {(callStatus === "dialing" || callStatus === "ringing") && (
          <button
            onClick={handleHangup}
            className="w-full bg-rose-600 hover:bg-rose-700 text-white rounded-xl py-3 font-extrabold text-xs shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
          >
            <PhoneOff className="h-4 w-4 fill-current" /> Cancel Dialing
          </button>
        )}

        {(callStatus === "connected" || callStatus === "hold") && (
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-1.5">
              <button
                onClick={handleMuteToggle}
                disabled={isMuteLoading}
                className={`p-2 rounded-xl border flex flex-col items-center justify-center gap-1 transition cursor-pointer active:scale-95 ${
                  isMuted
                    ? "bg-amber-500 text-white border-amber-600"
                    : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300"
                }`}
                title="Mute/Unmute Mic"
              >
                {isMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                <span className="text-[8px] font-black uppercase">{isMuted ? "Muted" : "Mute"}</span>
              </button>

              <button
                onClick={handleHoldToggle}
                disabled={isHoldLoading || isHoldProcessing}
                className={`p-2 rounded-xl border flex flex-col items-center justify-center gap-1 transition cursor-pointer active:scale-95 ${
                  callStatus === "hold"
                    ? "bg-amber-500 text-white border-amber-600"
                    : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300"
                }`}
                title="Hold/Resume Call"
              >
                {callStatus === "hold" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                <span className="text-[8px] font-black uppercase">{callStatus === "hold" ? "Resume" : "Hold"}</span>
              </button>

              <button
                onClick={() => setShowInCallKeypad(!showInCallKeypad)}
                className={`p-2 rounded-xl border flex flex-col items-center justify-center gap-1 transition cursor-pointer active:scale-95 ${
                  showInCallKeypad
                    ? "bg-blue-600 text-white border-blue-700"
                    : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300"
                }`}
                title="Keypad DTMF"
              >
                <Hash className="h-3.5 w-3.5" />
                <span className="text-[8px] font-black uppercase">Keypad</span>
              </button>

              <button
                onClick={() => setShowTransferModal(true)}
                className="p-2 rounded-xl border bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 flex flex-col items-center justify-center gap-1 transition cursor-pointer active:scale-95"
                title="Transfer Call"
              >
                <PhoneForwarded className="h-3.5 w-3.5" />
                <span className="text-[8px] font-black uppercase">Transfer</span>
              </button>
            </div>

            <button
              onClick={handleHangup}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white rounded-xl py-3 font-black text-xs shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
            >
              <PhoneOff className="h-4 w-4 fill-current" /> End Call
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 max-w-[1700px] mx-auto h-[calc(100vh-85px)] flex flex-col font-sans pb-4">

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden min-h-0">
        <AnimatePresence mode="wait">

          {/* ---------------- OUTBOUND BPO WORKSPACE TAB ---------------- */}
          {activeTab === "outbound" && (
            <motion.div
              key="outbound"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="h-full flex flex-col gap-3"
            >
              {/* ── FULL-WIDTH SOFTPHONE DIALER WORKSPACE ── */}
              <div className="w-full flex-1 flex flex-col gap-3 overflow-hidden h-full min-w-0">

                {/* Primary Softphone Dialer Workstation Box */}
                <div className="bg-white dark:bg-[#111827] rounded-[12px] border border-slate-200 dark:border-white/10 p-3.5 sm:p-4 flex-1 flex flex-col items-center overflow-y-auto no-scrollbar shadow-2xs relative w-full">

                  {/* BPO AGENT DIALER CONSOLE HEADER */}
                  <div className="w-full bg-white dark:bg-[#182233] border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 sm:p-5 shadow-2xs mb-4">
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-2xl bg-blue-50 dark:bg-blue-500/15 text-[#2563EB] dark:text-[#3B82F6] flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-500/20 shadow-2xs">
                          <Headphones className="h-5 w-5 text-[#2563EB] dark:text-[#3B82F6]" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <h1 className="text-lg font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-1.5">
                              Agent <span className="text-[#F4B400]">Dialer Console</span>
                            </h1>
                            {(() => {
                              const badge = getStatusBadgeDetails(myStatus, pauseReason, isCheckedInToday);
                              return (
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${badge.colorClass}`}>
                                  <span className={`h-2 w-2 rounded-full ${badge.dotClass}`} />
                                  Agent {badge.label}
                                </span>
                              );
                            })()}

                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                              webrtcState === "READY" || webrtcState === "CONNECTED" || webrtcState === "MEDIA_CONNECTED"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30"
                                : webrtcState === "REGISTERING"
                                ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30"
                                : "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/30"
                            }`}>
                              <span className={`h-2 w-2 rounded-full ${
                                webrtcState === "READY" || webrtcState === "CONNECTED" || webrtcState === "MEDIA_CONNECTED"
                                  ? "bg-emerald-500 animate-pulse"
                                  : webrtcState === "REGISTERING"
                                  ? "bg-amber-500 animate-pulse"
                                  : "bg-slate-400"
                              }`} />
                              {webrtcState === "READY" ? "READY FOR CALLS" : webrtcState === "REGISTERING" ? "REGISTERING SDK..." : webrtcState === "IDLE" ? "SDK IDLE" : webrtcState}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                            Assigned Queue &amp; Softphone Workspace • Real-Time Session Sync
                          </p>
                        </div>
                      </div>

                      {/* AGENT PRESENCE ACTION CONTROLS */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {myStatus === "offline" && isCheckedInToday && (
                          <button
                            type="button"
                            onClick={() => setPresenceStatus("ready").catch((e: any) => showToast(e.message || "Failed to set status to Ready", "error"))}
                            disabled={isSubmittingStatus}
                            className="h-8 sm:h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition active:scale-95"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Set Ready</span>
                          </button>
                        )}

                        {myStatus === "ready" && (
                          <>
                            <button
                              type="button"
                              onClick={() => setShowPauseModal(true)}
                              disabled={isSubmittingStatus || callStatus === "ringing" || callStatus === "connected" || callStatus === "hold" || callStatus === "wrapup"}
                              className="h-8 sm:h-9 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-extrabold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition active:scale-95"
                            >
                              <Coffee className="h-3.5 w-3.5" />
                              <span>Take Break</span>
                            </button>

                            <button
                              type="button"
                              onClick={handleGoOfflineClick}
                              disabled={isSubmittingStatus || callStatus === "ringing" || callStatus === "connected" || callStatus === "hold" || callStatus === "wrapup"}
                              className="h-8 sm:h-9 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-900/30 text-slate-700 dark:text-slate-200 hover:text-rose-600 dark:hover:text-rose-400 border border-slate-200 dark:border-white/10 font-extrabold text-xs flex items-center gap-1.5 cursor-pointer transition active:scale-95"
                            >
                              <PhoneOff className="h-3.5 w-3.5" />
                              <span>Go Offline</span>
                            </button>
                          </>
                        )}

                        {myStatus === "paused" && (
                          <>
                            <button
                              type="button"
                              onClick={() => setPresenceStatus("ready").catch((e: any) => showToast(e.message || "Failed to resume work", "error"))}
                              disabled={isSubmittingStatus}
                              className="h-8 sm:h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition active:scale-95"
                            >
                              <Play className="h-3.5 w-3.5 fill-current" />
                              <span>Resume Work</span>
                            </button>

                            <button
                              type="button"
                              onClick={handleGoOfflineClick}
                              disabled={isSubmittingStatus}
                              className="h-8 sm:h-9 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-900/30 text-slate-700 dark:text-slate-200 hover:text-rose-600 dark:hover:text-rose-400 border border-slate-200 dark:border-white/10 font-extrabold text-xs flex items-center gap-1.5 cursor-pointer transition active:scale-95"
                            >
                              <PhoneOff className="h-3.5 w-3.5" />
                              <span>Go Offline</span>
                            </button>
                          </>
                        )}

                        {myStatus === "in_call" && (
                          <span className="h-8 sm:h-9 px-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40 font-extrabold text-xs flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse" />
                            <span>In Call (Active)</span>
                          </span>
                        )}

                        {myStatus === "ringing" && (
                          <span className="h-8 sm:h-9 px-3 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30 font-extrabold text-xs flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                            <span>Call Ringing...</span>
                          </span>
                        )}

                        {myStatus === "wrap_up" && (
                          <span className="h-8 sm:h-9 px-3 rounded-xl bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-500/15 dark:text-purple-400 dark:border-purple-500/30 font-extrabold text-xs flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-purple-500" />
                            <span>After-Call Wrap-up</span>
                          </span>
                        )}
                      </div>

                    </div>

                    {/* REAL-TIME SESSION TELEMETRY BAR */}
                    <div className="mt-4 pt-3 border-t border-slate-200/80 dark:border-white/10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                      {/* 1. Post-Call Waiting Time (Idle Time) */}
                      <div className={`p-2.5 rounded-xl border transition-all ${
                        myStatus === "ready" && !(myPresence as any)?.currentCallId
                          ? "bg-indigo-50/90 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/30 ring-2 ring-indigo-500/20"
                          : "bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-white/10"
                      }`}>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                            <Clock className="h-3 w-3 text-indigo-500" /> Waiting Time
                          </span>
                          {myStatus === "ready" && !(myPresence as any)?.currentCallId && (
                            <span className="h-2 w-2 rounded-full bg-indigo-500 animate-ping" />
                          )}
                        </div>
                        <p className="text-sm font-black font-mono text-indigo-600 dark:text-indigo-400 mt-1">
                          {waitingTimeFormatted}
                        </p>
                        <p className="text-[9px] font-semibold text-slate-400 truncate mt-0.5">
                          {myStatus === "ready" && !(myPresence as any)?.currentCallId ? `Current Idle: ${currentWaitingFormatted}` : "Idle Post-Call"}
                        </p>
                      </div>

                      {/* 2. Talk Time */}
                      <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-white/10">
                        <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                          <PhoneCall className="h-3 w-3 text-emerald-500" /> Talk Time
                        </span>
                        <p className="text-sm font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                          {totalCallTimeFormatted}
                        </p>
                        <p className="text-[9px] font-semibold text-slate-400 truncate mt-0.5">
                          {totalCallsHandled} Calls Handled
                        </p>
                      </div>

                      {/* 3. Wrap-up / Dispose Time */}
                      <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-white/10">
                        <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                          <MessageSquare className="h-3 w-3 text-purple-500" /> Wrap-Up Time
                        </span>
                        <p className="text-sm font-black font-mono text-purple-600 dark:text-purple-400 mt-1">
                          {disposeTimeFormatted}
                        </p>
                        <p className="text-[9px] font-semibold text-slate-400 truncate mt-0.5">
                          After-Call Disposition
                        </p>
                      </div>

                      {/* 4. Ringing Time */}
                      <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-white/10">
                        <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                          <Activity className="h-3 w-3 text-rose-500" /> Ringing Time
                        </span>
                        <p className="text-sm font-black font-mono text-rose-600 dark:text-rose-400 mt-1">
                          {ringingTimeFormatted}
                        </p>
                        <p className="text-[9px] font-semibold text-slate-400 truncate mt-0.5">
                          Pre-Connect Ringing
                        </p>
                      </div>

                      {/* 5. Break Time */}
                      <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-white/10">
                        <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                          <Coffee className="h-3 w-3 text-amber-500" /> Break Time
                        </span>
                        <p className="text-sm font-black font-mono text-amber-600 dark:text-amber-400 mt-1">
                          {pauseTimeFormatted}
                        </p>
                        <p className="text-[9px] font-semibold text-slate-400 truncate mt-0.5">
                          {stopCount} Break Events
                        </p>
                      </div>

                      {/* 6. Shift Login HR */}
                      <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-white/10">
                        <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-blue-500" /> Login HR
                        </span>
                        <p className="text-sm font-black font-mono text-blue-600 dark:text-blue-400 mt-1">
                          {loginHoursVal}
                        </p>
                        <p className="text-[9px] font-semibold text-slate-400 truncate mt-0.5">
                          Shift Target: 08:00:00
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Relative Container for Centered Dialer + Right Floating Action Rail */}
                  <div className="relative flex-1 w-full flex items-center justify-center min-h-0 py-2">

                    {/* Centered Softphone Dialer Core Card */}
                    <div className="w-full max-w-[420px] bg-slate-50/60 dark:bg-[#172033]/60 rounded-2xl border border-slate-200/80 dark:border-white/10 p-5 shadow-xs flex flex-col justify-between my-auto">
                      
                      {/* CALL TYPE SELECTION SECTION */}
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                            Call Type
                          </span>
                          <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1 ${
                            callStatus === "ringing"
                              ? "bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-500/20 dark:text-rose-400 dark:border-rose-500/30 animate-pulse"
                              : callStatus === "dialing"
                              ? "bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30 animate-pulse"
                              : callStatus === "connected"
                              ? "bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30"
                              : callStatus === "hold"
                              ? "bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30"
                              : callStatus === "wrapup"
                              ? "bg-purple-50 text-purple-600 border border-purple-200 dark:bg-purple-500/20 dark:text-purple-400 dark:border-purple-500/30"
                              : "bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${
                              callStatus === "ringing" ? "bg-rose-500 animate-ping" :
                              callStatus === "dialing" ? "bg-blue-500 animate-ping" :
                              callStatus === "connected" ? "bg-emerald-500" :
                              callStatus === "hold" ? "bg-amber-500" : "bg-slate-400"
                            }`} />
                            {callStatus === "ready"
                              ? "Ready for Calls"
                              : callStatus === "ringing"
                              ? "Ringing..."
                              : callStatus === "dialing"
                              ? "Dialing..."
                              : callStatus === "connected"
                              ? `Connected (${formatTime(callDuration)})`
                              : callStatus === "hold"
                              ? `On Hold (${formatTime(callDuration)})`
                              : "Call Ended"}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                          {/* Inbound Call Card */}
                          <button
                            type="button"
                            onClick={() => {
                              if (callStatus !== "ready" && callStatus !== "wrapup") return;
                              setDialerMode("inbound");
                            }}
                            className={`p-3 rounded-2xl border transition-all duration-200 flex flex-col items-center justify-center gap-1.5 cursor-pointer text-center ${
                              dialerMode === "inbound"
                                ? "bg-emerald-50 dark:bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-400 shadow-xs ring-2 ring-emerald-500/20 font-black"
                                : "bg-white dark:bg-[#111827] border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 font-bold"
                            } ${callStatus !== "ready" && callStatus !== "wrapup" ? "opacity-60 cursor-not-allowed" : ""}`}
                          >
                            <div className={`h-8 w-8 rounded-full flex items-center justify-center transition-transform ${
                              dialerMode === "inbound"
                                ? "bg-emerald-500 text-white shadow-xs scale-105"
                                : "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            }`}>
                              <PhoneIncoming className="h-4 w-4" />
                            </div>
                            <div className="flex flex-col items-center">
                              <p className="text-xs tracking-tight font-extrabold">
                                {dialerMode === "inbound" && incomingCall ? "INCOMING CALL" : dialerMode === "inbound" && callStatus === "connected" ? "INBOUND CALL" : "Inbound Call"}
                              </p>
                              <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500">
                                {dialerMode === "inbound" && incomingCall ? `Customer: +91 ${incomingCall.phone}` : (dialerMode === "inbound" && callStatus === "connected" ? `Customer: +91 ${outboundPhone}` : "Receive Incoming")}
                              </p>
                              {dialerMode === "inbound" && (callStatus === "answering" || callStatus === "connecting_media" || callStatus === "connected") && (
                                <p className="text-[9px] font-bold text-emerald-500 mt-0.5">
                                  Status: {callStatus === "answering" ? "CONNECTING..." : callStatus === "connecting_media" ? "CONNECTING MEDIA..." : "CONNECTED"}
                                </p>
                              )}
                            </div>
                          </button>

                          {/* Outbound Call Card */}
                          <button
                            type="button"
                            onClick={() => {
                              if (callStatus !== "ready" && callStatus !== "wrapup") return;
                              setDialerMode("outbound");
                            }}
                            className={`p-3 rounded-2xl border transition-all duration-200 flex flex-col items-center justify-center gap-1.5 cursor-pointer text-center ${
                              dialerMode === "outbound"
                                ? "bg-blue-50 dark:bg-blue-500/15 border-blue-500 text-blue-700 dark:text-blue-400 shadow-xs ring-2 ring-blue-500/20 font-black"
                                : "bg-white dark:bg-[#111827] border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 font-bold"
                            } ${callStatus !== "ready" && callStatus !== "wrapup" ? "opacity-60 cursor-not-allowed" : ""}`}
                          >
                            <div className={`h-8 w-8 rounded-full flex items-center justify-center transition-transform ${
                              dialerMode === "outbound"
                                ? "bg-blue-600 text-white shadow-xs scale-105"
                                : "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"
                            }`}>
                              <PhoneOutgoing className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-xs tracking-tight font-extrabold">Outbound Call</p>
                              <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500">Make Outgoing</p>
                            </div>
                          </button>
                        </div>
                      </div>


                      {/* READY STATE: Outbound Phone Input + Keypad + Call Button */}
                      {callStatus === "ready" && dialerMode === "outbound" && (
                        <>
                          <div className="mb-3">
                            <div className="relative h-11 flex items-center bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700/80 rounded-xl px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition shadow-2xs">
                              <span className="text-xs font-mono font-extrabold text-slate-400 dark:text-slate-500 mr-2.5 border-r border-slate-200 dark:border-slate-700 pr-2.5">
                                +91
                              </span>
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={10}
                                value={outboundPhone}
                                onChange={(e) => {
                                  if (callStatus !== "ready" || isDialing) return;
                                  setOutboundPhone(sanitizeMobileNumber(e.target.value));
                                }}
                                disabled={callStatus !== "ready" || isDialing}
                                readOnly={callStatus !== "ready" || isDialing}
                                placeholder="Enter 10-digit mobile number"
                                className="w-full bg-transparent font-mono font-extrabold text-sm text-slate-900 dark:text-white outline-none tracking-widest placeholder:text-slate-400 placeholder:text-xs placeholder:font-sans placeholder:font-medium placeholder:tracking-normal"
                              />
                              {outboundPhone.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setOutboundPhone((prev) => prev.slice(0, -1))}
                                  className="h-7 px-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer transition shrink-0 ml-1"
                                  title="Backspace"
                                >
                                  <span className="text-[12px] font-bold font-mono">⌫</span>
                                </button>
                              )}
                            </div>
                            <div className="mt-1 text-center">
                              {outboundPhone.length > 0 && !isValidMobile ? (
                                <p className="text-[10px] font-bold text-rose-500 flex items-center justify-center gap-1">
                                  <AlertCircle className="h-3 w-3 shrink-0" />
                                  <span>Must be 10 digits starting with 6-9</span>
                                </p>
                              ) : (
                                <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                                  Enter 10-digit mobile number
                                </p>
                              )}
                            </div>
                          </div>

                          {renderKeypad()}

                          <div className="w-full mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800">
                            <button
                              type="button"
                              onClick={async () => {
                                if (myStatus === "offline") {
                                  try {
                                    await setPresenceStatus("ready", undefined, true);
                                  } catch (e) {
                                    // ignore fallback
                                  }
                                }
                                setShowCallMethodModal(true);
                              }}
                              disabled={!isValidMobile || isCreatingLead || isDialing}
                              title={!isValidMobile ? "Enter a valid 10-digit mobile number" : "Call Customer"}
                              className="w-full h-[46px] bg-[#10B981] hover:bg-[#059669] text-white rounded-xl font-extrabold text-sm shadow-xs transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
                            >
                              {isDialing || isCreatingLead ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" /> Starting Call...
                                </>
                              ) : (
                                <>
                                  <Phone className="h-4 w-4 fill-current" /> Call Customer
                                </>
                              )}
                            </button>
                          </div>
                        </>
                      )}

                      {/* READY STATE: Inbound Waiting Screen */}
                      {callStatus === "ready" && dialerMode === "inbound" && (
                        <div className="py-8 px-4 text-center space-y-3 bg-white dark:bg-[#111827] rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 my-2">
                          <div className="h-12 w-12 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
                            <PhoneIncoming className="h-6 w-6 animate-pulse" />
                          </div>
                          <div>
                            <p className="text-xs font-extrabold text-slate-800 dark:text-white">Waiting for Inbound Calls</p>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-0.5">Line is active and ready to receive customer calls</p>
                          </div>
                        </div>
                      )}

                      {/* RINGING INTERFACE (Outbound & Inbound) */}
                      {(callStatus === "ringing" || callStatus === "dialing") && (
                        <div className="py-6 px-4 bg-white dark:bg-[#111827] rounded-2xl border-2 border-rose-500/60 dark:border-rose-500/40 text-center shadow-xl relative overflow-hidden space-y-4 my-2">
                          <div className="absolute top-0 left-0 right-0 h-1.5 bg-rose-500 animate-pulse" />

                          {/* Ringing Avatar with Pulse Ring */}
                          <div className="relative h-16 w-16 mx-auto flex items-center justify-center">
                            <div className="absolute inset-0 rounded-full bg-rose-500/20 animate-ping" />
                            <div className="relative h-14 w-14 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-lg shadow-rose-500/30 font-extrabold text-xl">
                              {(selectedLead?.name || incomingCall?.name || "Customer").charAt(0).toUpperCase()}
                            </div>
                          </div>

                          {/* Caller Info & Live Ringing Timer */}
                          <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-rose-600 dark:text-rose-400 flex items-center justify-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                              {dialerMode === "inbound" ? "INCOMING CALL" : "OUTBOUND CALL • RINGING"}
                            </p>
                            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                              {selectedLead?.name || incomingCall?.name || "Customer Lead"}
                            </h3>
                            <p className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300">
                              +91 {outboundPhone || incomingCall?.phone || selectedLead?.phone || "9876543210"}
                            </p>
                            <p className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400 pt-1">
                              Ringing Time: <span className="text-rose-600 dark:text-rose-400 font-extrabold text-sm">{formatTime(ringingDuration)}</span>
                            </p>
                          </div>

                          {/* Actions: Accept if Inbound, Cancel/End if Outbound */}
                          <div className="pt-2">
                            {dialerMode === "inbound" && incomingCall ? (
                              <button
                                type="button"
                                onClick={handleAnswerRingingCall}
                                className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 shadow-md transition cursor-pointer"
                              >
                                <PhoneIncoming className="h-5 w-5 animate-bounce" />
                                <span>Accept Call</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={handleHangup}
                                className="w-full h-11 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl font-extrabold text-xs shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
                              >
                                <PhoneOff className="h-4.5 w-4.5 fill-current" />
                                <span>Cancel / End Call</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* CONNECTED / IN_CALL INTERFACE */}
                      {(callStatus === "connected" || callStatus === "hold" || callStatus === "answering" || callStatus === "connecting_media") && (
                        <div className="py-4 px-3 bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 text-center space-y-3.5 shadow-sm my-2">
                          {/* Live Status Pill & Talk Duration Ticker */}
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">
                            <span className={`h-2 w-2 rounded-full ${
                              callStatus === "hold" ? "bg-amber-500 animate-pulse" : "bg-emerald-500 animate-pulse"
                            }`} />
                            <span>
                              {callStatus === "hold" ? `On Hold • ${formatTime(callDuration)}` : `Connected • ${formatTime(callDuration)}`}
                            </span>
                          </div>

                          {/* Customer Avatar & Call Info */}
                          <div className="space-y-1">
                            <div className="relative h-16 w-16 mx-auto flex items-center justify-center">
                              <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
                              <div className="relative h-14 w-14 rounded-full text-white font-extrabold text-xl flex items-center justify-center shadow-lg bg-emerald-500">
                                {(selectedLead?.name || incomingCall?.name || "Customer").charAt(0).toUpperCase()}
                              </div>
                            </div>
                            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                              {selectedLead?.name || incomingCall?.name || "Customer Lead"}
                            </h3>
                            <p className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400">
                              +91 {outboundPhone || incomingCall?.phone || selectedLead?.phone || "9876543210"}
                            </p>
                          </div>

                          {/* In-Call Controls Matrix: Mute, Speaker, Keypad, Hold */}
                          <div className="grid grid-cols-4 gap-2 pt-1">
                            <button
                              type="button"
                              onClick={handleMuteToggle}
                              disabled={isMuteLoading}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition active:scale-95 cursor-pointer ${
                                isMuted
                                  ? "bg-amber-500 text-white border-amber-600 shadow-xs"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
                              }`}
                            >
                              {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                              <span className="text-[9px] font-extrabold uppercase">{isMuted ? "Muted" : "Mute"}</span>
                            </button>

                            <button
                              type="button"
                              onClick={handleToggleSpeaker}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition active:scale-95 cursor-pointer ${
                                isSpeaker
                                  ? "bg-blue-600 text-white border-blue-700 shadow-xs"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
                              }`}
                            >
                              {isSpeaker ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                              <span className="text-[9px] font-extrabold uppercase">Speaker</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setShowInCallKeypad(!showInCallKeypad)}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition active:scale-95 cursor-pointer ${
                                showInCallKeypad
                                  ? "bg-blue-600 text-white border-blue-700 shadow-xs"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
                              }`}
                            >
                              <Hash className="h-4 w-4" />
                              <span className="text-[9px] font-extrabold uppercase">Keypad</span>
                            </button>

                            <button
                              type="button"
                              onClick={handleHoldToggle}
                              disabled={isHoldLoading || isHoldProcessing}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition active:scale-95 cursor-pointer ${
                                callStatus === "hold"
                                  ? "bg-amber-500 text-white border-amber-600 shadow-xs"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
                              }`}
                            >
                              {callStatus === "hold" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                              <span className="text-[9px] font-extrabold uppercase">{callStatus === "hold" ? "Resume" : "Hold"}</span>
                            </button>
                          </div>

                          {showInCallKeypad && (
                            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                              {renderKeypad()}
                            </div>
                          )}

                          {/* Prominent Red End Call Button */}
                          <button
                            type="button"
                            onClick={handleHangup}
                            className="w-full h-12 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl font-black text-sm shadow-md transition flex items-center justify-center gap-2 cursor-pointer mt-3"
                          >
                            <PhoneOff className="h-5 w-5 fill-current" />
                            <span>END CALL</span>
                          </button>
                        </div>
                      )}

                      {/* WRAP-UP / DISPOSITION INTERFACE */}
                      {callStatus === "wrapup" && (
                        <div className="my-2 animate-in fade-in zoom-in-95 duration-200">
                          <WrapUpPanel
                            lead={selectedLead}
                            phone={outboundPhone}
                            maskedPhone={maskPhoneNumber(outboundPhone || selectedLead?.phone)}
                            callDuration={callDuration}
                            callDirection={dialerMode}
                            wrapUpDuration={wrapUpDuration}
                            disposition={disposition}
                            setDisposition={setDisposition}
                            followUpDate={followUpDate}
                            setFollowUpDate={setFollowUpDate}
                            followUpTime={followUpTime}
                            setFollowUpTime={setFollowUpTime}
                            notes={notes}
                            setNotes={setNotes}
                            isSavingOutcome={isSavingOutcome}
                            onSaveAndNext={handleSaveAndNext}
                            formatTime={formatTime}
                          />
                        </div>
                      )}
                    </div>

                    {/* Premium Right Floating Action Rail (Auto-hides when any slide-over drawer panel or modal is open) */}
                    <AnimatePresence>
                      {!activeSlideOver && (
                        <motion.div
                          initial={{ opacity: 0, x: 24, scale: 0.95 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          exit={{ opacity: 0, x: 24, scale: 0.95 }}
                          transition={{ duration: 0.18, ease: "easeInOut" }}
                          className="fixed right-5 sm:right-6 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-2 sm:gap-2.5 p-2 bg-white/85 dark:bg-[#111827]/90 backdrop-blur-xl border border-white/70 dark:border-white/10 rounded-[20px] shadow-[0_12px_40px_-8px_rgba(0,0,0,0.15)] dark:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.4)]"
                        >
                          {/* 👤 User Profile Icon */}
                          <div className="relative group">
                            <button
                              type="button"
                              onClick={() => setActiveSlideOver(activeSlideOver === "profile" ? null : "profile")}
                              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer select-none ${
                                activeSlideOver === "profile"
                                  ? "bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white shadow-md shadow-blue-500/30 ring-2 ring-blue-400/40 scale-[1.05]"
                                  : "bg-slate-100/90 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-[#2563EB] dark:hover:text-[#60A5FA] hover:scale-105 active:scale-95"
                              }`}
                            >
                              <User className="h-5 w-5" />
                            </button>
                            <div className="absolute right-14 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-slate-900/90 dark:bg-slate-800/95 text-white text-xs font-bold rounded-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none shadow-xl z-50 backdrop-blur-xs">
                              User Profile
                            </div>
                          </div>

                          {/* 📞 Call History Icon */}
                          <div className="relative group">
                            <button
                              type="button"
                              onClick={() => setActiveSlideOver(activeSlideOver === "history" ? null : "history")}
                              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer select-none ${
                                activeSlideOver === "history"
                                  ? "bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white shadow-md shadow-blue-500/30 ring-2 ring-blue-400/40 scale-[1.05]"
                                  : "bg-slate-100/90 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-[#2563EB] dark:hover:text-[#60A5FA] hover:scale-105 active:scale-95"
                              }`}
                            >
                              <PhoneCall className="h-5 w-5" />
                            </button>
                            <div className="absolute right-14 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-slate-900/90 dark:bg-slate-800/95 text-white text-xs font-bold rounded-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none shadow-xl z-50 backdrop-blur-xs">
                              Call History
                            </div>
                          </div>

                          {/* 📝 Disposition Icon */}
                          <div className="relative group">
                            <button
                              type="button"
                              onClick={() => setActiveSlideOver(activeSlideOver === "disposition" ? null : "disposition")}
                              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer select-none ${
                                activeSlideOver === "disposition"
                                  ? "bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white shadow-md shadow-blue-500/30 ring-2 ring-blue-400/40 scale-[1.05]"
                                  : "bg-slate-100/90 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-[#2563EB] dark:hover:text-[#60A5FA] hover:scale-105 active:scale-95"
                              }`}
                            >
                              <FileText className="h-5 w-5" />
                            </button>
                            <div className="absolute right-14 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-slate-900/90 dark:bg-slate-800/95 text-white text-xs font-bold rounded-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none shadow-xl z-50 backdrop-blur-xs">
                              Lead Disposition
                            </div>
                          </div>

                          {/* 📋 Call Logs Icon */}
                          <div className="relative group">
                            <button
                              type="button"
                              onClick={() => setActiveSlideOver(activeSlideOver === "logs" ? null : "logs")}
                              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer select-none ${
                                activeSlideOver === "logs"
                                  ? "bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white shadow-md shadow-blue-500/30 ring-2 ring-blue-400/40 scale-[1.05]"
                                  : "bg-slate-100/90 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-[#2563EB] dark:hover:text-[#60A5FA] hover:scale-105 active:scale-95"
                              }`}
                            >
                              <ListOrdered className="h-5 w-5" />
                            </button>
                            <div className="absolute right-14 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-slate-900/90 dark:bg-slate-800/95 text-white text-xs font-bold rounded-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none shadow-xl z-50 backdrop-blur-xs">
                              Technical Call Logs
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* RIGHT SLIDE-OVER PANEL */}
                    <LeadActionSlideOver
                      activeTab={activeSlideOver}
                      onClose={() => setActiveSlideOver(null)}
                      onSelectTab={setActiveSlideOver}
                      selectedLead={selectedLead || (filteredLeads.length > 0 ? filteredLeads[0] : null)}
                      callHistory={callHistory}
                      onQuickCall={handleQuickCall}
                      onSaveDisposition={handleSaveSlideOverDisposition}
                      isSavingDisposition={isSavingSlideOverDisp}
                      showToast={showToast}
                      user={user}
                      dialerComponent={renderDialerPanel()}
                    />
                  </div>
                </div>

              </div>

            </motion.div>
          )}

          {/* ---------------- INBOUND QUEUE TAB ---------------- */}
          {activeTab === "inbound" && (
            <motion.div
              key="inbound"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="h-full flex items-center justify-center p-6 bg-white dark:bg-[#111827] rounded-[20px] border border-slate-200 dark:border-white/10 shadow-2xs"
            >
              <div className="text-center max-w-sm">
                <div className="h-20 w-20 bg-blue-500/10 border border-blue-500/30 rounded-full flex items-center justify-center mx-auto mb-4 relative shadow-md">
                  <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-20" />
                  <Ear className="h-9 w-9 text-blue-600 dark:text-blue-400" />
                </div>
                <h2 className="text-xl font-black mb-1">
                  <span className="text-blue-600 dark:text-blue-400">Inbound Queue </span>
                  <span className="text-amber-500">Active</span>
                </h2>
                <p className="text-slate-500 dark:text-slate-400 font-medium text-xs">
                  Available to receive incoming calls from customers &amp; transfers.
                </p>
              </div>
            </motion.div>
          )}

          {/* ---------------- SUPERVISOR MONITORING TAB ---------------- */}
          {activeTab === "supervisor" && isSupervisor && (
            <motion.div
              key="supervisor"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="h-full flex flex-col gap-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="bg-white dark:bg-[#111827] p-4 rounded-xl border border-slate-200 dark:border-white/10">
                  <p className="text-[10px] font-black text-slate-400 uppercase">Active Calls</p>
                  <p className="text-2xl font-black text-emerald-500">0</p>
                </div>
                <div className="bg-white dark:bg-[#111827] p-4 rounded-xl border border-slate-200 dark:border-white/10">
                  <p className="text-[10px] font-black text-slate-400 uppercase">Agents Online</p>
                  <p className="text-2xl font-black text-slate-900 dark:text-white">12</p>
                </div>
                <div className="bg-white dark:bg-[#111827] p-4 rounded-xl border border-slate-200 dark:border-white/10">
                  <p className="text-[10px] font-black text-slate-400 uppercase">Today Calls</p>
                  <p className="text-2xl font-black text-slate-900 dark:text-white">{todayStats.total}</p>
                </div>
                <div className="bg-white dark:bg-[#111827] p-4 rounded-xl border border-slate-200 dark:border-white/10">
                  <p className="text-[10px] font-black text-slate-400 uppercase">Avg Handle Time</p>
                  <p className="text-2xl font-black text-slate-900 dark:text-white">2m 14s</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* ---------------- FULL CALL LOGS HISTORY TAB ---------------- */}
          {activeTab === "history" && (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="h-full bg-white dark:bg-[#111827] rounded-[20px] border border-slate-200 dark:border-white/10 shadow-2xs p-5 flex flex-col overflow-hidden"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100 dark:border-white/10 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <History className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                      Recent Call Logs History
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Real-time call records and disposition logs ({callHistory.length} total)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Search phone or status..."
                    value={historySearchQuery}
                    onChange={(e) => setHistorySearchQuery(e.target.value)}
                    className="h-8 pl-3 pr-3 text-xs rounded-lg bg-slate-50 dark:bg-[#172033] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white outline-none w-48"
                  />
                  <button
                    onClick={fetchCallHistory}
                    className="h-8 px-3 rounded-lg bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-200 transition cursor-pointer flex items-center gap-1"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoadingHistory ? "animate-spin" : ""}`} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* Table Container */}
              <div className="flex-1 overflow-y-auto softphone-scrollbar">
                <table className="w-full text-left text-xs border-separate border-spacing-y-1">
                  <thead className="bg-slate-50 dark:bg-[#172033] text-slate-500 dark:text-slate-400 font-extrabold uppercase tracking-wider sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2.5 rounded-l-lg">Masked Phone</th>
                      <th className="px-3 py-2.5">Lead / Customer</th>
                      <th className="px-3 py-2.5">Outcome</th>
                      <th className="px-3 py-2.5">Duration</th>
                      <th className="px-3 py-2.5 rounded-r-lg">Call Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCallHistory.map((item) => (
                      <tr
                        key={item.id || item._id}
                        className="bg-slate-50/60 dark:bg-[#172033]/60 border border-slate-200/80 dark:border-white/10 hover:bg-white dark:hover:bg-[#1A2438] transition rounded-lg"
                      >
                        <td className="px-3 py-2 font-mono font-bold text-slate-900 dark:text-white">
                          {maskPhoneNumber(item.phone || item.phone_number)}
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">
                          {item.lead_name || "Manual Lead"}
                        </td>
                        <td className="px-3 py-2">
                          {renderOutcomeBadge(item.outcome || item.status)}
                        </td>
                        <td className="px-3 py-2 font-mono font-bold text-slate-600 dark:text-slate-300">
                          {formatDuration(item.duration_seconds || item.duration)}
                        </td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                          {formatCallTime(item.started_at || item.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* Transfer Modal Dialog */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-white/10 p-5 max-w-sm w-full shadow-2xl">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
              <Share2 className="h-4 w-4 text-blue-600" /> Transfer Live Call
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              Enter target agent ID or phone number to transfer the active call session.
            </p>

            <input
              type="text"
              placeholder="Enter Agent ID or +91 Phone"
              value={transferTarget}
              onChange={e => setTransferTarget(e.target.value)}
              className="w-full h-10 px-3 bg-slate-50 dark:bg-[#172033] border border-slate-200 dark:border-white/10 rounded-xl text-xs font-semibold text-slate-900 dark:text-white outline-none mb-4"
            />

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowTransferModal(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleTransferCall}
                disabled={isTransferring || !transferTarget.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {isTransferring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                <span>Transfer</span>
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Choose Call Method Modal Popup */}
      {showCallMethodModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#151F32] rounded-3xl border border-slate-200/80 dark:border-white/10 p-6 max-w-[420px] w-full shadow-2xl overflow-hidden relative space-y-5">
            
            {/* Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 dark:border-white/10">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-[#22C55E] rounded-2xl flex items-center justify-center shrink-0 border border-emerald-100 dark:border-emerald-500/20 shadow-2xs">
                  <PhoneCall className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight">
                    Choose Call Method
                  </h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-[#3B82F6] border border-blue-100 dark:border-blue-500/20">
                      Target: {maskPhoneNumber(outboundPhone)}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCallMethodModal(false)}
                className="h-8 w-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Selection Grid */}
            <div>
              <label className="block text-[10.5px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2.5">
                Select Connection Method
              </label>
              <div className="grid grid-cols-2 gap-3">
                {/* Agent Call Option */}
                <button
                  type="button"
                  onClick={() => setSelectedCallMethod("human")}
                  className={`p-4 rounded-2xl border flex flex-col items-center justify-center gap-2.5 transition-all duration-200 cursor-pointer active:scale-95 text-center ${
                    selectedCallMethod === "human"
                      ? "bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/30 text-amber-900 dark:text-amber-300 font-black shadow-2xs"
                      : "bg-slate-50/80 dark:bg-slate-900/60 border-slate-200/80 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/20"
                  }`}
                >
                  <div className={`h-10 w-10 rounded-2xl flex items-center justify-center transition-transform duration-200 ${
                    selectedCallMethod === "human" 
                      ? "bg-amber-500 text-white shadow-xs scale-105" 
                      : "bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                  }`}>
                    <User className="h-5 w-5" />
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-xs font-black block text-slate-900 dark:text-white">Agent Call</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium block">Human Softphone</span>
                  </div>
                </button>

                {/* AI Call Option */}
                <button
                  type="button"
                  onClick={() => setSelectedCallMethod("ai")}
                  className={`p-4 rounded-2xl border flex flex-col items-center justify-center gap-2.5 transition-all duration-200 cursor-pointer active:scale-95 text-center ${
                    selectedCallMethod === "ai"
                      ? "bg-purple-500/10 border-purple-500 ring-2 ring-purple-500/30 text-purple-900 dark:text-purple-300 font-black shadow-2xs"
                      : "bg-slate-50/80 dark:bg-slate-900/60 border-slate-200/80 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/20"
                  }`}
                >
                  <div className={`h-10 w-10 rounded-2xl flex items-center justify-center transition-transform duration-200 ${
                    selectedCallMethod === "ai" 
                      ? "bg-purple-600 text-white shadow-xs scale-105" 
                      : "bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                  }`}>
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-xs font-black block text-slate-900 dark:text-white">AI Call</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium block">Autonomous Voice</span>
                  </div>
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowCallMethodModal(false)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-extrabold text-xs cursor-pointer transition shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCallMethodModal(false);
                  handleDial(selectedCallMethod, "sim1");
                }}
                className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold text-xs shadow-md shadow-emerald-600/20 transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer active:scale-98 whitespace-nowrap"
              >
                <Phone className="h-4 w-4 fill-current shrink-0" />
                <span>Start {selectedCallMethod === "ai" ? "AI Call" : "Agent Call"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Advanced Lead Filter Modal */}
      <LeadFilterModal
        isOpen={isFilterPanelOpen}
        onClose={() => setIsFilterPanelOpen(false)}
        filterUserId={filterUserId}
        setFilterUserId={setFilterUserId}
        filterPhone={filterPhone}
        setFilterPhone={setFilterPhone}
        filterStatus={statusFilter}
        setFilterStatus={setStatusFilter}
        filterSource={filterSource}
        setFilterSource={setFilterSource}
        filterStartDate={filterStartDate}
        setFilterStartDate={setFilterStartDate}
        filterEndDate={filterEndDate}
        setFilterEndDate={setFilterEndDate}
        filterAgent={filterAgent}
        setFilterAgent={setFilterAgent}
        onApply={() => setIsFilterPanelOpen(false)}
        onClearAll={resetAllFilters}
        activeFilterCount={activeFilterCount}
      />

      {/* Categorized Pause / Break Selection Modal */}
      <PauseBreakModal
        isOpen={showPauseModal}
        onClose={() => setShowPauseModal(false)}
        onSelectBreak={(reason) => {
          setPresenceStatus("paused", reason).catch((err) => showToast(err?.message || "Failed to enter break", "error"));
        }}
        onEndBreak={() => setPresenceStatus("ready")}
        currentStatus={myStatus}
        currentPauseReason={pauseReason}
        pausedSeconds={activeBreakSeconds}
        totalBreakSeconds={totalBreakSeconds}
        breakStats={myPresence?.break_stats}
      />

      {/* Early Logout Warning Modal */}
      <EarlyLogoutWarningModal
        isOpen={showEarlyLogoutWarningModal}
        onClose={() => setShowEarlyLogoutWarningModal(false)}
        onConfirmEarlyLogout={() => setShowShiftSummaryModal(true)}
        netWorkingSeconds={grossLoginSeconds}
        targetSeconds={shiftTargetSeconds}
      />

      {/* Final Shift Summary Modal */}
      <ShiftSummaryModal
        isOpen={showShiftSummaryModal}
        onClose={() => setShowShiftSummaryModal(false)}
        onConfirmOffline={handleConfirmOffline}
        presenceData={myPresence}
        agentName={user?.name || "Agent"}
      />
    </div>
  );
}
