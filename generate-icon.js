/**
 * Generates icon.png for the ngx-i18n-validator extension.
 * Run: node generate-icon.js
 * Requires: npm install canvas
 */
const { createCanvas } = require('canvas');
const fs = require('fs');

const size = 128;
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');

// Background rounded rect — deep indigo gradient
const grad = ctx.createLinearGradient(0, 0, size, size);
grad.addColorStop(0, '#1a237e');
grad.addColorStop(1, '#283593');
ctx.fillStyle = grad;
ctx.beginPath();
ctx.roundRect(0, 0, size, size, 18);
ctx.fill();

// Publisher ID — small, top, muted cyan
ctx.fillStyle = '#4dd0e1';
ctx.font = '500 11px "Courier New", monospace';
ctx.textAlign = 'center';
ctx.textBaseline = 'alphabetic';
ctx.fillText('RamiroCR98', size / 2, 24);

// Thin separator line
ctx.strokeStyle = '#4dd0e1';
ctx.lineWidth = 1;
ctx.globalAlpha = 0.5;
ctx.beginPath();
ctx.moveTo(14, 31);
ctx.lineTo(size - 14, 31);
ctx.stroke();
ctx.globalAlpha = 1;

// Main label — "i18n" big, bright cyan
ctx.fillStyle = '#80deea';
ctx.font = 'bold 38px "Courier New", monospace';
ctx.textBaseline = 'alphabetic';
ctx.fillText('i18n', size / 2, 74);

// Thin separator line bottom
ctx.strokeStyle = '#4dd0e1';
ctx.lineWidth = 1;
ctx.globalAlpha = 0.5;
ctx.beginPath();
ctx.moveTo(14, 82);
ctx.lineTo(size - 14, 82);
ctx.stroke();
ctx.globalAlpha = 1;

// Checkmark — bright green, bottom
ctx.fillStyle = '#69f0ae';
ctx.font = 'bold 34px Arial';
ctx.textBaseline = 'alphabetic';
ctx.fillText('✓', size / 2, 116);

const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('icon.png', buffer);
console.log('icon.png generated ✓');
