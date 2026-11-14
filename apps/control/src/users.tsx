import { createRoot } from "react-dom/client";
import "./styles/pages.css";
import { ToastProvider } from "./lib/toast.tsx";
import { RequireLogin } from "./lib/auth.tsx";
import { UsersApp } from "./pages/UsersApp.tsx";

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <RequireLogin>
      <UsersApp />
    </RequireLogin>
  </ToastProvider>,
);
