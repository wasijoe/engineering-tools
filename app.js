"use strict";

const byId = (id) => document.getElementById(id);
const form = byId("motion");
const canvas = byId("chart");
const readout = byId("chart-readout");
const plotTypes = [
  { key: "x", label: "位置", unit: "mm" },
  { key: "v", label: "速度", unit: "mm/s" },
  { key: "a", label: "加速度", unit: "mm/s²" },
  { key: "jerk", label: "Jerk", unit: "mm/s³" },
  { key: "v", label: "速度", tab: "位置–速度", unit: "mm/s", byPosition: true }
];
let solution;
let activePlot = plotTypes[0];
let pointer;
let automaticJerk = true;

function syncJerk() {
  if (automaticJerk) {
    const defaultJerk = byId("acceleration").valueAsNumber * 10;
    byId("jerk").value = Number.isFinite(defaultJerk) ? String(Number(defaultJerk.toPrecision(16))) : "";
  }
  byId("jerk-mode").textContent = automaticJerk
    ? "自動：Jerk 為加速度上限的 10 倍，可直接編輯。"
    : "手動：Jerk 使用你輸入的數值。";
  byId("auto-jerk").hidden = automaticJerk;
}

function format(value, digits = 5) {
  if (value === 0) return "0";
  if (Math.abs(value) < 0.001 || Math.abs(value) >= 1e7) return value.toExponential(3);
  return Number(value.toPrecision(digits)).toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function draw() {
  if (!solution || byId("results").hidden) return;
  const { width, height } = canvas.getBoundingClientRect();
  if (width < 95 || height < 70) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const { key, label, unit, byPosition } = activePlot;
  const time = solution.time;
  const end = solution.phases.at(-1)?.end ?? solution.origin;
  const axisEnd = byPosition ? end.x : time;
  const axisValue = (state) => byPosition ? state.x : state.t;
  const points = [[0, 0]];
  for (const phase of solution.phases) {
    if (key === "jerk") {
      points.push([phase.start.t, phase.jerk], [phase.end.t, phase.jerk]);
    } else {
      for (let i = 0; i < 32; i++) {
        const state = advance(phase.start, phase.jerk, phase.duration * i / 32);
        points.push([axisValue(state), state[key]]);
      }
      points.push([axisValue(phase.end), phase.end[key]]);
    }
  }
  if (key === "jerk") points.push([time, 0]);
  const values = points.map((point) => point[1]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const scale = Math.max(Math.abs(min), Math.abs(max)) || 1;
  const low = min / scale;
  const high = max / scale;
  const range = high - low || 1;
  const left = 74;
  const right = width - 16;
  const top = 24;
  const bottom = height - 38;
  const x = (value) => left + (value / (axisEnd || 1)) * (right - left);
  const y = (v) => bottom - ((v / scale - low) / range) * (bottom - top);
  readout.hidden = true;
  const axisLabel = byPosition ? "位置 (mm)" : "時間 (s)";
  canvas.setAttribute("aria-label", label + "（" + unit + "）對" + axisLabel + "的曲線");
  ctx.font = "12px system-ui";
  ctx.fillStyle = "#40566d";
  ctx.fillText(unit, left, 13);
  for (let i = 0; i <= (max === min ? 0 : 4); i++) {
    const value = (low + range * i / 4) * scale;
    const row = y(value);
    ctx.beginPath();
    ctx.strokeStyle = "#dce5ed";
    ctx.moveTo(left, row);
    ctx.lineTo(right, row);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(format(value, 3), left - 7, row + 4);
  }
  for (let i = 0; i <= (time ? 4 : 0); i++) {
    const value = axisEnd * (i / 4);
    ctx.textAlign = i === 4 ? "right" : "center";
    ctx.fillText(format(value, 3), x(value), bottom + 17);
  }
  ctx.textAlign = "right";
  ctx.fillText(axisLabel, right, height - 3);
  ctx.beginPath();
  ctx.strokeStyle = "#057c69";
  ctx.lineWidth = 2.5;
  for (const [index, [t, value]] of points.entries()) {
    if (index === 0) ctx.moveTo(x(t), y(value));
    else ctx.lineTo(x(t), y(value));
  }
  ctx.stroke();
  if (!time) {
    ctx.beginPath();
    ctx.arc(left, bottom, 3, 0, 2 * Math.PI);
    ctx.fillStyle = "#057c69";
    ctx.fill();
  }
  if (pointer && pointer.x >= left && pointer.x <= right && pointer.y >= top && pointer.y <= bottom) {
    const coordinate = axisEnd * ((pointer.x - left) / (right - left));
    // At a boundary, show the Jerk of the segment that starts there.
    const direction = Math.sign(axisEnd);
    const phase = solution.phases.find((segment) => direction * coordinate < direction * axisValue(segment.end));
    let value = key === "jerk" ? 0 : end[key];
    if (phase) {
      let elapsed = coordinate - phase.start.t;
      if (byPosition) {
        // Position is monotonic within the move, including reverse travel.
        let lo = 0;
        let hi = phase.duration;
        for (let i = 0; i < 48; i++) {
          const mid = lo + (hi - lo) / 2;
          const position = advance(phase.start, phase.jerk, mid).x;
          if (direction * position < direction * coordinate) lo = mid;
          else hi = mid;
        }
        elapsed = coordinate === phase.start.x ? 0 : lo + (hi - lo) / 2;
      }
      value = key === "jerk" ? phase.jerk : advance(phase.start, phase.jerk, elapsed)[key];
    }
    const column = x(coordinate);
    const row = y(value);
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#58748b";
    ctx.lineWidth = 1;
    ctx.moveTo(column, top);
    ctx.lineTo(column, bottom);
    ctx.moveTo(left, row);
    ctx.lineTo(right, row);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(column, row, 4, 0, 2 * Math.PI);
    ctx.fillStyle = "#056454";
    ctx.fill();
    readout.textContent = (byPosition ? "位置 " : "") + format(coordinate, 6) +
      (byPosition ? " mm" : " s") + " · " + label + " " + format(value, 6) + " " + unit;
    readout.hidden = false;
  }
}

function render(velocityLimit, accelerationLimit) {
  const { phases, time, velocity, acceleration, jerk, cruise, hold } = solution;
  const speedUnderLimit = velocity / velocityLimit < 1 - 1e-12;
  const accelerationUnderLimit = acceleration / accelerationLimit < 1 - 1e-12;
  const metrics = [
    ["總移動時間", time, "s"], ["峰值速度", velocity, "mm/s", speedUnderLimit],
    ["峰值加速度", acceleration, "mm/s²", accelerationUnderLimit], ["峰值 Jerk", jerk, "mm/s³"]
  ];
  byId("metrics").innerHTML = metrics.map(([label, value, unit, underLimit]) =>
    '<div class="metric' + (underLimit ? ' under-limit' : '') + '"><span>' + label +
    '</span><strong>' + format(value) + '</strong><small>' + unit + '</small></div>'
  ).join("");
  byId("cruise-alert").hidden = time === 0 || cruise > 0;
  const cruiseStatus = cruise > 0 ? " · 等速 " + format(cruise) + " s" : "";
  byId("profile").textContent = time
    ? phases.length + " 段 S 曲線" + cruiseStatus + " · 單側恆加速／減速 " + format(hold) + " s"
    : "行程為零，Stage 保持靜止。";
  const limitNotes = byId("limit-notes");
  limitNotes.replaceChildren();
  for (const [label, peak, limit, unit, underLimit] of [
    ["速度", velocity, velocityLimit, "mm/s", speedUnderLimit],
    ["加速度", acceleration, accelerationLimit, "mm/s²", accelerationUnderLimit]
  ]) {
    if (!underLimit) continue;
    const message = document.createElement("li");
    message.textContent = "未達" + label + "上限。實際峰值 " + format(peak, 8) + " " + unit +
      "，設定上限 " + format(limit, 8) + " " + unit + "。";
    limitNotes.append(message);
  }
  limitNotes.hidden = !limitNotes.childElementCount;
  byId("phases").innerHTML = phases.length ? phases.map(({ name, duration, start, end }) =>
    "<tr><td>" + name + "</td>" +
    [duration, end.x - start.x, end.x, end.v, end.a].map((value) => "<td>" + format(value) + "</td>").join("") + "</tr>"
  ).join("") : '<tr><td colspan="6">無運動階段</td></tr>';
  draw();
}

function calculate() {
  const error = byId("error");
  const results = byId("results");
  const [distance, velocityLimit, accelerationLimit, jerkLimit] =
    ["distance", "velocity", "acceleration", "jerk"].map((id) => byId(id).valueAsNumber);
  try {
    solution = solveMotion(distance, velocityLimit, accelerationLimit, jerkLimit);
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
    results.hidden = true;
    return;
  }
  error.hidden = true;
  results.hidden = false;
  render(velocityLimit, accelerationLimit);
}

for (const plot of plotTypes) {
  const button = document.createElement("button");
  button.textContent = plot.tab ?? plot.label;
  button.type = "button";
  button.setAttribute("aria-pressed", String(plot === activePlot));
  button.addEventListener("click", () => {
    activePlot = plot;
    for (const tab of byId("tabs").children) tab.setAttribute("aria-pressed", String(tab === button));
    draw();
  });
  byId("tabs").append(button);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  calculate();
});
form.addEventListener("input", (event) => {
  if (event.target === byId("jerk")) automaticJerk = false;
  if (event.target === byId("acceleration") || event.target === byId("jerk")) syncJerk();
  byId("results").hidden = true;
  byId("error").hidden = true;
});
byId("auto-jerk").addEventListener("click", () => {
  automaticJerk = true;
  syncJerk();
  byId("jerk").focus();
  form.requestSubmit();
});
byId("load-example").addEventListener("click", () => {
  form.reset();
  automaticJerk = true;
  syncJerk();
  calculate();
});
function readPointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  draw();
}
canvas.addEventListener("pointermove", readPointer);
canvas.addEventListener("pointerdown", readPointer);
canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "touch") return;
  pointer = undefined;
  draw();
});
canvas.addEventListener("pointercancel", () => {
  pointer = undefined;
  draw();
});
new ResizeObserver(draw).observe(canvas);
syncJerk();
calculate();
