const canvas = document.getElementById('fidgetCanvas');
const ctx = canvas.getContext('2d');

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

let baseColor = "#00ffaa";
const gravity = 0.35; 
const friction = 0.985; 
const bounce = 0.15; 

const totalPoints = 36; 
const radius = 85; 
const targetArea = Math.PI * radius * radius; 

// --- STABILITY & ANTI-DRIFT LIMITS ---
const MAX_VELOCITY = 12;        
const MAX_STRETCH_FACTOR = 1.5; 
const MIN_STRETCH_FACTOR = 0.5; 
const VELOCITY_DEADZONE = 0.015; // Any tiny micro-movements below this value are killed immediately

let points = [];
let isDragging = false;

const startX = window.innerWidth / 2;
const startY = window.innerHeight / 2;
for (let i = 0; i < totalPoints; i++) {
    const angle = (i / totalPoints) * Math.PI * 2;
    const x = startX + Math.cos(angle) * radius;
    const y = startY + Math.sin(angle) * radius;
    points.push({ x: x, y: y, oldX: x, oldY: y, baseAngle: angle });
}

function hexToRgb(hex) {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 255, b: 170 };
}

function getCurrentArea() {
    let area = 0;
    for (let i = 0; i < totalPoints; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % totalPoints];
        area += (p1.x * p2.y) - (p2.x * p1.y);
    }
    return area * 0.5;
}

let mouseX = 0, mouseY = 0;

function updatePhysics() {
    let cx = 0, cy = 0;
    points.forEach(p => { cx += p.x; cy += p.y; });
    cx /= totalPoints;
    cy /= totalPoints;

    points.forEach((p) => {
        let vx = (p.x - p.oldX) * friction;
        let vy = (p.y - p.oldY) * friction;

        // Apply Deadzone Constraint to stop lateral creeping
        if (Math.abs(vx) < VELOCITY_DEADZONE) vx = 0;
        if (Math.abs(vy) < VELOCITY_DEADZONE) vy = 0;

        const speed = Math.hypot(vx, vy);
        if (speed > MAX_VELOCITY) {
            vx = (vx / speed) * MAX_VELOCITY;
            vy = (vy / speed) * MAX_VELOCITY;
        }

        if (isDragging) {
            const angleToCenter = Math.atan2(p.y - cy, p.x - cx);
            const tangentX = -Math.sin(angleToCenter);
            const tangentY = Math.cos(angleToCenter);
            const dotTangent = vx * tangentX + vy * tangentY;
            
            vx -= tangentX * dotTangent * 0.45;
            vy -= tangentY * dotTangent * 0.45;
        }

        p.oldX = p.x;
        p.oldY = p.y;

        // Hard lock horizontal gravity to 0 to eliminate sliding bias
        p.x += vx; 
        p.y += vy + gravity;

        if (isDragging) {
            const dx = mouseX - p.x;
            const dy = mouseY - p.y;
            const dist = Math.hypot(dx, dy);
            
            let pull = Math.max(0, 1 - dist / (radius * 3.5));
            pull = Math.pow(pull, 2); 
            
            p.x += dx * pull * 0.22;
            p.y += dy * pull * 0.22;

            const targetDistX = cx + Math.cos(p.baseAngle) * radius;
            const targetDistY = cy + Math.sin(p.baseAngle) * radius;
            p.x += (targetDistX - p.x) * 0.04;
            p.y += (targetDistY - p.y) * 0.04;
        }

        // Boundary Clamping with active leveling friction
        const margin = 12;
        
        if (p.y > canvas.height - margin) { 
            p.y = canvas.height - margin; 
            p.oldY = p.y + Math.abs(vy) * bounce; 
            p.oldX = p.x - (p.x - p.oldX) * 0.6; // Kills horizontal drift momentum instantly on contact
        }
        if (p.y < margin) { 
            p.y = margin; 
            p.oldY = p.y - Math.abs(vy) * bounce; 
        }
        if (p.x > canvas.width - margin) { 
            p.x = canvas.width - margin; 
            p.oldX = p.x + Math.abs(vx) * bounce; 
            p.oldY = p.y - (p.y - p.oldY) * 0.6; 
        }
        if (p.x < margin) { 
            p.x = margin; 
            p.oldX = p.x - Math.abs(vx) * bounce; 
            p.oldY = p.y - (p.y - p.oldY) * 0.6;
        }
    });

    const restLength = (radius * 2 * Math.PI) / totalPoints;
    const iterations = 8; 

    for (let step = 0; step < iterations; step++) {
        for (let i = 0; i < totalPoints; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % totalPoints];
            let dx = p2.x - p1.x;
            let dy = p2.y - p1.y;
            let dist = Math.hypot(dx, dy);
            
            if (dist === 0) continue;
            
            const maxAllowedDist = restLength * MAX_STRETCH_FACTOR;
            const minAllowedDist = restLength * MIN_STRETCH_FACTOR;
            
            if (dist > maxAllowedDist) {
                const overfill = dist - maxAllowedDist;
                p1.x += (dx / dist) * overfill * 0.5;
                p1.y += (dy / dist) * overfill * 0.5;
                p2.x -= (dx / dist) * overfill * 0.5;
                p2.y -= (dy / dist) * overfill * 0.5;
                dist = maxAllowedDist;
            } else if (dist < minAllowedDist) {
                const underfill = minAllowedDist - dist;
                p1.x -= (dx / dist) * underfill * 0.5;
                p1.y -= (dy / dist) * underfill * 0.5;
                p2.x += (dx / dist) * underfill * 0.5;
                p2.y += (dy / dist) * underfill * 0.5;
                dist = minAllowedDist;
            }

            const diff = restLength - dist;
            const elasticity = isDragging ? 0.45 : 0.25; 
            
            const adjustmentX = (dx / dist) * diff * elasticity;
            const adjustmentY = (dy / dist) * diff * elasticity;

            p1.x -= adjustmentX;
            p1.y -= adjustmentY;
            p2.x += adjustmentX;
            p2.y += adjustmentY;
        }

        const currentArea = getCurrentArea();
        const areaDelta = targetArea - currentArea;

        if (currentArea !== 0) {
            let pressureFactor = (areaDelta / currentArea) * (isDragging ? 0.04 : 0.07);
            pressureFactor = Math.max(-0.04, Math.min(0.04, pressureFactor));
            
            points.forEach(p => {
                const normalX = p.x - cx;
                const normalY = p.y - cy;
                p.x += normalX * pressureFactor;
                p.y += normalY * pressureFactor;
            });
        }
    }
}

function draw() {
    ctx.fillStyle = "#05050a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const rgb = hexToRgb(baseColor);

    let cx = 0, cy = 0;
    points.forEach(p => { cx += p.x; cy += p.y; });
    cx /= totalPoints;
    cy /= totalPoints;

    ctx.beginPath();
    const startXc = (points[totalPoints - 1].x + points[0].x) / 2;
    const startYc = (points[totalPoints - 1].y + points[0].y) / 2;
    ctx.moveTo(startXc, startYc);

    for (let i = 0; i < totalPoints; i++) {
        const curr = points[i];
        const next = points[(i + 1) % totalPoints];
        const xc = (curr.x + next.x) / 2;
        const yc = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, xc, yc);
    }
    ctx.closePath();

    let fluidGrad = ctx.createRadialGradient(
        cx - radius * 0.25, cy - radius * 0.25, radius * 0.05,
        cx, cy, radius * 1.4
    );
    fluidGrad.addColorStop(0, `rgb(${Math.min(255, rgb.r + 180)}, ${Math.min(255, rgb.g + 180)}, ${Math.min(255, rgb.b + 180)})`);
    fluidGrad.addColorStop(0.3, `rgb(${Math.min(255, rgb.r + 60)}, ${Math.min(255, rgb.g + 60)}, ${Math.min(255, rgb.b + 60)})`);
    fluidGrad.addColorStop(0.8, `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
    fluidGrad.addColorStop(1, `rgb(${Math.max(10, rgb.r - 60)}, ${Math.max(10, rgb.g - 60)}, ${Math.max(10, rgb.b - 60)})`);

    ctx.fillStyle = fluidGrad;
    ctx.shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`; 
    ctx.shadowBlur = 60;
    ctx.fill(); 
    ctx.shadowBlur = 0; 

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(startXc, startYc);
    for (let i = 0; i < totalPoints; i++) {
        const curr = points[i];
        const next = points[(i + 1) % totalPoints];
        const xc = (curr.x + next.x) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, xc, (curr.y + next.y) / 2);
    }
    ctx.closePath();
    ctx.clip();

    let depthShadow = ctx.createRadialGradient(
        cx + radius * 0.2, cy + radius * 0.2, radius * 0.3,
        cx, cy, radius * 1.2
    );
    depthShadow.addColorStop(0, "rgba(0,0,0,0)");
    depthShadow.addColorStop(1, "rgba(0, 0, 15, 0.45)"); 
    ctx.fillStyle = depthShadow;
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "rgba(255, 255, 255, 0.65)"; 
    ctx.ellipse(cx - radius * 0.28, cy - radius * 0.28, radius * 0.32, radius * 0.18, Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
}

function loop() {
    updatePhysics();
    draw();
    requestAnimationFrame(loop);
}

function handleStart(clientX, clientY) {
    mouseX = clientX;
    mouseY = clientY;
    isDragging = true;
}

function handleMove(clientX, clientY) {
    mouseX = clientX;
    mouseY = clientY;
}

function handleEnd() {
    isDragging = false;
}

window.addEventListener('mousedown', e => {
    if(e.target.id === 'colorPicker') return;
    handleStart(e.clientX, e.clientY);
});
window.addEventListener('mousemove', e => handleMove(e.clientX, e.clientY));
window.addEventListener('mouseup', handleEnd);

window.addEventListener('touchstart', e => {
    if(e.target.id === 'colorPicker') return;
    const t = e.touches[0];
    handleStart(t.clientX, t.clientY);
}, { passive: false });
window.addEventListener('touchmove', e => {
    const t = e.touches[0];
    handleMove(t.clientX, t.clientY);
}, { passive: false });
window.addEventListener('touchend', handleEnd);

document.getElementById('colorPicker').addEventListener('input', (e) => {
    baseColor = e.target.value;
});

loop();
