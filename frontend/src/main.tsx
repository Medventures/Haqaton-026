import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppRouter } from "@/app/router";
import { analyticsSessionId, track } from "@/analytics/tracker";
import "@/index.css";

analyticsSessionId();
track("session_started", { viewport: window.innerWidth < 768 ? "mobile" : "desktop" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  </StrictMode>,
);
