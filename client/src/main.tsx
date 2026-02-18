import { createRoot } from "react-dom/client";
import AppRoot from "./AppRoot";
import "./index.css";

console.log("Main mounting via AppRoot...");
createRoot(document.getElementById("root")!).render(<AppRoot />);
