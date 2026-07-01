/**
 * Generates profile-icon.png for VS Code Marketplace publisher profile.
 * Run: node generate-profile-icon.js
 * Requires: npm install canvas
 */
const { createCanvas } = require('canvas');
const fs = require('fs');

const size = 128;
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');

// Background — liquid glass: dark red Angular style
const grad = ctx.createLinearGradient(0, 0, size, size);
grad.addColorStop(0, '#1a0008');
grad.addColorStop(0.4, '#2d0010');
grad.addColorStop(1, '#4a0018');
ctx.fillStyle = grad;
ctx.beginPath();
ctx.roundRect(0, 0, size, size, 18);
ctx.fill();

// Glass shimmer — subtle diagonal highlight
const shimmer = ctx.createLinearGradient(0, 0, size * 0.6, size * 0.6);
shimmer.addColorStop(0, 'rgba(255,255,255,0.07)');
shimmer.addColorStop(0.5, 'rgba(255,255,255,0.02)');
shimmer.addColorStop(1, 'rgba(255,255,255,0)');
ctx.fillStyle = shimmer;
ctx.beginPath();
ctx.roundRect(0, 0, size, size, 18);
ctx.fill();

// Glass border
ctx.strokeStyle = 'rgba(255,255,255,0.12)';
ctx.lineWidth = 1.5;
ctx.beginPath();
ctx.roundRect(1, 1, size - 2, size - 2, 17);
ctx.stroke();

// Big "R" — white with cyan glow
ctx.shadowColor = '#00e5ff';
ctx.shadowBlur = 14;
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 72px "Courier New", monospace';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('R', size / 2, size / 2 - 8);
ctx.shadowBlur = 0;

// Thin separator line
ctx.strokeStyle = 'rgba(100, 200, 240, 0.25)';
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(14, 100);
ctx.lineTo(size - 14, 100);
ctx.stroke();

// Publisher ID below
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 13px "Courier New", monospace';
ctx.textBaseline = 'alphabetic';
ctx.fillText('RamiroCR98', size / 2, 118);

const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('profile-icon.png', buffer);
console.log('profile-icon.png generated ✓');
