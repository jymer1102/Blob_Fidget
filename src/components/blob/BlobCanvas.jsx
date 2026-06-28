import React, { useRef, useEffect, useCallback } from "react";

const TOTAL_POINTS = 36;
const RADIUS = 85;
const TARGET_AREA = Math.PI * RADIUS * RADIUS;
const BASE_GRAVITY = 0.35;
const FRICTION = 0.985;
const BOUNCE = 0.15;
const MAX_VELOCITY = 12;
const MAX_STRETCH_FACTOR = 1.5;
const MIN_STRETCH_FACTOR = 0.5;
const VELOCITY_DEADZONE = 0.015;

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 0, g: 255, b: 170 };
}

function getArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(area * 0.5);
}

// Compute the "stretch axis" — direction from centroid toward the farthest point
function getBlobMetrics(pts) {
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;

  let maxDist = 0, maxIdx = 0;
  let minDist = Infinity, minIdx = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(pts[i].x - cx, pts[i].y - cy);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
    if (d < minDist) { minDist = d; minIdx = i; }
  }

  // Stretch axis angle: from centroid toward the bulge
  const stretchAngle = Math.atan2(pts[maxIdx].y - cy, pts[maxIdx].x - cx);
  // Squash ratio: how "flat" vs "elongated" the blob is
  const squash = minDist / maxDist; // 1 = circle, < 1 = stretched

  // Effective "light normal" — opposite to stretch so the thin side catches light
  const lightAngle = stretchAngle + Math.PI * 0.5;

  return { cx, cy, stretchAngle, squash, maxDist, minDist, lightAngle };
}

// ─── Audio engine (lazy init on first interaction) ───────────────────────────
let audioCtx = null;

function getAudioCtx() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  } catch (e) {
    return null;
  }
}

function playSquish(intensity = 1) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Soft wobble: band-pass filtered noise + light pitch envelope
  const bufSize = ctx.sampleRate * 0.12;
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);

  const src = ctx.createBufferSource();
  src.buffer = buf;

  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(280 + intensity * 180, t);
  bp.frequency.exponentialRampToValueAtTime(120, t + 0.1);
  bp.Q.value = 3.5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.min(0.18 * intensity, 0.22), t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

  src.connect(bp).connect(gain).connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.13);
}

function playThud(speed = 5) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const intensity = Math.min(speed / MAX_VELOCITY, 1);

  // Low thud: sine sweep downward
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(110 + intensity * 80, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);

  // Layer: short noise burst
  const bufSize = ctx.sampleRate * 0.08;
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = buf;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 200;

  const gainOsc = ctx.createGain();
  gainOsc.gain.setValueAtTime(0.28 * intensity, t);
  gainOsc.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

  const gainNoise = ctx.createGain();
  gainNoise.gain.setValueAtTime(0.12 * intensity, t);
  gainNoise.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);

  osc.connect(gainOsc).connect(ctx.destination);
  noiseSrc.connect(lp).connect(gainNoise).connect(ctx.destination);

  osc.start(t); osc.stop(t + 0.25);
  noiseSrc.start(t); noiseSrc.stop(t + 0.1);
}

function playStretch(amount = 1) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(60 + amount * 40, t);
  osc.frequency.linearRampToValueAtTime(80 + amount * 60, t + 0.08);
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.2);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.07 * Math.min(amount, 1.5), t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.22);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function BlobCanvas({ color = "#00ffaa", gravityRef: externalGravityRef, shakeRef: externalShakeRef }) {
  const canvasRef = useRef(null);
  const pointsRef = useRef([]);
  const mouseRef = useRef({ x: 0, y: 0, dragging: false });
  const animRef = useRef(null);
  const colorRef = useRef(color);

  // Smoothed visual state
  const smoothHiAngle = useRef(null);
  const smoothHiW = useRef(null);
  const smoothHiH = useRef(null);
  const smoothMaxDist = useRef(null);
  const smoothSquash = useRef(null);
  const smoothStretchAngle = useRef(null);
  const smoothLightX = useRef(null);
  const smoothLightY = useRef(null);
  const smoothShadowX = useRef(null);
  const smoothShadowY = useRef(null);

  // Gyroscope gravity & shake
  const gravityRef = useRef({ gx: 0, gy: BASE_GRAVITY });
  const shakeRef = useRef(false);

  // Expose refs to parent if needed
  useEffect(() => {
    if (externalGravityRef) externalGravityRef.current = gravityRef.current;
    if (externalShakeRef) externalShakeRef.current = shakeRef;
  }, [externalGravityRef, externalShakeRef]);

  // Sound throttle refs
  const lastSquishTime = useRef(0);
  const lastThudTime = useRef(0);
  const lastStretchTime = useRef(0);
  const prevSquashRef = useRef(1);
  const wasDraggingRef = useRef(false);
  // Track per-wall collision to avoid repeat thud on same contact
  const wallContactRef = useRef({ top: false, bottom: false, left: false, right: false });

  useEffect(() => { colorRef.current = color; }, [color]);

  const initPoints = useCallback((w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const pts = [];
    for (let i = 0; i < TOTAL_POINTS; i++) {
      const angle = (i / TOTAL_POINTS) * Math.PI * 2;
      pts.push({
        x: cx + Math.cos(angle) * RADIUS,
        y: cy + Math.sin(angle) * RADIUS,
        oldX: cx + Math.cos(angle) * RADIUS,
        oldY: cy + Math.sin(angle) * RADIUS,
        baseAngle: angle,
      });
    }
    pointsRef.current = pts;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      if (pointsRef.current.length === 0) initPoints(canvas.width, canvas.height);
    }
    resize();
    window.addEventListener("resize", resize);

    function updatePhysics() {
      const pts = pointsRef.current;
      const mouse = mouseRef.current;
      const n = pts.length;
      const now = performance.now();
      const margin = 12;
      const { gx, gy } = gravityRef.current;

      // Apply shake impulse once
      if (shakeRef.current) {
        shakeRef.current = false;
        const angle = Math.random() * Math.PI * 2;
        const impulse = 8;
        for (const p of pts) {
          p.oldX = p.x - Math.cos(angle) * impulse;
          p.oldY = p.y - Math.sin(angle) * impulse;
        }
        playSquish(2.0);
      }

      let cx = 0, cy = 0;
      for (const p of pts) { cx += p.x; cy += p.y; }
      cx /= n; cy /= n;

      const wc = wallContactRef.current;
      let hitWall = false, hitSpeed = 0;

      for (const p of pts) {
        let vx = (p.x - p.oldX) * FRICTION;
        let vy = (p.y - p.oldY) * FRICTION;

        if (Math.abs(vx) < VELOCITY_DEADZONE) vx = 0;
        if (Math.abs(vy) < VELOCITY_DEADZONE) vy = 0;

        const speed = Math.hypot(vx, vy);
        if (speed > MAX_VELOCITY) { vx = (vx / speed) * MAX_VELOCITY; vy = (vy / speed) * MAX_VELOCITY; }

        if (mouse.dragging) {
          const atc = Math.atan2(p.y - cy, p.x - cx);
          const tx = -Math.sin(atc), ty = Math.cos(atc);
          const dot = vx * tx + vy * ty;
          vx -= tx * dot * 0.45;
          vy -= ty * dot * 0.45;
        }

        p.oldX = p.x; p.oldY = p.y;
        p.x += vx + gx; p.y += vy + gy;

        if (mouse.dragging) {
          const dx = mouse.x - p.x, dy = mouse.y - p.y;
          const dist = Math.hypot(dx, dy);
          let pull = Math.max(0, 1 - dist / (RADIUS * 3.5));
          pull = pull * pull;
          p.x += dx * pull * 0.22; p.y += dy * pull * 0.22;
          const tdx = cx + Math.cos(p.baseAngle) * RADIUS;
          const tdy = cy + Math.sin(p.baseAngle) * RADIUS;
          p.x += (tdx - p.x) * 0.04; p.y += (tdy - p.y) * 0.04;
        }

        // Boundary + wall sound detection
        if (p.y > canvas.height - margin) {
          if (!wc.bottom) { hitWall = true; hitSpeed = Math.max(hitSpeed, Math.abs(vy)); wc.bottom = true; }
          p.y = canvas.height - margin;
          p.oldY = p.y + Math.abs(vy) * BOUNCE;
          p.oldX = p.x - (p.x - p.oldX) * 0.6;
        } else { wc.bottom = false; }

        if (p.y < margin) {
          if (!wc.top) { hitWall = true; hitSpeed = Math.max(hitSpeed, Math.abs(vy)); wc.top = true; }
          p.y = margin;
          p.oldY = p.y - Math.abs(vy) * BOUNCE;
        } else { wc.top = false; }

        if (p.x > canvas.width - margin) {
          if (!wc.right) { hitWall = true; hitSpeed = Math.max(hitSpeed, Math.abs(vx)); wc.right = true; }
          p.x = canvas.width - margin;
          p.oldX = p.x + Math.abs(vx) * BOUNCE;
          p.oldY = p.y - (p.y - p.oldY) * 0.6;
        } else { wc.right = false; }

        if (p.x < margin) {
          if (!wc.left) { hitWall = true; hitSpeed = Math.max(hitSpeed, Math.abs(vx)); wc.left = true; }
          p.x = margin;
          p.oldX = p.x - Math.abs(vx) * BOUNCE;
          p.oldY = p.y - (p.y - p.oldY) * 0.6;
        } else { wc.left = false; }
      }

      // Wall thud sound
      if (hitWall && hitSpeed > 1.5 && now - lastThudTime.current > 80) {
        lastThudTime.current = now;
        playThud(hitSpeed);
      }

      const restLength = (RADIUS * 2 * Math.PI) / n;
      for (let step = 0; step < 8; step++) {
        for (let i = 0; i < n; i++) {
          const p1 = pts[i], p2 = pts[(i + 1) % n];
          let dx = p2.x - p1.x, dy = p2.y - p1.y;
          let dist = Math.hypot(dx, dy);
          if (dist === 0) continue;

          const maxD = restLength * MAX_STRETCH_FACTOR, minD = restLength * MIN_STRETCH_FACTOR;
          if (dist > maxD) {
            const o = dist - maxD;
            p1.x += (dx / dist) * o * 0.5; p1.y += (dy / dist) * o * 0.5;
            p2.x -= (dx / dist) * o * 0.5; p2.y -= (dy / dist) * o * 0.5;
            dist = maxD;
          } else if (dist < minD) {
            const u = minD - dist;
            p1.x -= (dx / dist) * u * 0.5; p1.y -= (dy / dist) * u * 0.5;
            p2.x += (dx / dist) * u * 0.5; p2.y += (dy / dist) * u * 0.5;
            dist = minD;
          }

          const diff = restLength - dist;
          const elast = mouse.dragging ? 0.45 : 0.25;
          const ax = (dx / dist) * diff * elast, ay = (dy / dist) * diff * elast;
          p1.x -= ax; p1.y -= ay; p2.x += ax; p2.y += ay;
        }

        const currentArea = getArea(pts);
        const areaDelta = TARGET_AREA - currentArea;
        if (currentArea !== 0) {
          let pf = (areaDelta / currentArea) * (mouse.dragging ? 0.04 : 0.07);
          pf = Math.max(-0.04, Math.min(0.04, pf));
          for (const p of pts) { p.x += (p.x - cx) * pf; p.y += (p.y - cy) * pf; }
        }
      }

      // Squish / stretch sounds
      const { squash } = getBlobMetrics(pts);
      const prevSquash = prevSquashRef.current;
      const squashDelta = Math.abs(squash - prevSquash);
      prevSquashRef.current = squash;

      if (mouse.dragging) {
        // Drag squish feedback
        if (squashDelta > 0.012 && now - lastSquishTime.current > 90) {
          lastSquishTime.current = now;
          playSquish(squashDelta * 8);
        }
        // Stretch low rumble
        const stretchAmount = 1 - squash;
        if (stretchAmount > 0.25 && now - lastStretchTime.current > 160) {
          lastStretchTime.current = now;
          playStretch(stretchAmount * 2);
        }
      }

      // Grab / release
      if (mouse.dragging && !wasDraggingRef.current) {
        playSquish(1.2);
      }
      if (!mouse.dragging && wasDraggingRef.current) {
        playSquish(0.8);
      }
      wasDraggingRef.current = mouse.dragging;
    }

    function drawBlob() {
      ctx.fillStyle = "#05050a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const pts = pointsRef.current;
      if (pts.length === 0) return;
      const rgb = hexToRgb(colorRef.current);
      const n = pts.length;

      // ── Raw shape metrics ──────────────────────────────────────────────────
      const { cx, cy, stretchAngle, squash, maxDist, lightAngle } = getBlobMetrics(pts);
      if (!isFinite(cx) || !isFinite(cy) || !isFinite(maxDist) || maxDist < 1) return;

      const lightOffsetMag = RADIUS * (0.3 + (1 - squash) * 0.4);
      const rawLightX = cx + Math.cos(lightAngle - Math.PI * 0.6) * lightOffsetMag;
      const rawLightY = cy + Math.sin(lightAngle - Math.PI * 0.6) * lightOffsetMag;
      const rawShadowX = cx - Math.cos(lightAngle - Math.PI * 0.6) * maxDist * 0.55;
      const rawShadowY = cy - Math.sin(lightAngle - Math.PI * 0.6) * maxDist * 0.55;
      const rawHiW = maxDist * (0.28 + squash * 0.08);
      const rawHiH = maxDist * (0.14 + squash * 0.05);
      const rawHiAngle = lightAngle - Math.PI * 0.6 - Math.PI * 0.1;

      // LERP_FAST: position tracks centroid closely; LERP_SLOW: shape transitions gently
      const LERP_FAST = 0.18;
      const LERP_SLOW = 0.07;
      const lerpAngle = (cur, target, f) => {
        let da = target - cur;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        return cur + da * f;
      };

      if (smoothHiAngle.current === null) {
        smoothMaxDist.current = maxDist; smoothSquash.current = squash;
        smoothStretchAngle.current = stretchAngle;
        smoothHiAngle.current = rawHiAngle;
        smoothHiW.current = rawHiW; smoothHiH.current = rawHiH;
        smoothLightX.current = rawLightX; smoothLightY.current = rawLightY;
        smoothShadowX.current = rawShadowX; smoothShadowY.current = rawShadowY;
      } else {
        smoothLightX.current += (rawLightX - smoothLightX.current) * LERP_FAST;
        smoothLightY.current += (rawLightY - smoothLightY.current) * LERP_FAST;
        smoothShadowX.current += (rawShadowX - smoothShadowX.current) * LERP_FAST;
        smoothShadowY.current += (rawShadowY - smoothShadowY.current) * LERP_FAST;
        smoothMaxDist.current += (maxDist - smoothMaxDist.current) * LERP_FAST;
        smoothSquash.current += (squash - smoothSquash.current) * LERP_SLOW;
        smoothStretchAngle.current = lerpAngle(smoothStretchAngle.current, stretchAngle, LERP_SLOW);
        smoothHiAngle.current = lerpAngle(smoothHiAngle.current, rawHiAngle, LERP_SLOW);
        smoothHiW.current += (rawHiW - smoothHiW.current) * LERP_SLOW;
        smoothHiH.current += (rawHiH - smoothHiH.current) * LERP_SLOW;
      }

      const lightX = smoothLightX.current, lightY = smoothLightY.current;
      const shadowX = smoothShadowX.current, shadowY = smoothShadowY.current;
      const sMD = smoothMaxDist.current, sSq = smoothSquash.current;
      const sSA = smoothStretchAngle.current;
      const sHiW = smoothHiW.current, sHiH = smoothHiH.current;
      const sHiAngle = smoothHiAngle.current;

      if (![sMD, sSq, sHiW, sHiH, sHiAngle, lightX, lightY].every(isFinite)) return;

      const glowRadius = sMD * (1.1 + sSq * 0.35);

      // ── Draw blob path (always uses real physics points) ───────────────────
      function tracePath() {
        const sx = (pts[n - 1].x + pts[0].x) / 2;
        const sy = (pts[n - 1].y + pts[0].y) / 2;
        ctx.moveTo(sx, sy);
        for (let i = 0; i < n; i++) {
          const curr = pts[i], next = pts[(i + 1) % n];
          ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
        }
        ctx.closePath();
      }

      // ── 1. Outer glow ──────────────────────────────────────────────────────
      ctx.beginPath(); tracePath();
      const glowGrad = ctx.createRadialGradient(cx, cy, sMD * 0.4, cx, cy, glowRadius * 1.6);
      glowGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      glowGrad.addColorStop(0.5, `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`);
      glowGrad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      ctx.shadowColor = `rgba(${rgb.r},${rgb.g},${rgb.b},0.45)`;
      ctx.shadowBlur = 55 + sSq * 20;
      ctx.fillStyle = glowGrad;
      ctx.fill();
      ctx.shadowBlur = 0;

      // ── 2. Main body fill ──────────────────────────────────────────────────
      ctx.beginPath(); tracePath();
      const bodyGrad = ctx.createRadialGradient(
        lightX, lightY, sMD * 0.04,
        cx + Math.cos(sSA + Math.PI) * sMD * 0.3,
        cy + Math.sin(sSA + Math.PI) * sMD * 0.3,
        glowRadius
      );
      bodyGrad.addColorStop(0, `rgb(${Math.min(255, rgb.r + 170)},${Math.min(255, rgb.g + 170)},${Math.min(255, rgb.b + 170)})`);
      bodyGrad.addColorStop(0.25, `rgb(${Math.min(255, rgb.r + 70)},${Math.min(255, rgb.g + 70)},${Math.min(255, rgb.b + 70)})`);
      bodyGrad.addColorStop(0.72, `rgb(${rgb.r},${rgb.g},${rgb.b})`);
      bodyGrad.addColorStop(1, `rgb(${Math.max(5, rgb.r - 70)},${Math.max(5, rgb.g - 70)},${Math.max(5, rgb.b - 70)})`);
      ctx.fillStyle = bodyGrad;
      ctx.fill();

      // ── 3. Inner shading (clipped) ─────────────────────────────────────────
      ctx.save();
      ctx.beginPath(); tracePath();
      ctx.clip();

      // 3a. Shadow
      const shadowGrad = ctx.createRadialGradient(shadowX, shadowY, sMD * 0.1, cx, cy, sMD * 1.15);
      shadowGrad.addColorStop(0, "rgba(0,0,0,0)");
      shadowGrad.addColorStop(0.65, "rgba(0,0,18,0.18)");
      shadowGrad.addColorStop(1, "rgba(0,0,20,0.52)");
      ctx.fillStyle = shadowGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 3b. Edge darkening
      const edgeGrad = ctx.createRadialGradient(cx, cy, sMD * (0.45 + sSq * 0.2), cx, cy, sMD * 1.12);
      edgeGrad.addColorStop(0, "rgba(0,0,0,0)");
      edgeGrad.addColorStop(1, `rgba(0,0,0,${0.3 + (1 - sSq) * 0.25})`);
      ctx.fillStyle = edgeGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 3c. Primary specular highlight
      ctx.save();
      ctx.translate(lightX, lightY);
      ctx.rotate(sHiAngle + Math.PI / 4);
      const hiGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, sHiW);
      hiGrad.addColorStop(0, "rgba(255,255,255,0.72)");
      hiGrad.addColorStop(0.5, "rgba(255,255,255,0.28)");
      hiGrad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hiGrad;
      ctx.scale(1, sHiH / sHiW);
      ctx.beginPath();
      ctx.arc(0, 0, sHiW, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 3d. Secondary micro-highlight on opposite stretched tip
      if (sSq < 0.75) {
        const microX = cx + Math.cos(sSA + Math.PI) * sMD * 0.6;
        const microY = cy + Math.sin(sSA + Math.PI) * sMD * 0.6;
        const microGrad = ctx.createRadialGradient(microX, microY, 0, microX, microY, sMD * 0.25);
        microGrad.addColorStop(0, `rgba(${Math.min(255, rgb.r + 200)},${Math.min(255, rgb.g + 200)},${Math.min(255, rgb.b + 200)},${0.3 * (1 - sSq)})`);
        microGrad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = microGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.restore();
    }

    const FIXED_DT = 1000 / 60; // 60hz physics
    let lastTime = performance.now();
    let accumulator = 0;

    function loop(now) {
      const delta = Math.min(now - lastTime, 100); // cap at 100ms to avoid spiral
      lastTime = now;
      accumulator += delta;
      while (accumulator >= FIXED_DT) {
        updatePhysics();
        accumulator -= FIXED_DT;
      }
      drawBlob();
      animRef.current = requestAnimationFrame(loop);
    }

    animRef.current = requestAnimationFrame(loop);

    // ── Gyroscope / motion handlers ──────────────────────────────────────────
    const handleOrientation = (e) => {
      // gamma = left/right tilt (-90 to 90), beta = front/back tilt (-180 to 180)
      const gamma = Math.max(-45, Math.min(45, e.gamma || 0)); // clamp to ±45°
      const beta  = Math.max(-45, Math.min(45, (e.beta  || 0) - 45)); // subtract 45 so flat = 0
      gravityRef.current.gx = (gamma / 45) * BASE_GRAVITY * 2.5;
      gravityRef.current.gy = (beta  / 45) * BASE_GRAVITY * 2.5 + BASE_GRAVITY * 0.3;
    };

    let lastShakeTime = 0;
    const SHAKE_THRESHOLD = 18;
    const handleMotion = (e) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;
      const mag = Math.hypot(acc.x || 0, acc.y || 0, acc.z || 0);
      const now = performance.now();
      if (mag > SHAKE_THRESHOLD && now - lastShakeTime > 600) {
        lastShakeTime = now;
        shakeRef.current = true;
      }
    };

    // Only enable gyro on touch/mobile devices — desktops fire null orientation events
    const isTouchDevice = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
    if (isTouchDevice) {
      window.addEventListener("deviceorientation", handleOrientation);
      window.addEventListener("devicemotion", handleMotion);
    }

    // ── Input handlers ───────────────────────────────────────────────────────
    const handleMouseDown = (e) => {
      if (e.target.closest("[data-ui]")) return;
      mouseRef.current = { x: e.clientX, y: e.clientY, dragging: true };
    };
    const handleMouseMove = (e) => { mouseRef.current.x = e.clientX; mouseRef.current.y = e.clientY; };
    const handleMouseUp = () => { mouseRef.current.dragging = false; };

    const handleTouchStart = (e) => {
      if (e.target.closest("[data-ui]")) return;
      const t = e.touches[0];
      mouseRef.current = { x: t.clientX, y: t.clientY, dragging: true };
    };
    const handleTouchMove = (e) => {
      const t = e.touches[0];
      mouseRef.current.x = t.clientX; mouseRef.current.y = t.clientY;
    };
    const handleTouchEnd = () => { mouseRef.current.dragging = false; };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchstart", handleTouchStart, { passive: false });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
      if (isTouchDevice) {
        window.removeEventListener("deviceorientation", handleOrientation);
        window.removeEventListener("devicemotion", handleMotion);
      }
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [initPoints]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full"
      style={{ touchAction: "none" }}
    />
  );
}
