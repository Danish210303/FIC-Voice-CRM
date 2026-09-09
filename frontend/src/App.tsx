import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Leads from "./pages/Leads";
import Campaigns from "./pages/Campaigns";
import Users from "./pages/Users";
import LiveCalls from "./pages/LiveCalls";
import Reports from "./pages/Reports";
import Leave from "./pages/Leave";
import Dialer from "./pages/Dialer";
import Quality from "./pages/Quality";
import AIAgents from "./pages/AIAgents";
import Recordings from "./pages/Recordings";
import FollowUps from "./pages/FollowUps";
import DueFollowUpAlert from "./components/DueFollowUpAlert";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DesktopTitleBar } from "./components/DesktopTitleBar";

function ProtectedRoute({ children, roles }: { children: JSX.Element; roles?: string[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col antialiased selection:bg-amber-500/30 selection:text-amber-200">
        <DesktopTitleBar />
        <div className="flex-1 flex flex-col min-h-0">
          <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >

        <Route index element={<Dashboard />} />
        <Route path="leads" element={<Leads />} />
        <Route
          path="ai-agents"
          element={
            <ProtectedRoute roles={["admin", "team_leader", "agent"]}>
              <AIAgents />
            </ProtectedRoute>
          }
        />
        <Route
          path="campaigns"
          element={
            <ProtectedRoute roles={["admin", "team_leader", "agent"]}>
              <Campaigns />
            </ProtectedRoute>
          }
        />
        <Route
          path="campaigns-list"
          element={
            <ProtectedRoute roles={["admin", "team_leader", "agent"]}>
              <Campaigns />
            </ProtectedRoute>
          }
        />
        <Route
          path="users"
          element={
            <ProtectedRoute roles={["admin", "team_leader"]}>
              <Users />
            </ProtectedRoute>
          }
        />
        <Route
          path="live-calls"
          element={
            <ProtectedRoute roles={["admin", "team_leader"]}>
              <LiveCalls />
            </ProtectedRoute>
          }
        />
        <Route
          path="reports"
          element={
            <ProtectedRoute roles={["admin", "team_leader", "agent"]}>
              <Reports />
            </ProtectedRoute>
          }
        />
        <Route
          path="leave"
          element={
            <ProtectedRoute roles={["admin", "team_leader"]}>
              <Leave />
            </ProtectedRoute>
          }
        />
        <Route
          path="quality"
          element={
            <ProtectedRoute roles={["admin", "team_leader"]}>
              <Quality />
            </ProtectedRoute>
          }
        />
        <Route
          path="recordings"
          element={
            <ProtectedRoute roles={["admin", "team_leader", "agent"]}>
              <Recordings />
            </ProtectedRoute>
          }
        />
        <Route
          path="follow-ups"
          element={
            <ProtectedRoute roles={["admin", "team_leader", "agent"]}>
              <FollowUps />
            </ProtectedRoute>
          }
        />
        <Route
          path="dialer"
          element={
            <ProtectedRoute roles={["admin", "team_leader", "agent"]}>
              <Dialer />
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
          <DueFollowUpAlert />
        </div>
      </div>
    </ErrorBoundary>
  );
}
