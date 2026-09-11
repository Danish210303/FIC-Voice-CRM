import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { api } from "../api/client";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";

export interface FollowUpTimelineItem {
  id: string;
  timestamp: string;
  action: string;
  description: string;
  actor: string;
  actor_role?: string;
  metadata?: Record<string, any>;
}

export interface FollowUpAttemptItem {
  attempt_number: number;
  call_id?: string;
  agent_id?: string;
  agent_name?: string;
  timestamp: string;
  status?: string;
  outcome?: string;
  duration_seconds?: number;
  notes?: string;
}

export interface FollowUpItem {
  id: string;
  _id?: string;
  follow_up_id?: string;
  customer_id: string;
  lead_id?: string;
  customer_name: string;
  customer_phone: string;
  phone_number?: string;
  original_agent_id?: string;
  original_agent_name?: string;
  assigned_agent_id?: string;
  assigned_agent_name?: string;
  current_agent_id?: string;
  current_agent_name?: string;
  agent_id: string;
  agent_name: string;
  agent_employee_id?: string;
  pool_id: string;
  pool_name: string;
  scheduled_at?: string;
  follow_up_datetime: string;
  scheduled_at_ist?: string;
  follow_up_datetime_ist?: string;
  formatted_ist?: string;
  reason: string;
  notes?: string;
  status:
    | "scheduled"
    | "due"
    | "waiting_for_agent"
    | "auto_calling"
    | "connected"
    | "no_answer"
    | "completed"
    | "missed"
    | "cancelled";
  priority?: "low" | "medium" | "high" | "urgent";
  time_zone?: string;
  original_call_id?: string;
  related_call_id?: string;
  related_call?: {
    id: string;
    duration_seconds: number;
    outcome: string;
    notes?: string;
    started_at: string;
    recording_url?: string;
  };
  timeline?: FollowUpTimelineItem[];
  attempts?: FollowUpAttemptItem[];
  call_attempts_count?: number;
  completion_outcome?: string;
  completion_notes?: string;
  disposition?: string;
  final_disposition?: string;
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
  cancelled?: number;
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
  triggerAutoCall: (id: string) => Promise<boolean>;
  reassignFollowUp: (id: string, agentId?: string, poolId?: string, notes?: string) => Promise<boolean>;
  snoozeFollowUp: (id: string, minutes?: number) => Promise<boolean>;
  cancelFollowUp: (id: string, reason?: string) => Promise<boolean>;
  deleteFollowUp: (id: string, reason?: string) => Promise<boolean>;
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
    try {
      const res: any = await api.get("/api/follow-ups/stats");
      if (res && typeof res === "object") {
        const s = res.stats || res;
        setStats({
          upcoming: s.upcoming || 0,
          due_now: s.due_now || s.due || 0,
          due: s.due || 0,
          completed: s.completed || 0,
          missed: s.missed || 0,
          total: s.total || (s.upcoming || 0) + (s.due || 0) + (s.completed || 0) + (s.missed || 0),
        });
      }
    } catch (err) {
      console.warn("[FOLLOW-UP] Failed to fetch follow-up stats:", err);
    }
  }, []);

  const fetchFollowUps = useCallback(
    async (statusFilter?: string, search?: string) => {
      setLoading(true);
      try {
        const qParams = new URLSearchParams();
        qParams.set("limit", "150");
        if (statusFilter && statusFilter !== "all") qParams.set("status", statusFilter);
        if (search && search.trim()) qParams.set("search", search.trim());

        const res: any = await api.get(`/api/follow-ups?${qParams.toString()}`);
        const items = Array.isArray(res) ? res : res?.data || [];
        setFollowUps(items);
      } catch (err) {
        console.warn("[FOLLOW-UP] Failed to fetch follow-ups:", err);
        setFollowUps([]);
      } finally {
        setLoading(false);
      }
    },
    []
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
      } else if (eventType === "FOLLOW_UP_REASSIGNED") {
        fetchStats();
        fetchFollowUps();
        showToast(`Follow-up for ${data.customer_name || "Customer"} reassigned to ${data.reassigned_agent_name || "Agent"}`, "info");
      } else if (eventType === "FOLLOW_UP_WAITING_FOR_AGENT") {
        fetchStats();
        fetchFollowUps();
      } else if (eventType === "FOLLOW_UP_AUTO_CALLING") {
        fetchStats();
        fetchFollowUps();
        showToast(`🚀 Auto-Callback initiated with ${data.customer_name || "Customer"}`, "info");
      } else if (eventType === "FOLLOW_UP_MISSED") {
        fetchStats();
        fetchFollowUps();
      } else if (
        eventType === "FOLLOW_UP_COMPLETED" ||
        eventType === "FOLLOW_UP_UPDATED" ||
        eventType === "FOLLOW_UP_CANCELLED" ||
        eventType === "FOLLOW_UP_DELETED"
      ) {
        fetchStats();
        fetchFollowUps();
        if (activeDueFollowUp && (activeDueFollowUp.id === data.id || activeDueFollowUp.id === data.follow_up_id)) {
          setActiveDueFollowUp(null);
        }
      }
    };

    window.addEventListener("crm_ws_message" as any, handleWsEvent);
    window.addEventListener("ws_global_event" as any, handleWsEvent);
    window.addEventListener("forge_global_ws_msg" as any, handleWsEvent);

    return () => {
      window.removeEventListener("crm_ws_message" as any, handleWsEvent);
      window.removeEventListener("ws_global_event" as any, handleWsEvent);
      window.removeEventListener("forge_global_ws_msg" as any, handleWsEvent);
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

  const cancelFollowUp = async (id: string, reason?: string): Promise<boolean> => {
    try {
      try {
        await api.post(`/api/follow-ups/${id}/cancel`, {
          reason: reason || "Cancelled by agent",
          cancel_reason: reason || "Cancelled by agent",
        });
      } catch (postErr: any) {
        // Fallback 1: Try DELETE endpoint
        if (
          postErr?.status === 404 ||
          postErr?.message?.includes("404") ||
          postErr?.message?.includes("Not Found")
        ) {
          try {
            await api.delete(`/api/follow-ups/${id}`);
          } catch (delErr: any) {
            // Fallback 2: Try PATCH endpoint (supported in legacy backend)
            await api.patch(`/api/follow-ups/${id}`, {
              status: "cancelled",
              reschedule_reason: reason || "Cancelled / Archived by agent",
            });
          }
        } else {
          throw postErr;
        }
      }
      showToast("Follow-up archived / cancelled successfully", "success");
      if (activeDueFollowUp && activeDueFollowUp.id === id) {
        setActiveDueFollowUp(null);
      }
      await fetchStats();
      await fetchFollowUps();
      return true;
    } catch (err: any) {
      showToast(err.message || "Failed to delete/cancel follow-up", "error");
      return false;
    }
  };

  const deleteFollowUp = async (id: string, reason?: string): Promise<boolean> => {
    return cancelFollowUp(id, reason);
  };

  const triggerAutoCall = async (id: string): Promise<boolean> => {
    try {
      const res: any = await api.post(`/api/follow-ups/${id}/trigger-call`);
      showToast(res?.message || "Auto-callback triggered successfully", "success");
      await fetchStats();
      await fetchFollowUps();
      return true;
    } catch (err: any) {
      showToast(err.message || "Failed to trigger auto-call", "error");
      return false;
    }
  };

  const reassignFollowUp = async (
    id: string,
    agentId?: string,
    poolId?: string,
    notes?: string
  ): Promise<boolean> => {
    try {
      await api.post(`/api/follow-ups/${id}/reassign`, {
        agent_id: agentId,
        pool_id: poolId,
        notes,
      });
      showToast("Follow-up reassigned successfully", "success");
      await fetchStats();
      await fetchFollowUps();
      return true;
    } catch (err: any) {
      showToast(err.message || "Failed to reassign follow-up", "error");
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
        cancelFollowUp,
        deleteFollowUp,
        triggerAutoCall,
        reassignFollowUp,
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
