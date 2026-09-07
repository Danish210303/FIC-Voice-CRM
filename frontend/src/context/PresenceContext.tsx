// @refresh reset
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAuth } from "./AuthContext";
import { api, getWsUrl, sanitizeUrl } from "../api/client";

export interface BreakCategoryStats {
  count: number;
  total_seconds: number;
}

export interface BreakStats {
  tea_break: BreakCategoryStats;
  lunch_break: BreakCategoryStats;
  personal_reason: BreakCategoryStats;
}

export interface BreakLogItem {
  type: string;
  start_time: string;
  end_time?: string;
  duration_seconds?: number;
}

export interface CurrentBreak {
  type: string;
  start_time: string;
}

export interface AgentPresence {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
  employee_id?: string;
  pool_id?: string;
  agentId?: string;
  agentName?: string;
  requirementPoolId?: string;
  requirementPoolName?: string;
  supervisorId?: string;
  supervisorName?: string;
  statusSince?: string | null;
  currentCallId?: string | null;
  currentCallType?: string | null;
  loginAt?: string | null;
  lastUpdatedAt?: string;
  version?: number;
  status: "ready" | "paused" | "in_call" | "offline" | "checked_in" | "ringing" | "wrap_up";
  pause_reason?: string | null;
  login_at?: string | null;
  logout_at?: string | null;
  current_break?: CurrentBreak | null;
  break_logs?: BreakLogItem[];
  total_break_seconds?: number;
  working_seconds?: number;
  gross_seconds?: number;
  ready_seconds: number;
  paused_seconds: number;
  talk_seconds?: number;
  ringing_seconds?: number;
  setup_seconds?: number;
  dispose_seconds?: number;
  waiting_seconds?: number;
  waiting_started_at?: string | null;
  active_waiting_seconds?: number;
  total_waiting_seconds?: number;
  total_calls_handled?: number;
  break_stats?: BreakStats;
  net_working_seconds?: number;
  last_status_change?: string | null;
  status_since?: string | null;
  last_activity?: string | null;
  is_active?: boolean;
  shift_date?: string;
  state_started_at?: string | null;
  total_ready_seconds?: number;
  total_pause_seconds?: number;
  total_talk_seconds?: number;
  total_ringing_seconds?: number;
  total_wrapup_seconds?: number;
  breaks_taken?: number;
  dispositionStartedAt?: string | null;
}

export interface PresenceSummary {
  total_agents: number;
  online_count: number;
  ready_count: number;
  paused_count: number;
  ringing_count?: number;
  in_call_count: number;
  wrap_up_count?: number;
  offline_count: number;
}

interface PresenceContextType {
  nowTicker: number;
  myStatus: "ready" | "paused" | "in_call" | "offline" | "checked_in" | "ringing" | "wrap_up";
  displayStatus: "AVAILABLE" | "ON_BREAK" | "IN_CALL" | "OFFLINE" | "CHECKED_IN" | "RINGING" | "WRAP_UP";
  pauseReason: string | null;
  breakType: "LUNCH" | "TEA" | "PERSONAL" | string | null;
  breakStartedAt: string | null;
  myPresence: AgentPresence | null;
  agents: AgentPresence[];
  summary: PresenceSummary;
  wsConnected: boolean;
  isSubmittingStatus: boolean;
  netWorkingSeconds: number;
  grossLoginSeconds: number;
  totalBreakSeconds: number;
  activeBreakSeconds: number;
  readySeconds: number;
  talkSeconds: number;
  ringingSeconds: number;
  setupSeconds: number;
  disposeSeconds: number;
  activeDisposeSeconds: number;
  waitingSeconds: number;
  activeWaitingSeconds: number;
  totalWaitingSeconds: number;
  currentWaitingSeconds: number;
  stopCount: number;
  isShiftTargetReached: boolean;
  remainingSeconds: number;
  shiftTargetSeconds: number;
  maxBreakSeconds: number;
  isMaxBreakReached: boolean;
  remainingBreakSeconds: number;

  isCheckedInToday: boolean;
  isLiveModalOpen: boolean;
  setIsLiveModalOpen: (open: boolean) => void;
  openLiveModal: () => void;
  closeLiveModal: () => void;
  setPresenceStatus: (newStatus: "ready" | "paused" | "in_call" | "offline" | "checked_in" | "ringing" | "wrap_up", pauseReason?: string, forceOffline?: boolean) => Promise<void>;
  checkIn: (location?: string) => Promise<void>;
  checkOut: () => Promise<void>;
  startBreak: (breakType: string) => Promise<void>;
  resumeWork: () => Promise<void>;
  goOffline: (forceOffline?: boolean) => Promise<void>;
  goOnline: () => Promise<void>;
  refreshPresence: () => Promise<void>;
  updateCallTelemetry: (stats: { ringing_seconds?: number; setup_seconds?: number; talk_seconds?: number; dispose_seconds?: number; calls_handled?: number }) => void;
}

export const getStatusBadgeDetails = (status: string, pauseReason?: string | null, isCheckedIn?: boolean) => {
  const st = (status || "").toLowerCase().trim();
  if (isCheckedIn === false || st === "offline" || !st) {
    return {
      label: "Offline",
      colorClass: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30",
      dotClass: "bg-rose-500"
    };
  }
  switch (st) {
    case "ready":
    case "available":
      return {
        label: "Ready",
        colorClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30",
        dotClass: "bg-emerald-500"
      };
    case "checked_in":
      return {
        label: "Checked In",
        colorClass: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/30",
        dotClass: "bg-blue-500"
      };
    case "ringing":
      return {
        label: "Ringing",
        colorClass: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30",
        dotClass: "bg-rose-500 animate-ping"
      };
    case "in_call":
    case "talking":
    case "on_call":
    case "busy":
      return {
        label: "In Call",
        colorClass: "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40",
        dotClass: "bg-emerald-600 animate-pulse"
      };
    case "wrap_up":
    case "wrapup":
      return {
        label: "Wrap-Up",
        colorClass: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-400 dark:border-purple-500/30",
        dotClass: "bg-purple-500"
      };
    case "paused":
    case "break":
    case "on_break":
      return {
        label: pauseReason ? `On Break (${pauseReason})` : "On Break",
        colorClass: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30",
        dotClass: "bg-amber-500"
      };
    default:
      return {
        label: "Offline",
        colorClass: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30",
        dotClass: "bg-rose-500"
      };
  }
};

const computeSummaryFromAgents = (agentsList: AgentPresence[]): PresenceSummary => {
  let ready = 0;
  let paused = 0;
  let ringing = 0;
  let inCall = 0;
  let wrapUp = 0;
  let offline = 0;

  agentsList.forEach((a) => {
    const st = (a.status || "").toLowerCase().trim();
    if (st === "ready" || st === "available") ready++;
    else if (st === "paused" || st === "break" || st === "on_break") paused++;
    else if (st === "ringing") ringing++;
    else if (st === "in_call" || st === "talking" || st === "on_call" || st === "busy") inCall++;
    else if (st === "wrap_up" || st === "wrapup") wrapUp++;
    else offline++;
  });

  return {
    total_agents: agentsList.length,
    online_count: ready + paused + ringing + inCall + wrapUp,
    ready_count: ready,
    paused_count: paused,
    ringing_count: ringing,
    in_call_count: inCall,
    wrap_up_count: wrapUp,
    offline_count: offline,
  };
};

const defaultSummary: PresenceSummary = {
  total_agents: 0,
  online_count: 0,
  ready_count: 0,
  paused_count: 0,
  in_call_count: 0,
  offline_count: 0,
};

const PresenceContext = createContext<PresenceContextType | undefined>(undefined);

export const PresenceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [myStatus, setMyStatus] = useState<"ready" | "paused" | "in_call" | "offline" | "checked_in" | "ringing" | "wrap_up">("offline");
  const [pauseReason, setPauseReason] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentPresence[]>([]);
  const [summary, setSummary] = useState<PresenceSummary>(defaultSummary);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [myPresence, setMyPresence] = useState<AgentPresence | null>(null);
  const [isLiveModalOpen, setIsLiveModalOpen] = useState<boolean>(false);

  const openLiveModal = useCallback(() => setIsLiveModalOpen(true), []);
  const closeLiveModal = useCallback(() => setIsLiveModalOpen(false), []);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pauseStartedAtRef = useRef<number | null>(null);
  const isUnmountedRef = useRef<boolean>(false);
  const reconnectAttemptsRef = useRef<number>(0);
  const isAuthErrorRef = useRef<boolean>(false);
  // Prevents concurrent fetchPresenceData calls from overlapping (e.g. WS message + polling firing together)
  const isFetchingRef = useRef<boolean>(false);

  const myPresenceMemo = useMemo(() => {
    if (!user) return null;
    const uid = user.id || (user as any)._id;
    return agents.find((a) => a.id === uid || a.user_id === uid || (a as any).agentId === uid) || null;
  }, [agents, user]);

  const [nowTicker, setNowTicker] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowTicker(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const SHIFT_TARGET_SECONDS = 28800; // 8 Hours

  const [isCheckedInToday, setIsCheckedInToday] = useState<boolean>(false);

  const elapsedSinceStateChange = useMemo(() => {
    const startStr = myPresence?.state_started_at || myPresence?.status_since || myPresence?.last_status_change || myPresence?.login_at;
    if (!startStr) return 0;
    try {
      const start = new Date(startStr).getTime();
      return Math.max(0, Math.floor((nowTicker - start) / 1000));
    } catch {
      return 0;
    }
  }, [nowTicker, myPresence?.state_started_at, myPresence?.status_since, myPresence?.last_status_change, myPresence?.login_at]);

  // 1. Gross Login Hours (Live from check-in / login timestamp)
  const grossLoginSeconds = useMemo(() => {
    if (!isCheckedInToday) return 0;
    const loginStr = myPresence?.login_at;
    if (loginStr) {
      try {
        const start = new Date(loginStr).getTime();
        return Math.max(0, Math.floor((nowTicker - start) / 1000));
      } catch {}
    }
    return (myPresence?.gross_seconds || 0) + (myStatus !== "offline" ? elapsedSinceStateChange : 0);
  }, [isCheckedInToday, myPresence?.login_at, myPresence?.gross_seconds, myStatus, elapsedSinceStateChange, nowTicker]);
  
  // 2. Break Time (Live while paused)
  const activeBreakSeconds = (isCheckedInToday && myStatus === "paused") ? elapsedSinceStateChange : 0;
  const totalBreakSeconds = isCheckedInToday ? ((myPresence?.paused_seconds ?? myPresence?.total_break_seconds ?? myPresence?.total_pause_seconds ?? 0) + activeBreakSeconds) : 0;
  
  // 3. Ready / Available Time (Live while ready)
  const activeReadySeconds = (isCheckedInToday && myStatus === "ready" && !(myPresence as any)?.currentCallId) ? elapsedSinceStateChange : 0;
  const readySeconds = isCheckedInToday ? ((myPresence?.ready_seconds ?? myPresence?.total_ready_seconds ?? 0) + activeReadySeconds) : 0;
  
  // 4. Talk Time (Live while in_call)
  const activeTalkSeconds = (isCheckedInToday && myStatus === "in_call") ? elapsedSinceStateChange : 0;
  const talkSeconds = isCheckedInToday ? ((myPresence?.talk_seconds ?? myPresence?.total_talk_seconds ?? 0) + activeTalkSeconds) : 0;
  
  // 5. Ringing Time (Live while ringing)
  const activeRingingSeconds = (isCheckedInToday && myStatus === "ringing") ? elapsedSinceStateChange : 0;
  const ringingSeconds = isCheckedInToday ? ((myPresence?.ringing_seconds ?? myPresence?.total_ringing_seconds ?? 0) + activeRingingSeconds) : 0;
  
  // 6. Wrap-Up / Dispose Time (Live while wrap_up)
  const activeDisposeSeconds = (isCheckedInToday && myStatus === "wrap_up") ? elapsedSinceStateChange : 0;
  const disposeSeconds = isCheckedInToday ? ((myPresence?.dispose_seconds ?? myPresence?.total_wrapup_seconds ?? 0) + activeDisposeSeconds) : 0;

  const MAX_BREAK_SECONDS = 3780; // 1 Hour 3 Minutes
  const isMaxBreakReached = totalBreakSeconds >= MAX_BREAK_SECONDS;
  const remainingBreakSeconds = Math.max(0, MAX_BREAK_SECONDS - totalBreakSeconds);
  const calculatedWorkingSeconds = readySeconds;
  const setupSeconds = 0;

  // Waiting Time (Idle Post-Call Time)
  const currentWaitingSeconds = activeReadySeconds;
  const totalWaitingSeconds = readySeconds;
  const waitingSeconds = totalWaitingSeconds;
  const activeWaitingSeconds = currentWaitingSeconds;

  const stopCount = isCheckedInToday ? ((myPresence?.break_logs || []).length + (myPresence?.status === "paused" || myStatus === "paused" ? 1 : 0)) : 0;

  // 8-Hour shift target is evaluated directly against gross Login HR (breaks do NOT decrease shift progress)
  const isShiftTargetReached = grossLoginSeconds >= SHIFT_TARGET_SECONDS;


  const fetchPresenceData = useCallback(async () => {
    if (!user) return;

    // Do NOT fire any API call without a valid access token.
    // This prevents 401 storms when a stale user object lives in React state
    // but the corresponding JWT has expired or been cleared from localStorage.
    const token = localStorage.getItem("access_token");
    if (!token) {
      console.warn("[PRESENCE] Skipping fetch: no access token in localStorage");
      return;
    }

    // Deduplicate: if a fetch is already in flight, skip this call
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const [agentList, summaryData, meData, activeSession, currentSession, todayAtt] = await Promise.all([
        api.get("/api/presence/agents").catch(() => []),
        api.get("/api/presence/summary").catch(() => defaultSummary),
        api.get("/api/agent/presence").catch(() => api.get("/api/presence/me").catch(() => null)),
        api.get("/api/agent/session/active").catch(() => null),
        api.get("/api/agent/session/current").catch(() => null),
        api.get("/api/attendance/today").catch(() => null),
      ]);

      const hasCheckedIn = !!todayAtt?.check_in_time && todayAtt?.status !== "NOT_CHECKED_IN" && todayAtt?.operational_status !== "NOT_CHECKED_IN";
      setIsCheckedInToday(hasCheckedIn);

      if (Array.isArray(agentList)) {
        setAgents(agentList);
        // Recalculate summary strictly from latest agent snapshot
        const calculatedSummary = computeSummaryFromAgents(agentList);
        setSummary(calculatedSummary);

        const uid = user.id || (user as any)._id;
        const meFromList = agentList.find((a: AgentPresence) => a.id === uid || a.user_id === uid || (a as any).agentId === uid);
        const me = meData || meFromList;
        if (me || activeSession || currentSession) {
          const rawStatus = hasCheckedIn ? (currentSession?.currentState || activeSession?.raw_status || me?.status || "offline") : "offline";
          const normalizedStatus = (rawStatus.toLowerCase().trim()) as "ready" | "paused" | "in_call" | "offline" | "wrap_up" | "ringing";
          setMyStatus(normalizedStatus);
          setPauseReason(hasCheckedIn ? (activeSession?.currentBreak?.reason || me?.pause_reason || null) : null);
          const tel = currentSession?.telemetry || {};
          const fullMe = {
            ...me,
            ...activeSession,
            ...currentSession,
            id: uid,
            user_id: uid,
            status: normalizedStatus,
            login_at: hasCheckedIn ? (currentSession?.login_at || todayAtt?.check_in_time || activeSession?.loginTime || me?.login_at) : null,
            logout_at: activeSession?.logoutTime || me?.logout_at,
            current_break: hasCheckedIn ? (activeSession?.currentBreak || me?.current_break) : null,
            break_logs: hasCheckedIn ? (activeSession?.breakLogs || me?.break_logs) : [],
            ready_seconds: tel.readySeconds ?? me?.ready_seconds ?? 0,
            paused_seconds: tel.pauseSeconds ?? me?.paused_seconds ?? 0,
            talk_seconds: tel.talkSeconds ?? me?.talk_seconds ?? 0,
            ringing_seconds: tel.ringingSeconds ?? me?.ringing_seconds ?? 0,
            dispose_seconds: tel.wrapUpSeconds ?? me?.dispose_seconds ?? 0,
            gross_seconds: tel.sessionSeconds ?? me?.gross_seconds ?? 0,
            total_calls_handled: tel.callsHandled ?? me?.total_calls_handled ?? 0,
            breaks_taken: tel.breaksTaken ?? 0,
            state_started_at: currentSession?.stateStartedAt || me?.statusSince || new Date().toISOString()
          };
          setMyPresence((prev) => ({ ...prev, ...fullMe }));
        }
      } else if (summaryData && typeof summaryData.ready_count === "number") {
        setSummary(summaryData);
      }
    } catch (err) {
      console.warn("[PRESENCE] Error loading presence data:", err);
    } finally {
      isFetchingRef.current = false;
    }
  }, [user]);


  // Handle incoming presence updates & activity logs from WebSocket stream
  const handleWsMessage = useCallback((event: MessageEvent) => {
    try {
      if (!event.data) return;
      const payload = JSON.parse(event.data);
      window.dispatchEvent(new CustomEvent("forge_global_ws_msg", { detail: payload }));

      if (
        payload.event === "attendance:checked-in" ||
        payload.event === "attendance:checked-out" ||
        payload.event === "attendance:break-started" ||
        payload.event === "attendance:break-ended" ||
        payload.event === "attendance:status-changed" ||
        payload.event === "session:started" ||
        payload.event === "session:updated"
      ) {
        fetchPresenceData();
        // Re-dispatch as a DOM CustomEvent so any open modal (e.g. AttendanceSummaryModal)
        // can subscribe and refresh its own attendance data without coupling to this context.
        const attendanceEventName = payload.event || "attendance:status-changed";
        if (attendanceEventName.startsWith("attendance:") || attendanceEventName.startsWith("session:")) {
          window.dispatchEvent(new CustomEvent(attendanceEventName, { detail: payload.data }));
        }
      }

      if (payload.type === "lead_activity_updated" && payload.data) {
        window.dispatchEvent(new CustomEvent("lead_activity_updated", { detail: payload.data }));
      }

      if (
        payload.event === "recording.status_changed" ||
        payload.type === "recording_status_updated" ||
        payload.event === "recording_status_updated"
      ) {
        window.dispatchEvent(new CustomEvent("recording:status_changed", { detail: payload }));
        window.dispatchEvent(new CustomEvent("recording_status_updated", { detail: payload }));
      }

      if (payload.event === "CALL_RINGING" || payload.event === "call_ringing") {
        const targetId = payload.agent_id || payload.agentId || payload.user_id;
        if (user && (user.id === targetId || (user as any)._id === targetId)) {
          const stTime = payload.ringing_started_at || payload.timestamp || new Date().toISOString();
          setMyStatus("ringing");
          setMyPresence((prev: any) => ({
            ...prev,
            status: "ringing",
            state_started_at: stTime,
            status_since: stTime,
            currentCallId: payload.call_id || payload.callId
          }));
        }
      }

      if (payload.event === "CALL_CONNECTED" || payload.event === "call_connected") {
        const targetId = payload.agent_id || payload.agentId || payload.user_id;
        if (user && (user.id === targetId || (user as any)._id === targetId)) {
          const stTime = payload.connected_at || payload.timestamp || new Date().toISOString();
          setMyStatus("in_call");
          setMyPresence((prev: any) => ({
            ...prev,
            status: "in_call",
            state_started_at: stTime,
            status_since: stTime,
            currentCallId: payload.call_id || payload.callId
          }));
        }
      }

      if (payload.event === "CALL_WRAP_UP_STARTED" || payload.event === "agent.wrapup.started" || payload.type === "agent_wrapup_started" || payload.event === "CALL_ENDED" || payload.event === "call_ended") {
        const targetId = payload.agentId || payload.agent_id || payload.user_id;
        const isCurrentAgent = user && (!targetId || user.id === targetId || (user as any)._id === targetId);
        if (isCurrentAgent) {
          const stTime = payload.wrap_up_started_at || payload.dispositionStartedAt || payload.ended_at || payload.timestamp || new Date().toISOString();
          setMyStatus("wrap_up");
          setMyPresence((prev: any) => ({
            ...prev,
            status: "wrap_up",
            state_started_at: stTime,
            status_since: stTime,
            dispositionStartedAt: stTime,
            currentCallId: payload.callId || payload.call_id || prev?.currentCallId
          }));
        }
      }

      if (payload.event === "CALL_DISPOSITION_SAVED" || payload.event === "agent.wrapup.completed" || payload.type === "agent_wrapup_completed") {
        const targetId = payload.agentId || payload.agent_id || payload.user_id;
        if (user && (!targetId || user.id === targetId || (user as any)._id === targetId)) {
          const stTime = payload.timestamp || new Date().toISOString();
          setMyStatus("ready");
          setMyPresence((prev: any) => ({
            ...prev,
            status: "ready",
            state_started_at: stTime,
            status_since: stTime,
            currentCallId: null,
            dispositionStartedAt: null,
            dispose_seconds: (prev?.dispose_seconds || 0) + (payload.dispose_seconds || payload.disposeDurationSeconds || payload.wrap_up_seconds || 0)
          }));
        }
      }

      if (payload.type === "call_completed" && payload.data) {
        const { user_id, agent_id, total_calls_handled, talk_seconds, dispose_seconds } = payload.data;
        const targetId = user_id || agent_id;
        setAgents((prevAgents) =>
          prevAgents.map((agent) => {
            if (agent.id === targetId || agent.user_id === targetId) {
              const currentCalls = agent.total_calls_handled || 0;
              const nextCalls = typeof total_calls_handled === "number" ? total_calls_handled : currentCalls + 1;
              return {
                ...agent,
                total_calls_handled: nextCalls,
                talk_seconds: typeof talk_seconds === "number" ? talk_seconds : (agent.talk_seconds || 0),
                dispose_seconds: typeof dispose_seconds === "number" ? dispose_seconds : (agent.dispose_seconds || 0),
              };
            }
            return agent;
          })
        );

        if (user && (user.id === targetId || (user as any)._id === targetId)) {
          setMyPresence((prev: any) => prev ? {
            ...prev,
            dispose_seconds: typeof dispose_seconds === "number" ? dispose_seconds : (prev.dispose_seconds || 0),
            talk_seconds: typeof talk_seconds === "number" ? talk_seconds : (prev.talk_seconds || 0),
            total_calls_handled: typeof total_calls_handled === "number" ? total_calls_handled : ((prev.total_calls_handled || 0) + 1),
          } : prev);
        }
      }

      if (
        payload.type === "agent_presence_updated" ||
        payload.event === "session.state_changed" ||
        payload.event === "agent.status.changed" ||
        payload.event === "agent:status-changed" ||
        payload.type === "agent_status_changed"
      ) {
        const data = payload.data || payload.presence || payload;
        const targetId = payload.agentId || payload.user_id || payload.agent_id || data.agentId || data.user_id || data.id;
        
        if (targetId) {
          const rawStatus = payload.status || data.status || data.raw_status || data.currentState || "offline";
          const normalizedStatus = (rawStatus.toLowerCase().trim()) as "ready" | "paused" | "in_call" | "offline" | "checked_in" | "ringing" | "wrap_up";
          const incomingVersion = typeof payload.version === "number" ? payload.version : (typeof data.version === "number" ? data.version : null);
          const stateStartedAt = data.stateStartedAt || data.state_started_at || payload.timestamp || data.timestamp || new Date().toISOString();
          const tel = data.telemetry || {};

          setAgents((prevAgents) => {
            const index = prevAgents.findIndex((a) => a.id === targetId || a.user_id === targetId || a.agentId === targetId);
            let updatedList: AgentPresence[];

            if (index !== -1) {
              const existing = prevAgents[index];
              if (incomingVersion !== null && existing.version !== undefined && existing.version !== null && incomingVersion < existing.version) {
                return prevAgents;
              }

              updatedList = [...prevAgents];
              updatedList[index] = {
                ...existing,
                ...data,
                id: targetId,
                user_id: targetId,
                agentId: targetId,
                status: normalizedStatus,
                version: incomingVersion ?? ((existing.version || 0) + 1),
                statusSince: stateStartedAt,
                status_since: stateStartedAt,
                state_started_at: stateStartedAt,
                ready_seconds: tel.readySeconds ?? data.ready_seconds ?? existing.ready_seconds,
                paused_seconds: tel.pauseSeconds ?? data.paused_seconds ?? existing.paused_seconds,
                talk_seconds: tel.talkSeconds ?? data.talk_seconds ?? existing.talk_seconds,
                ringing_seconds: tel.ringingSeconds ?? data.ringing_seconds ?? existing.ringing_seconds,
                dispose_seconds: tel.wrapUpSeconds ?? data.dispose_seconds ?? existing.dispose_seconds,
                gross_seconds: tel.sessionSeconds ?? data.gross_seconds ?? existing.gross_seconds,
                total_calls_handled: tel.callsHandled ?? data.total_calls_handled ?? existing.total_calls_handled,
                breaks_taken: tel.breaksTaken ?? existing.breaks_taken,
              };
            } else {
              updatedList = [
                ...prevAgents,
                {
                  ...data,
                  id: targetId,
                  user_id: targetId,
                  agentId: targetId,
                  status: normalizedStatus,
                  version: incomingVersion ?? 1,
                  statusSince: stateStartedAt,
                  status_since: stateStartedAt,
                  state_started_at: stateStartedAt,
                  ready_seconds: tel.readySeconds ?? data.ready_seconds ?? 0,
                  paused_seconds: tel.pauseSeconds ?? data.paused_seconds ?? 0,
                  talk_seconds: tel.talkSeconds ?? data.talk_seconds ?? 0,
                  ringing_seconds: tel.ringingSeconds ?? data.ringing_seconds ?? 0,
                  dispose_seconds: tel.wrapUpSeconds ?? data.dispose_seconds ?? 0,
                  gross_seconds: tel.sessionSeconds ?? data.gross_seconds ?? 0,
                  total_calls_handled: tel.callsHandled ?? data.total_calls_handled ?? 0,
                  breaks_taken: tel.breaksTaken ?? 0,
                }
              ];
            }

            const newSummary = computeSummaryFromAgents(updatedList);
            setSummary(newSummary);

            return updatedList;
          });

          if (user && (user.id === targetId || (user as any)._id === targetId)) {
            setMyStatus(normalizedStatus);
            setPauseReason(data.pause_reason || payload.reason || (normalizedStatus === "paused" ? data.current_break?.type || "Personal Reason" : null));
            setMyPresence((prev: any) => ({
              ...(prev || {}),
              ...data,
              id: targetId,
              user_id: targetId,
              status: normalizedStatus,
              state_started_at: stateStartedAt,
              status_since: stateStartedAt,
              statusSince: stateStartedAt,
              ready_seconds: tel.readySeconds ?? data.ready_seconds ?? prev?.ready_seconds ?? 0,
              paused_seconds: tel.pauseSeconds ?? data.paused_seconds ?? prev?.paused_seconds ?? 0,
              talk_seconds: tel.talkSeconds ?? data.talk_seconds ?? prev?.talk_seconds ?? 0,
              ringing_seconds: tel.ringingSeconds ?? data.ringing_seconds ?? prev?.ringing_seconds ?? 0,
              dispose_seconds: tel.wrapUpSeconds ?? data.dispose_seconds ?? prev?.dispose_seconds ?? 0,
              gross_seconds: tel.sessionSeconds ?? data.gross_seconds ?? prev?.gross_seconds ?? 0,
              total_calls_handled: tel.callsHandled ?? data.total_calls_handled ?? prev?.total_calls_handled ?? 0,
              breaks_taken: tel.breaksTaken ?? prev?.breaks_taken ?? 0,
            }));
          }
        }
      }
    } catch {
      // Control messages (pong, etc.)
    }
  }, [user, fetchPresenceData]);

  const connectWebSocket = useCallback(() => {
    if (!user || isUnmountedRef.current || isAuthErrorRef.current) return;

    // Do NOT attempt WS connection without a valid token.
    // Without this guard, the reconnect backoff loop fires repeatedly after
    // session expiry, connecting as anonymous and causing infinite retries.
    const token = localStorage.getItem("access_token");
    if (!token) {
      console.warn("[SESSION WS] Skipping connection: no access token in localStorage");
      return;
    }

    if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const wsUrl = getWsUrl("/global");
      if (!wsUrl || wsUrl.includes("undefined")) {
        console.warn("[SESSION WS] Skipping invalid WS URL resolution:", wsUrl);
        return;
      }

      console.log("[SESSION WS] Connecting to:", sanitizeUrl(wsUrl));
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      let isClosedByCleanup = false;

      ws.onopen = () => {
        if (isClosedByCleanup || isUnmountedRef.current) {
          try { ws.close(); } catch {}
          return;
        }
        setWsConnected(true);
        reconnectAttemptsRef.current = 0;
        isAuthErrorRef.current = false;
        fetchPresenceData();

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }

        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
          }
        }, 15000);
      };

      ws.onmessage = (evt) => {
        if (!isClosedByCleanup && !isUnmountedRef.current) {
          handleWsMessage(evt);
        }
      };

      ws.onclose = (evt: CloseEvent) => {
        setWsConnected(false);
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        if (isClosedByCleanup || isUnmountedRef.current) {
          return; // Cleanup triggered close: do NOT auto-reconnect
        }

        if (evt.code === 4001 || evt.code === 4003 || evt.code === 1008) {
          console.warn("[SESSION WS] Auth rejected by backend. Halting reconnect.");
          isAuthErrorRef.current = true;
          return;
        }

        const MAX_RECONNECT_ATTEMPTS = 10;
        const attempt = reconnectAttemptsRef.current + 1;
        if (attempt > MAX_RECONNECT_ATTEMPTS) {
          console.warn("[SESSION WS] Max reconnection attempts (10) reached. Halting auto-reconnect.");
          return;
        }
        reconnectAttemptsRef.current = attempt;
        const delay = Math.min(3000 * Math.pow(1.5, attempt - 1), 30000);

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isUnmountedRef.current) {
            connectWebSocket();
          }
        }, delay);
      };

      ws.onerror = (err) => {
        console.warn("[SESSION WS] Socket error:", err);
        setWsConnected(false);
      };
    } catch (err) {
      console.warn("[SESSION WS] Error establishing socket:", err);
      setWsConnected(false);
    }
  }, [user, handleWsMessage, fetchPresenceData]);

  useEffect(() => {
    isUnmountedRef.current = false;
    isAuthErrorRef.current = false;
    isFetchingRef.current = false;

    if (user) {
      fetchPresenceData();
      connectWebSocket();
    }

    // 30-second polling fallback: keeps presence state fresh when WebSocket
    // is temporarily unavailable (e.g. network blip, server restart).
    // Only runs when authenticated; cancelled immediately on unmount/logout.
    let pollId: NodeJS.Timeout | null = null;
    if (user) {
      pollId = setInterval(() => {
        if (!isUnmountedRef.current) {
          fetchPresenceData();
        }
      }, 30000);
    }

    return () => {
      isUnmountedRef.current = true;
      if (pollId) clearInterval(pollId);
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (socketRef.current) {
        const s = socketRef.current;
        s.onopen = null;
        s.onmessage = null;
        s.onclose = null;
        s.onerror = null;
        if (s.readyState === WebSocket.OPEN) {
          try { s.close(1000, "Component unmounted"); } catch {}
        } else if (s.readyState === WebSocket.CONNECTING) {
          s.onopen = () => {
            try { s.close(1000, "Component unmounted"); } catch {}
          };
        }
        socketRef.current = null;
      }
    };
  }, [user]);

  const [isSubmittingStatus, setIsSubmittingStatus] = useState<boolean>(false);

  const displayStatus: "AVAILABLE" | "ON_BREAK" | "IN_CALL" | "OFFLINE" = useMemo(() => {
    if (myStatus === "ready") return "AVAILABLE";
    if (myStatus === "paused") return "ON_BREAK";
    if (myStatus === "in_call") return "IN_CALL";
    return "OFFLINE";
  }, [myStatus]);

  const breakType = useMemo(() => {
    if (myStatus !== "paused") return null;
    const r = myPresence?.current_break?.type || pauseReason || "";
    const u = r.toUpperCase();
    if (u.includes("LUNCH")) return "LUNCH";
    if (u.includes("TEA") || u.includes("REFRESHMENT")) return "TEA";
    return "PERSONAL";
  }, [myStatus, myPresence?.current_break?.type, pauseReason]);

  const breakStartedAt = useMemo(() => {
    if (myStatus !== "paused") return null;
    return myPresence?.current_break?.start_time || myPresence?.last_status_change || null;
  }, [myStatus, myPresence?.current_break?.start_time, myPresence?.last_status_change]);

  const setPresenceStatus = async (
    newStatus: "ready" | "paused" | "in_call" | "offline" | "checked_in" | "ringing" | "wrap_up",
    newPauseReason?: string,
    forceOffline: boolean = false
  ) => {
    if (isSubmittingStatus) return;

    if (newStatus === "paused" && totalBreakSeconds >= MAX_BREAK_SECONDS) {
      throw new Error("Maximum daily break limit of 1 hr 3 min reached. You cannot take any more breaks today.");
    }

    if (newStatus === "offline" && !forceOffline && grossLoginSeconds < SHIFT_TARGET_SECONDS) {
      throw new Error("Shift incomplete. You must complete 8 hours of login shift time (including breaks) before going offline.");
    }

    setIsSubmittingStatus(true);

    const prevStatus = myStatus;
    const prevPauseReason = pauseReason;

    // Optimistically set local state
    setMyStatus(newStatus);
    if (newPauseReason !== undefined) setPauseReason(newPauseReason);

    if (newStatus === "paused") {
      if (!pauseStartedAtRef.current) pauseStartedAtRef.current = Date.now();
    } else if (newStatus === "ready") {
      pauseStartedAtRef.current = null;
    }

    try {
      let response: any = null;

      // Primary REST route targeting /api/agent/session/*
      const primaryEndpoint = newStatus === "ready"
        ? (prevStatus === "paused" ? "/api/agent/session/resume" : "/api/agent/session/start")
        : newStatus === "paused" ? "/api/agent/session/break"
        : newStatus === "offline" ? "/api/agent/session/logout"
        : "/api/presence/status";

      const fallbackEndpoint = newStatus === "ready" ? "/api/agents/me/break/resume"
        : newStatus === "paused" ? "/api/agents/me/break/start"
        : newStatus === "offline" ? "/api/agents/me/offline"
        : "/api/presence/status";

      console.log("[SESSION API] Sending outbound status change to:", primaryEndpoint, {
        status: newStatus,
        pause_reason: newPauseReason || null,
        force_offline: forceOffline,
      });

      try {
        response = await api.post(primaryEndpoint, {
          break_type: newPauseReason || null,
          reason: newPauseReason || null,
          status: newStatus,
          pause_reason: newPauseReason || null,
          force_offline: forceOffline,
        });
      } catch {
        try {
          response = await api.post(fallbackEndpoint, {
            break_type: newPauseReason || null,
            reason: newPauseReason || null,
            status: newStatus,
            pause_reason: newPauseReason || null,
            force_offline: forceOffline,
          });
        } catch {
          response = await api.post("/api/presence/status", {
            status: newStatus,
            pause_reason: newPauseReason || null,
            force_offline: forceOffline,
          });
        }
      }

      console.log("[SESSION API] Received server response:", response);

      if (response && (response.presence || response.status)) {
        const updated = (response.presence || response) as AgentPresence;
        if (updated && updated.status) {
          const rawSt = updated.status || newStatus;
          const normSt = (rawSt.toLowerCase().trim()) as "ready" | "paused" | "in_call" | "offline";
          setMyStatus(normSt);
          if (updated.pause_reason !== undefined) setPauseReason(updated.pause_reason);
          setMyPresence((prev) => ({
            ...prev,
            ...updated,
            status: normSt,
            pause_reason: updated.pause_reason !== undefined ? updated.pause_reason : newPauseReason || null,
          }));
        }
      }

      await fetchPresenceData();
    } catch (err: any) {
      console.warn("[PRESENCE] Status update server error/rejection:", err?.response?.data || err?.message || err);
      // Rollback optimistic update to authoritative state
      setMyStatus(prevStatus);
      setPauseReason(prevPauseReason);
      await fetchPresenceData();
      throw err;
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  const checkIn = async (location: string = "Krishnagiri Office") => {
    if (isSubmittingStatus) return;
    setIsSubmittingStatus(true);
    try {
      await api.post("/api/attendance/check-in", { location });
      setIsCheckedInToday(true);
      setMyStatus("ready");
      await fetchPresenceData();
    } catch (err: any) {
      console.warn("[PRESENCE] Check-in error:", err);
      await fetchPresenceData();
      throw err;
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  const checkOut = async () => {
    if (isSubmittingStatus) return;
    setIsSubmittingStatus(true);
    try {
      await api.post("/api/attendance/check-out");
      setIsCheckedInToday(false);
      setMyStatus("offline");
      await fetchPresenceData();
    } catch (err: any) {
      console.warn("[PRESENCE] Check-out error:", err);
      await fetchPresenceData();
      throw err;
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  const startBreak = async (selectedBreakType: string) => {
    return setPresenceStatus("paused", selectedBreakType);
  };

  const resumeWork = async () => {
    return setPresenceStatus("ready");
  };

  const goOffline = async (forceOffline: boolean = true) => {
    if (myStatus === "in_call") {
      throw new Error("Cannot go offline while an active call is in progress. Please complete disposition first.");
    }
    return setPresenceStatus("offline", undefined, forceOffline);
  };

  const goOnline = async () => {
    return setPresenceStatus("ready");
  };

  const updateCallTelemetry = (stats: {
    ringing_seconds?: number;
    setup_seconds?: number;
    talk_seconds?: number;
    dispose_seconds?: number;
    calls_handled?: number;
  }) => {
    if (!user) return;
    setAgents((prev) =>
      prev.map((agent) => {
        if (agent.id === user.id || agent.user_id === user.id) {
          return {
            ...agent,
            ringing_seconds: (agent.ringing_seconds || 0) + (stats.ringing_seconds || 0),
            setup_seconds: (agent.setup_seconds || 0) + (stats.setup_seconds || 0),
            talk_seconds: (agent.talk_seconds || 0) + (stats.talk_seconds || 0),
            dispose_seconds: (agent.dispose_seconds || 0) + (stats.dispose_seconds || 0),
            total_calls_handled: (agent.total_calls_handled || 0) + (stats.calls_handled || 0),
          };
        }
        return agent;
      })
    );
  };

  return (
    <PresenceContext.Provider
      value={{
        nowTicker,
        myStatus,
        displayStatus,
        pauseReason,
        breakType,
        breakStartedAt,
        myPresence,
        agents,
        summary,
        wsConnected,
        isSubmittingStatus,
        isCheckedInToday,
        isLiveModalOpen,
        setIsLiveModalOpen,
        openLiveModal,
        closeLiveModal,
        netWorkingSeconds: calculatedWorkingSeconds,
        grossLoginSeconds,
        totalBreakSeconds,
        activeBreakSeconds,
        readySeconds,
        talkSeconds,
        ringingSeconds,
        setupSeconds,
        disposeSeconds,
        activeDisposeSeconds,
        waitingSeconds,
        activeWaitingSeconds,
        totalWaitingSeconds,
        currentWaitingSeconds,
        stopCount,
        isShiftTargetReached,
        remainingSeconds: Math.max(0, SHIFT_TARGET_SECONDS - grossLoginSeconds),
        shiftTargetSeconds: SHIFT_TARGET_SECONDS,
        maxBreakSeconds: MAX_BREAK_SECONDS,
        isMaxBreakReached,
        remainingBreakSeconds,
        setPresenceStatus,
        checkIn,
        checkOut,
        startBreak,
        resumeWork,
        goOffline,
        goOnline,
        refreshPresence: fetchPresenceData,
        updateCallTelemetry,
      }}
    >
      {children}
    </PresenceContext.Provider>
  );
};

export const usePresence = () => {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error("usePresence must be used within a PresenceProvider");
  }
  return context;
};
