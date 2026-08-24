import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// Global Scripts
import "../scripts/apple-emoji.js";
import "./configs/i18n.js";

// Styles
import "./styles/tailwind.css";

createRoot(document.getElementById("appRoot")).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
