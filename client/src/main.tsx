import { createRoot } from "react-dom/client";
import AppRoot from "./AppRoot";
import { installApiFetch } from "./lib/api-base";
import "./index.css";

installApiFetch();

console.log("Main mounting via AppRoot...");
createRoot(document.getElementById("root")!).render(<AppRoot />);
