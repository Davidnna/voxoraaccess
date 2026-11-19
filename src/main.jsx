import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./App.jsx";
import VoiceAssistant from "./components/VoiceAssistant.jsx";
import "./styles/app.css";

function VoxoraApplication() {
    return (
        <BrowserRouter>
            <>
                <AppRoutes/>
                <VoiceAssistant/>
            </>
        </BrowserRouter>
    );
}

createRoot(document.getElementById("voxora-app-root")).render(<VoxoraApplication/>);
