import React, { useState } from "react";
import BlobCanvas from "@/components/blob/BlobCanvas";
import ColorPicker from "@/components/blob/ColorPicker";

export default function Home() {
  const [color, setColor] = useState("#00ffaa");
  const [gyroEnabled, setGyroEnabled] = useState(false);
  const [showGyroBtn, setShowGyroBtn] = useState(
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  );

  const requestGyro = async () => {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res === "granted") {
        setGyroEnabled(true);
        setShowGyroBtn(false);
      }
    } catch (e) {
      setShowGyroBtn(false);
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ touchAction: "none" }}>
      <BlobCanvas color={color} />
      <ColorPicker color={color} onChange={setColor} />

      {showGyroBtn && !gyroEnabled && (
        <button
          data-ui="true"
          onClick={requestGyro}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full text-sm font-medium text-white/90"
          style={{
            background: "rgba(255,255,255,0.07)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.37)",
          }}
        >
          🌀 Enable Tilt & Shake
        </button>
      )}
    </div>
  );
}
