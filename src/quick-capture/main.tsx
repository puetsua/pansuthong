import React from "react";
import ReactDOM from "react-dom/client";
import { QuickCapture } from "./QuickCapture";
import "../styles/tokens.css";
import "./quick-capture.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QuickCapture />
  </React.StrictMode>
);
