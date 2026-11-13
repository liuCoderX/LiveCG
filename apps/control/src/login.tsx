import { createRoot } from "react-dom/client";
import "./styles/pages.css";
import { LoginApp } from "./pages/LoginApp.tsx";

createRoot(document.getElementById("root")!).render(<LoginApp />);
