import { useState, useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useFollowUps } from "../context/FollowUpContext";
import ForgeLogo from "./ForgeLogo";
import GalaxyBackground3D from "./GalaxyBackground3D";
import { assets } from "../utils/assets";
import {
  Menu,
  X,
  LayoutGrid,
  Users,
  Megaphone,
  UserPlus,
  Radio,
  History,
  Phone,
  LogOut,
  ShieldCheck,
  Bell,
  ChevronRight,
  Activity,
  RefreshCw,
  Bot,
  FileAudio,
  Calendar
} from "lucide-react";

type NavGroup = {
  title: string;
  items: { to: string; label: string; icon: React.ReactNode; badge?: React.ReactNode }[];
};

export default function Layout() {
  const { user, logout } = useAuth();
  const { stats } = useFollowUps();
  const location = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Load collapse state from localStorage
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem("sidebar_collapsed");
    return saved ? JSON.parse(saved) : false;
  });

  const darkMode = false;
  const [showNotifications, setShowNotifications] = useState(false);

  // Enforce Light Theme Permanently
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    localStorage.removeItem("darkMode");
  }, []);

  // Ctrl + B keybinding to toggle sidebar expansion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.body.classList.contains("lead-modal-active")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setIsSidebarCollapsed((prev: boolean) => {
          const next = !prev;
          localStorage.setItem("sidebar_collapsed", JSON.stringify(next));
          return next;
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev: boolean) => {
      const next = !prev;
      localStorage.setItem("sidebar_collapsed", JSON.stringify(next));
      return next;
    });
  };

  const role = user?.role || "admin";

  const getNavGroups = (): NavGroup[] => {
    const followUpBadge =
      stats.due_now > 0 ? (
        <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-white animate-pulse">
          {stats.due_now} DUE
        </span>
      ) : stats.upcoming > 0 ? (
        <span className="ml-auto px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
          {stats.upcoming}
        </span>
      ) : undefined;

    if (role === "admin") {
      return [
        {
          title: "CORE CRM",
          items: [
            { to: "/", label: "Dashboard", icon: <LayoutGrid className="h-5 w-5" /> },
            { to: "/campaigns", label: "Campaigns", icon: <Megaphone className="h-5 w-5" /> },
            { to: "/leads", label: "Lead Management", icon: <Users className="h-5 w-5" /> },
            { to: "/follow-ups", label: "Follow-Up Tasks", icon: <Calendar className="h-5 w-5" />, badge: followUpBadge },
            {
              to: "/live-calls",
              label: "Live Calls",
              icon: <Radio className="h-5 w-5" />,
              badge: (
                <span className="relative ml-auto shrink-0 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
              )
            },
            { to: "/dialer", label: "Manual Dialer", icon: <Phone className="h-5 w-5" /> },
            { to: "/reports", label: "Call Logs", icon: <History className="h-5 w-5" /> },
            { to: "/recordings", label: "Call Recordings", icon: <FileAudio className="h-5 w-5" /> },
          ],
        },
        {
          title: "VERTICAL MODULES",
          items: [
            { to: "/quality", label: "Quality Audit", icon: <ShieldCheck className="h-5 w-5" /> },
            { to: "/users", label: "Recruitment", icon: <UserPlus className="h-5 w-5" /> },
          ],
        },
      ];
    } else if (role === "team_leader") {
      return [
        {
          title: "CORE CRM",
          items: [
            { to: "/", label: "Dashboard", icon: <LayoutGrid className="h-5 w-5" /> },
            { to: "/campaigns", label: "Campaigns", icon: <Megaphone className="h-5 w-5" /> },
            { to: "/leads", label: "Lead Management", icon: <Users className="h-5 w-5" /> },
            { to: "/follow-ups", label: "Follow-Up Tasks", icon: <Calendar className="h-5 w-5" />, badge: followUpBadge },
            {
              to: "/live-calls",
              label: "Live Calls",
              icon: <Radio className="h-5 w-5" />,
              badge: (
                <span className="relative ml-auto shrink-0 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
              )
            },
            { to: "/dialer", label: "Manual Dialer", icon: <Phone className="h-5 w-5" /> },
            { to: "/reports", label: "Call Logs", icon: <History className="h-5 w-5" /> },
            { to: "/recordings", label: "Call Recordings", icon: <FileAudio className="h-5 w-5" /> },
          ],
        },
        {
          title: "VERTICAL MODULES",
          items: [
            { to: "/quality", label: "Quality Audit", icon: <ShieldCheck className="h-5 w-5" /> },
            { to: "/users", label: "Recruitment", icon: <UserPlus className="h-5 w-5" /> },
          ],
        },
      ];
    } else {
      return [
        {
          title: "CORE CRM",
          items: [
            { to: "/", label: "Dashboard", icon: <LayoutGrid className="h-5 w-5" /> },
            { to: "/leads", label: "My Assigned Leads", icon: <Users className="h-5 w-5" /> },
            { to: "/follow-ups", label: "My Follow-Ups", icon: <Calendar className="h-5 w-5" />, badge: followUpBadge },
            { to: "/dialer", label: "Softphone Dialer", icon: <Phone className="h-5 w-5" /> },
            { to: "/campaigns", label: "Campaigns", icon: <Megaphone className="h-5 w-5" /> },
            { to: "/reports", label: "Call Logs", icon: <History className="h-5 w-5" /> },
            { to: "/recordings", label: "My Recordings", icon: <FileAudio className="h-5 w-5" /> },
          ],
        },
      ];
    }
  };

  const navGroups = getNavGroups();

  const getCurrentPageTitle = () => {
    const path = location.pathname;
    if (path === "/") return "CRM Overview Dashboard";
    if (path === "/ai-agents") return "AI Agent Engine & Voice Command Center";
    if (path === "/leads") return "Leads Management";
    if (path === "/campaigns" || path === "/campaigns-list") return "Campaigns";
    if (path === "/users") return "Recruitment & Access Control";
    if (path === "/live-calls") return "Live Call Console";
    if (path === "/reports") return "Call Logs & Analytics";
    if (path === "/recordings") return "Voice Call Recordings Vault";
    if (path === "/quality") return "Quality Audit";
    if (path === "/leave") return "Leave Approvals";
    if (path === "/dialer") return "Softphone Dialer";
    return "Workspace";
  };

  return (
    <div
      className={`h-screen w-screen overflow-hidden flex flex-col md:flex-row relative bg-transparent ${
        darkMode ? "text-white" : "text-slate-800"
      }`}
    >
      {/* ── 3D INTERACTIVE GALAXY & NEBULA BACKGROUND ── */}
      <GalaxyBackground3D darkMode={darkMode} />
      {/* Mobile Top Bar */}
      <header className="md:hidden flex items-center justify-between px-5 py-3 bg-[#081D38] text-white shadow-md z-40">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsMobileOpen(true)}
            className="p-1.5 hover:bg-white/10 rounded-xl transition"
            aria-label="Open Menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <ForgeLogo size="sm" variant="full" />
        </div>
        <div className="text-xs font-extrabold text-right flex items-center gap-1.5">
          <span className="text-[#3B82F6]">
            {user?.role === "team_leader" || user?.role === "supervisor" ? "Team Leader" : user?.role === "admin" ? "Admin" : "Agent"}
          </span>
          <span className="text-[#F4B400]">
            {user?.name?.split(" ")[0] || "User"}
          </span>
        </div>
      </header>

      {/* Mobile Sidebar Overlay */}
      {isMobileOpen && (
        <div
          onClick={() => setIsMobileOpen(false)}
          className="fixed inset-0 bg-black/70 z-50 md:hidden backdrop-blur-sm transition-opacity duration-300"
        />
      )}

      {/* ── SIDEBAR ── */}
      <aside
        className={`fixed md:static inset-y-0 left-0 ${
          isSidebarCollapsed ? "w-[72px]" : "w-[240px]"
        } h-full flex flex-col flex-shrink-0 z-50 transform transition-all duration-250 ease-in-out ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
        style={
          darkMode
            ? {
                background: "rgba(16, 27, 45, 0.85)",
                backdropFilter: "blur(12px)",
                borderRight: "1px solid rgba(255,255,255,0.06)",
                boxShadow: "4px 0 24px rgba(0,0,0,0.35)",
                color: "#F8FAFC",
              }
            : {
                background: "rgba(255,255,255,0.92)",
                backdropFilter: "blur(12px)",
                borderRight: "1px solid #E2E8F0",
                boxShadow: "4px 0 20px rgba(15,23,42,0.04)",
                color: "#0F172A",
              }
        }
      >
        {/* ── LOGO AREA ── */}
        <div
          className={`h-[72px] flex items-center justify-between shrink-0 select-none ${
            isSidebarCollapsed ? "px-3" : "px-4"
          }`}
          style={
            darkMode
              ? {
                  background: "linear-gradient(135deg,#0D1826 0%,#0F1D30 100%)",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                }
              : {
                  background: "#FFFFFF",
                  borderBottom: "1px solid #F1F5F9",
                }
          }
        >
          <div
            onClick={toggleSidebar}
            className="flex items-center gap-3 cursor-pointer overflow-hidden group"
            title={isSidebarCollapsed ? "Expand Sidebar (Ctrl + B)" : "Collapse Sidebar (Ctrl + B)"}
          >
            <div className="h-9 w-9 flex items-center justify-center shrink-0">
              <img
                src={assets.logoSquare}
                alt="Forge Emblem"
                className="h-8 w-8 object-contain"
                onError={(e) => {
                  e.currentTarget.src = assets.logoHorizontal;
                }}
              />
            </div>
            {!isSidebarCollapsed && (
              <div className="min-w-0">
                <h2 className="font-extrabold text-sm tracking-tight leading-tight truncate text-[#2563EB] dark:text-[#60A5FA]">
                  Forge CRM
                </h2>
                <span
                  className="text-[10px] font-bold tracking-wider uppercase block truncate text-[#F59E0B] dark:text-[#FFC107]"
                >
                  AI Voice Agent CRM
                </span>
              </div>
            )}
          </div>

          <button
            onClick={() => setIsMobileOpen(false)}
            className={`md:hidden p-1 rounded-lg transition ${darkMode ? "text-white/40 hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-slate-800 hover:bg-slate-100"}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── NAV GROUPS ── */}
        <nav
          className={`flex-1 ${
            isSidebarCollapsed ? "px-2 py-3 space-y-4" : "px-3 py-4 space-y-5"
          } overflow-y-auto no-scrollbar softphone-scrollbar sidebar-no-scrollbar [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]`}
        >
          {navGroups.map((group, gIdx) => (
            <div key={gIdx} className="space-y-0.5">
              {!isSidebarCollapsed ? (
                <div className="px-3 pb-1.5 text-[11px] font-extrabold tracking-widest uppercase flex items-center gap-1.5 select-none">
                  {(() => {
                    const words = group.title.split(" ");
                    const halfIndex = Math.ceil(words.length / 2);
                    const firstHalf = words.slice(0, halfIndex).join(" ");
                    const secondHalf = words.slice(halfIndex).join(" ");
                    return (
                      <>
                        <span className="text-[#1D4ED8] dark:text-[#3B82F6] font-black">{firstHalf}</span>
                        {secondHalf && <span className="text-[#F4B400] font-black">{secondHalf}</span>}
                      </>
                    );
                  })()}
                </div>
              ) : (
                gIdx > 0 && (
                  <div
                    className="w-8 mx-auto my-2"
                    style={{ borderTop: darkMode ? "1px solid rgba(255,255,255,0.07)" : "1px solid #F1F5F9" }}
                  />
                )
              )}

              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={() => setIsMobileOpen(false)}
                  className={({ isActive }) =>
                    `group relative flex items-center h-[44px] rounded-xl transition-all duration-200 ease-out select-none cursor-pointer z-10 ${
                      isSidebarCollapsed
                        ? `w-11 mx-auto justify-center ${
                            isActive
                              ? "bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white shadow-md shadow-blue-500/30 ring-1 ring-blue-400/40"
                              : darkMode
                              ? "text-slate-400 hover:text-white hover:bg-white/10"
                              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                          }`
                        : `w-full gap-3 px-3.5 text-sm font-medium ${
                            isActive
                              ? "bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white font-bold shadow-md shadow-blue-500/30 ring-1 ring-blue-400/40"
                              : darkMode
                              ? "text-slate-300 hover:text-white hover:bg-white/10"
                              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/90"
                          }`
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {/* Active Pill Indicator Dot */}
                      {isActive && !isSidebarCollapsed && (
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#FFC107] shadow-sm shadow-amber-400/60" />
                      )}

                      {/* Icon */}
                      <span
                        className={`relative flex items-center justify-center w-5 h-5 shrink-0 transition-colors duration-200 ${
                          isActive
                            ? "text-[#FFC107] drop-shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
                            : "text-slate-500 dark:text-slate-400 group-hover:text-[#2563EB] dark:group-hover:text-[#60A5FA]"
                        }`}
                      >
                        {item.icon}
                      </span>

                      {/* Label */}
                      {!isSidebarCollapsed && (
                        <span
                          className={`relative truncate text-[14px] tracking-tight flex-1 ${
                            isActive
                              ? "font-bold text-white"
                              : "font-medium text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white"
                          }`}
                        >
                          {item.label}
                        </span>
                      )}

                      {/* Badge */}
                      {!isSidebarCollapsed && item.badge}

                      {/* Collapsed Tooltip */}
                      {isSidebarCollapsed && (
                        <span
                          className="absolute left-full ml-3 px-3 py-1.5 text-xs font-semibold rounded-xl whitespace-nowrap z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-xl"
                          style={
                            darkMode
                              ? {
                                  background: "linear-gradient(135deg,#151F32 0%,#1B2740 100%)",
                                  border: "1px solid rgba(255,255,255,0.10)",
                                  boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
                                  color: "#F8FAFC",
                                }
                              : {
                                  background: "#FFFFFF",
                                  border: "1px solid #E2E8F0",
                                  boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
                                  color: "#0F172A",
                                }
                          }
                        >
                          {item.label}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* ── BOTTOM PROFILE SECTION ── */}
        <div
          className="p-3 space-y-2 shrink-0"
          style={
            darkMode
              ? {
                  background: "rgba(10,16,28,0.85)",
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                }
              : {
                  background: "#F8FAFC",
                  borderTop: "1px solid #E2E8F0",
                }
          }
        >
          {!isSidebarCollapsed ? (
            <>
              {/* User Profile Card */}
              <div
                className="flex items-center gap-3 p-2.5 rounded-[14px]"
                style={
                  darkMode
                    ? {
                        background: "linear-gradient(135deg,rgba(21,31,50,0.9) 0%,rgba(27,39,64,0.8) 100%)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
                      }
                    : {
                        background: "#FFFFFF",
                        border: "1px solid #E2E8F0",
                        boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
                      }
                }
              >
                <div
                  className="h-9 w-9 rounded-full font-extrabold text-sm flex items-center justify-center shrink-0 shadow-sm"
                  style={{
                    background: "linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%)",
                    color: "#FFC107",
                  }}
                >
                  {user?.name ? user.name[0].toUpperCase() : "A"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold text-xs truncate flex items-center gap-1.5">
                    <span className="text-[#1D4ED8] dark:text-[#3B82F6]">
                      {user?.role === "team_leader" || user?.role === "supervisor" ? "Team Leader" : user?.role === "admin" ? "Admin" : "Agent"}
                    </span>
                    <span className="text-[#F4B400]">
                      {user?.name || "Admin User"}
                    </span>
                  </div>
                  <div className="text-[10px] font-bold truncate text-slate-400 dark:text-[#94A3B8]">
                    {user?.email || user?.employee_id || "admin@forge.in"}
                  </div>
                </div>
              </div>

              {/* Version & Live Status */}
              <div className="flex items-center justify-between text-[10px] font-extrabold px-1">
                <span className={darkMode ? "text-slate-500" : "text-slate-400"}>v1.0 Enterprise</span>
                <span className="flex items-center gap-1.5" style={{ color: darkMode ? "#FCD34D" : "#059669" }}>
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                  />
                  LIVE SYNC
                </span>
              </div>

              {/* Logout */}
              <button
                onClick={() => {
                  logout();
                  window.location.hash = "#/login";
                }}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-xl transition font-semibold text-xs cursor-pointer text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                title="Logout"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span>Logout</span>
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-1">
              <div
                className="h-9 w-9 rounded-full font-extrabold text-sm flex items-center justify-center shadow-sm cursor-pointer"
                style={{
                  background: "linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%)",
                  color: "#FFC107",
                }}
                title={`${user?.name || "Admin User"} (${user?.role || "Admin"})`}
              >
                {user?.name ? user.name[0].toUpperCase() : "A"}
              </div>

              <button
                onClick={() => {
                  logout();
                  window.location.hash = "#/login";
                }}
                className="p-1.5 rounded-lg transition cursor-pointer text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── RIGHT MAIN CONTENT ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">

        {/* ── STICKY TOP HEADER ── */}
        <header
          className="sticky top-0 z-30 h-14 px-4 sm:px-5 flex items-center justify-between gap-4 shrink-0 transition-all duration-200"
          style={
            darkMode
              ? {
                  background: "rgba(10,16,28,0.85)",
                  borderBottom: "1px solid rgba(255,255,255,0.07)",
                  backdropFilter: "blur(16px) saturate(180%)",
                  WebkitBackdropFilter: "blur(16px) saturate(180%)",
                  boxShadow: "0 1px 0 rgba(255,255,255,0.04), 0 4px 20px rgba(0,0,0,0.3)",
                }
              : {
                  background: "rgba(255,255,255,0.88)",
                  borderBottom: "1px solid #E7ECF5",
                  backdropFilter: "blur(16px)",
                  boxShadow: "0 1px 0 rgba(0,0,0,0.04), 0 2px 12px rgba(0,0,0,0.06)",
                }
          }
        >
          {/* Left: Brand / Breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="hidden sm:flex items-center gap-2 pr-3.5 h-6"
              style={{ borderRight: darkMode ? "1px solid rgba(255,255,255,0.08)" : "1px solid #E7ECF5" }}
            >
              <ForgeLogo size="sm" variant="full" />
            </div>
            <div className="flex items-center gap-1.5 text-[14px] font-medium truncate">
              <span style={{ color: darkMode ? "rgba(100,116,139,0.85)" : "#94A3B8" }}>
                Dashboard
              </span>
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: darkMode ? "rgba(100,116,139,0.5)" : "#CBD5E1" }}
              />
              <span
                className="font-bold text-[14px]"
                style={{ color: darkMode ? "#60A5FA" : "#0F4FA8" }}
              >
                {getCurrentPageTitle()}
              </span>
            </div>
          </div>



          {/* Right Action Toolbar */}
          <div className="flex items-center gap-2">

            {/* Notifications Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative flex items-center justify-center h-9 w-9 rounded-xl transition-all duration-200 cursor-pointer"
                style={
                  darkMode
                    ? {
                        background: "rgba(21,31,50,0.7)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        color: "#94A3B8",
                      }
                    : { color: "#64748B" }
                }
                onMouseEnter={(e) => {
                  if (darkMode) {
                    (e.currentTarget as HTMLElement).style.background = "rgba(37,99,235,0.12)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(37,99,235,0.3)";
                    (e.currentTarget as HTMLElement).style.color = "#fff";
                    (e.currentTarget as HTMLElement).style.boxShadow = "0 0 20px rgba(37,99,235,0.25)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (darkMode) {
                    (e.currentTarget as HTMLElement).style.background = "rgba(21,31,50,0.7)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)";
                    (e.currentTarget as HTMLElement).style.color = "#94A3B8";
                    (e.currentTarget as HTMLElement).style.boxShadow = "none";
                  }
                }}
                title="Notifications"
              >
                <Bell className="h-4 w-4" />
                {/* Animated notification dot */}
                <span
                  className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full"
                  style={{
                    background: "#F59E0B",
                    boxShadow: darkMode
                      ? "0 0 6px rgba(245,158,11,0.7)"
                      : "0 0 0 2px white",
                    border: darkMode ? "none" : "2px solid white",
                  }}
                />
              </button>

              {showNotifications && (
                <div
                  className="absolute right-0 mt-2 w-80 p-4 z-50 text-xs animate-scale-in"
                  style={
                    darkMode
                      ? {
                          background: "linear-gradient(145deg,#151F32 0%,#1B2740 100%)",
                          border: "1px solid rgba(255,255,255,0.09)",
                          boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
                          borderRadius: 18,
                        }
                      : {
                          background: "#fff",
                          border: "1px solid #E7ECF5",
                          boxShadow: "0 20px 40px rgba(0,0,0,0.12)",
                          borderRadius: 18,
                        }
                  }
                >
                  <div
                    className="font-bold pb-2 mb-3 flex justify-between items-center"
                    style={{
                      color: darkMode ? "#F8FAFC" : "#0F172A",
                      borderBottom: darkMode
                        ? "1px solid rgba(255,255,255,0.07)"
                        : "1px solid #E7ECF5",
                    }}
                  >
                    <span>Notifications</span>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={
                        darkMode
                          ? { background: "rgba(37,99,235,0.15)", color: "#60A5FA" }
                          : { background: "#EFF6FF", color: "#0F4FA8" }
                      }
                    >
                      3 New
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div
                      className="p-2.5 rounded-xl"
                      style={{
                        background: darkMode ? "rgba(27,39,64,0.7)" : "#F8FAFC",
                      }}
                    >
                      <div
                        className="font-bold text-xs"
                        style={{ color: darkMode ? "#F8FAFC" : "#0F172A" }}
                      >
                        New Campaign Launched
                      </div>
                      <div
                        className="text-[11px] mt-0.5"
                        style={{ color: darkMode ? "#64748B" : "#94A3B8" }}
                      >
                        Outbound Sales Campaign active with 5 channels.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>



            {/* User Profile Pill */}
            <div className="flex items-center gap-2.5 bg-slate-100/90 dark:bg-[#151F32] px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-white/10 shadow-2xs">
              <div
                className="h-7 w-7 rounded-lg font-bold text-xs flex items-center justify-center shrink-0"
                style={
                  darkMode
                    ? {
                        background: "linear-gradient(135deg,#1D4ED8 0%,#2563EB 100%)",
                        color: "#FFC107",
                        boxShadow: "0 0 0 2px rgba(37,99,235,0.35)",
                      }
                    : {
                        background: "#0F4FA8",
                        color: "#FFC107",
                      }
                }
              >
                {user?.name ? user.name[0].toUpperCase() : "U"}
              </div>
              <div className="flex items-center gap-1.5 text-xs font-black">
                <span className="text-[#1D4ED8] dark:text-[#3B82F6]">
                  {user?.role === "team_leader" || user?.role === "supervisor" ? "Team Leader" : user?.role === "admin" ? "Admin" : "Agent"}
                </span>
                <span className="text-[#F4B400]">
                  {user?.name || "User"}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Scrollable Content Viewport */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-5 softphone-scrollbar relative z-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
