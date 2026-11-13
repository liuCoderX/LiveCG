import { createRoot } from "react-dom/client";
import "./styles/rooms.css";
import { ToastProvider } from "./lib/toast.tsx";
import { RoomsApp } from "./rooms/RoomsApp.tsx";

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <RoomsApp />
  </ToastProvider>,
);
