import { createRoot } from "react-dom/client";
import { IconContext } from "@phosphor-icons/react";
// Fonts are bundled (Latin + Devanagari subsets load only when a page uses them).
import "@fontsource/mukta/400.css";
import "@fontsource/mukta/500.css";
import "@fontsource/mukta/600.css";
import "@fontsource/mukta/700.css";
import "@fontsource/kalam/400.css";
import "@fontsource/kalam/700.css";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <IconContext.Provider value={{ size: "1.15em", weight: "bold" }}>
    <App />
  </IconContext.Provider>,
);
