import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { PresenceProvider } from "./context/PresenceContext";
import { FollowUpProvider } from "./context/FollowUpContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <PresenceProvider>
          <ToastProvider>
            <FollowUpProvider>
              <App />
            </FollowUpProvider>
          </ToastProvider>
        </PresenceProvider>
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
);
