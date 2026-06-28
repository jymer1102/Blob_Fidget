import React, { useRef, useEffect, useState } from "react";

export default function ColorPicker({ color, onChange }) {
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef(null);
  const rainbowRef = useRef(null);
  const hueRef = useRef(0);
  const [rainbow, setRainbow] = useState(false);

  const handleLabelClick = () => {
    clickCountRef.current += 1;
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => { clickCountRef.current = 0; }, 1500);

    if (clickCountRef.current >= 10) {
      clickCountRef.current = 0;
      clearTimeout(clickTimerRef.current);
      setRainbow(true);
    }
  };

  useEffect(() => {
    if (!rainbow) return;
    let running = true;
    const tick = () => {
      if (!running) return;
      hueRef.current = (hueRef.current + 1.2) % 360;
      const h = hueRef.current;
      const r = Math.round(255 * hslToR(h));
      const g = Math.round(255 * hslToG(h));
      const b = Math.round(255 * hslToB(h));
      const hex = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
      onChange(hex);
      rainbowRef.current = requestAnimationFrame(tick);
    };
    rainbowRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rainbowRef.current);
    };
  }, [rainbow, onChange]);

  // Stop rainbow on manual color input change
  const handleManualChange = (e) => {
    setRainbow(false);
    cancelAnimationFrame(rainbowRef.current);
    onChange(e.target.value);
  };

  return (
    <div
      data-ui="true"
      className="fixed top-6 left-6 z-50 flex items-center gap-3 px-4 py-2.5 rounded-full"
      style={{
        background: "rgba(255,255,255,0.05)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: rainbow ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(255,255,255,0.1)",
        boxShadow: rainbow
          ? `0 8px 32px rgba(0,0,0,0.37), 0 0 18px ${color}88`
          : "0 8px 32px rgba(0,0,0,0.37)",
        transition: "box-shadow 0.3s, border 0.3s",
      }}
    >
      <input
        type="color"
        value={color}
        onChange={handleManualChange}
        className="w-8 h-8 rounded-full border-2 border-white/80 cursor-pointer bg-transparent appearance-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-2 [&::-webkit-color-swatch]:border-white/80 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-2 [&::-moz-color-swatch]:border-white/80"
      />
      <span
        onClick={handleLabelClick}
        className="text-white/80 text-sm font-medium tracking-wide select-none cursor-default"
        style={rainbow ? { color: color, transition: "color 0.1s", textShadow: `0 0 8px ${color}` } : {}}
      >
        Blob Tint
      </span>
    </div>
  );
}

// HSL (hue 0-360, s=1, l=0.5) to RGB helpers
function hslToR(h) { return hueChannel(h, 0); }
function hslToG(h) { return hueChannel(h, 8); }
function hslToB(h) { return hueChannel(h, 4); }
function hueChannel(h, n) {
  const k = (n + h / 30) % 12;
  return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
}
