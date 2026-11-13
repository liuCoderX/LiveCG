import { createRoot } from "react-dom/client";
import "./styles/control.css";
import { ToastProvider } from "./lib/toast.tsx";
import { ControlApp } from "./control/ControlApp.tsx";

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <ControlApp />
  </ToastProvider>,
);
