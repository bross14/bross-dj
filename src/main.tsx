import { createRoot } from "react-dom/client";
import "./library";
import App from "./App";
import { Screen } from "./components/Screen";
import "./styles/tokens.css";
import "./styles/app.css";

// Ajustes de la versión anterior de la app (otro origen): se copian antes de
// arrancar, sin pisar nada que ya exista en este origen.
try {
  const raw = window.bross?.takeStorageMigration?.();
  if (raw) {
    const data = JSON.parse(raw) as Record<string, string>;
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith("bross.") && typeof v === "string" && localStorage.getItem(k) == null) localStorage.setItem(k, v);
    }
  }
} catch {
  /* sin ajustes para migrar */
}

// la ventana de pantalla (video / karaoke) es la misma app con #screen
createRoot(document.getElementById("root")!).render(location.hash === "#screen" ? <Screen /> : <App />);
