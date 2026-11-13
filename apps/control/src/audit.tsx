import { createRoot } from "react-dom/client";
import "./styles/pages.css";
import { ToastProvider } from "./lib/toast.tsx";
import { RequireLogin } from "./lib/auth.tsx";
import { AuditApp } from "./pages/AuditApp.tsx";

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <RequireLogin role="admin">
      <AuditApp />
    </RequireLogin>
  </ToastProvider>,
);
