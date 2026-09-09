import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { api, getWsUrl } from "../api/client";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";

export interface FollowUpItem {
  id: string;
  _id?: string;
  customer_id: string;
  lead_id?: string;
  customer_name: string;
  customer_phone: string;
  agent_id: string;
  agent_name: string;
  agent_employee_id?: string;
  pool_id: string;
  pool_name: string;
  follow_up_datetime: string;
  reason: string;
  notes?: string;
  status: "scheduled" | "due" | "completed" | "missed" | "cancelled";
  priority?: "low" | "medium" | "high" | "urgent";
  time_zone?: string;
  related_call_id?: string;
  related_call?: {
    id: string;
    duration_seconds: number;
    outcome: string;
    notes?: string;
    started_at: string;
    recording_url?: string;
  };
  completion_outcome?: string;
  completion_notes?: string;
  created_at: string;
  completed_at?: string;
  missed_at?: string;
}

export interface FollowUpStats {
  upcoming: number;
  due_now: number;
  due: number;
  completed: number;
  missed: number;
  total: number;
}

interface FollowUpContextType {
  followUps: FollowUpItem[];
  stats: FollowUpStats;
  loading: boolean;
  activeDueFollowUp: FollowUpItem | null;
  setActiveDueFollowUp: (fu: FollowUpItem | null) => void;
  fetchFollowUps: (statusFilter?: string, search?: string) => Promise<void>;
  fetchStats: () => Promise<void>;
  createFollowUp: (data: any) => Promise<FollowUpItem | null>;
  updateFollowUp: (id: string, updates: any) => Promise<FollowUpItem | null>;
  completeFollowUp: (id: string, callId?: string, outcome?: string, notes?: string) => Promise<boolean>;
  snoozeFollowUp: (id: string, minutes?: number) => Promise<boolean>;
  dismissDueAlert: () => void;
}

const FollowUpContext = createContext<FollowUpContextType | undefined>(undefined);

export function FollowUpProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [stats, setStats] = useState<FollowUpStats>({
    upcoming: 0,
    due_now: 0,
    due: 0,
    completed: 0,
    missed: 0,
    total: 0,
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [activeDueFollowUp, setActiveDueFollowUp] = useState<FollowUpItem | null>(null);

  const notifiedIdsRef = useRef<Set<string>>(new Set());

  // Request browser Notification permissions on mount
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    }
  }, []);

  const fetchStats = useCallback(async () => {
    if (!user) return;
    try {
      const res: any = await api.get("/api/follow-ups/stats");
      if (res && typeof res === "object" && "total" in res) {
        setStats(res as FollowUpStats);
      }
    } catch {
      // silent fallback
    }
  }, [user]);

  const fetchFollowUps = useCallback(
    async (statusFilter: string = "all", search: string = "") => {
      if (!user) return;
      try {
        setLoading(true);
        let url = `/api/follow-ups?limit=150`;
        if (statusFilter && statusFilter !== "all") {
          url += `&status=${encodeURIComponent(statusFilter)}`;
        }
        if (search) {
          url += `&search=${encodeURIComponent(search)}`;
        }
        const data = await api.get(url);
        if (Array.isArray(data)) {
          setFollowUps(data);
        } else {
          setFollowUps([]);
        }
        await fetchStats();
      } catch {
        setFollowUps([]);
      } finally {
        setLoading(false);
      }
    },
    [user, fetchStats]
  );

  // Trigger audio chime and desktop notification
  const notifyDueFollowUp = useCallback(
    (fu: FollowUpItem) => {
      if (!fu || !fu.id) return;
      if (notifiedIdsRef.current.has(fu.id)) return;
      notifiedIdsRef.current.add(fu.id);

      setActiveDueFollowUp(fu);

      // Play chime
      try {
        const audio = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");
        audio.volume = 0.5;
        audio.play().catch(() => {});
      } catch {}

      // Desktop HTML5 notification
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        try {
          const title = `⚠️ Follow-Up Due: ${fu.customer_name}`;
          const body = `Scheduled call with ${fu.customer_name} (${fu.customer_phone}) is due right now. Reason: ${fu.reason}`;
          new Notification(title, {
            body,
            icon: "/favicon.ico",
            tag: `followup_${fu.id}`,
            requireInteraction: true,
          });
        } catch {}
      }

      showToast(`Follow-Up Due: ${fu.customer_name} (${fu.customer_phone})`, "info");
    },
    [showToast]
  );

  // Real-time WebSocket event listener
  useEffect(() => {
    if (!user) return;

    fetchFollowUps("all");
    fetchStats();

    const handleWsEvent = (event: CustomEvent) => {
      const data = event.detail;
      if (!data) return;

      const eventType = (data.event || data.type || "").toUpperCase();

      if (eventType === "FOLLOW_UP_CREATED") {
        fetchStats();
        fetchFollowUps();
        showToast(`New Follow-Up scheduled for ${data.customer_name || "Customer"}`, "info");
      } else if (eventType === "FOLLOW_UP_DUE") {
        fetchStats();
        fetchFollowUps();
        const currentUserId = String(user.id);
        if (!data.agent_id || data.agent_id === currentUserId || user.role === "admin" || user.role === "team_leader") {
          notifyDueFollowUp({
            id: data.id || data.follow_up_id,
            customer_id: data.customer_id,
            customer_name: data.customer_name || "Customer",
            customer_phone: data.customer_phone || "",
            agent_id: data.agent_id || "",
            agent_name: data.agent_name || "Agent",
            pool_id: data.pool_id || "",
            pool_name: data.pool_name || "Support",
            follow_up_datetime: data.scheduled_datetime || new Date().toISOString(),
            reason: data.reason || "Follow-up due",
            status: "due",
            created_at: data.timestamp || new Date().toISOString(),
          });
        }
      } else if (eventType === "FOLLOW_UP_MISSED") {
        fetchStats();
        fetchFollowUps();
      } else if (eventType === "FOLLOW_UP_COMPLETED" || eventType === "FOLLOW_UP_UPDATED") {
        fetchStats();
        fetchFollowUps();
        if (activeDueFollowUp && (activeDueFollowUp.id === data.id || activeDueFollowUp.id === data.follow_up_id)) {
          setActiveDueFollowUp(null);
        }
      }
    };

    window.addEventListener("crm_ws_message" as any, handleWsEvent);
    window.addEventListener("ws_global_event" as any, handleWsEvent);

    return () => {
      window.removeEventListener("crm_ws_message" as any, handleWsEvent);
      window.removeEventListener("ws_global_event" as any, handleWsEvent);
    };
  }, [user, fetchFollowUps, fetchStats, notifyDueFollowUp, activeDueFollowUp, showToast]);

  const createFollowUp = async (data: any): Promise<FollowUpItem | null> => {
    try {
      const res: FollowUpItem = await api.post("/api/follow-ups", data);
      showToast(`Follow-Up scheduled successfully for ${res.customer_name}`, "success");
      await fetchStats();
      await fetchFollowUps();
      return res;
    } catch (err: any) {
      showToast(err.message || "Failed to schedule follow-up", "error");
      return null;
    }
  };

  const updateFollowUp = async (id: string, updates: any): Promise<FollowUpItem | null> => {
    try {
      const res: FollowUpItem = await api.patch(`/api/follow-ups/${id}`, updates);
      showToast("Follow-Up updated successfully", "success");
      await fetchStats();
      await fetchFollowUps();
      return res;
    } catch (err: any) {
      showToast(err.message || "Failed to update follow-up", "error");
      return null;
    }
  };

  const completeFollowUp = async (
    id: string,
    callId?: string,
    outcome?: string,
    notes?: string
  ): Promise<boolean> => {
    try {
      await api.post(`/api/follow-ups/${id}/complete`, {
        call_id: callId,
        outcome: outcome || "completed",
        notes,
      });
      showToast("Follow-Up marked as completed", "success");
      if (activeDueFollowUp && activeDueFollowUp.id === id) {
        setActiveDueFollowUp(null);
      }
      await fetchStats();
      await fetchFollowUps();
      return true;
    } catch (err: any) {
      showToast(err.message || "Failed to complete follow-up", "error");
      return false;
    }
  };

  const snoozeFollowUp = async (id: string, minutes: number = 10): Promise<boolean> => {
    try {
      const newTime = new Date(Date.now() + minutes * 60 * 1000).toISOString();
      await api.patch(`/api/follow-ups/${id}`, {
        follow_up_datetime: newTime,
        reschedule_reason: `Snoozed for ${minutes} minutes`,
      });
      showToast(`Follow-Up snoozed for ${minutes} minutes`, "info");
      if (activeDueFollowUp && activeDueFollowUp.id === id) {
        setActiveDueFollowUp(null);
      }
      await fetchStats();
      await fetchFollowUps();
      return true;
    } catch (err: any) {
      showToast(err.message || "Failed to snooze follow-up", "error");
      return false;
    }
  };

  const dismissDueAlert = () => {
    setActiveDueFollowUp(null);
  };

  return (
    <FollowUpContext.Provider
      value={{
        followUps,
        stats,
        loading,
        activeDueFollowUp,
        setActiveDueFollowUp,
        fetchFollowUps,
        fetchStats,
        createFollowUp,
        updateFollowUp,
        completeFollowUp,
        snoozeFollowUp,
        dismissDueAlert,
      }}
    >
      {children}
    </FollowUpContext.Provider>
  );
}

export function useFollowUps() {
  const context = useContext(FollowUpContext);
  if (!context) {
    throw new Error("useFollowUps must be used within a FollowUpProvider");
  }
  return context;
}
