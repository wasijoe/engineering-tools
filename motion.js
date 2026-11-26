"use strict";

function advance(state, jerk, time) {
  return {
    t: state.t + time,
    x: state.x + time * (state.v + time * (state.a / 2 + time * jerk / 6)),
    v: state.v + time * (state.a + time * jerk / 2),
    a: state.a + time * jerk
  };
}

function solveMotion(distance, velocity, acceleration, jerk) {
  if (![distance, velocity, acceleration, jerk].every(Number.isFinite) ||
      Math.min(velocity, acceleration, jerk) <= 0) {
    throw new RangeError("請輸入有限的行程，以及大於 0 的速度、加速度與 Jerk 上限。");
  }
  const origin = { t: 0, x: 0, v: 0, a: 0 };
  if (distance === 0) return { origin, phases: [], time: 0, velocity: 0, acceleration: 0, jerk: 0, cruise: 0, hold: 0 };

  const length = Math.abs(distance);
  const direction = Math.sign(distance);
  const accelerationAtLimit = Math.min(acceleration, Math.sqrt(velocity) * Math.sqrt(jerk));
  let ramp = accelerationAtLimit / jerk;
  let hold = Math.max(0, velocity / accelerationAtLimit - ramp);
  let cruise = 0;
  let peakSpeed = velocity;
  const lengthAtLimit = velocity * (2 * ramp + hold);

  if (length >= lengthAtLimit) {
    cruise = (length - lengthAtLimit) / velocity;
  } else {
    const fullRamp = acceleration / jerk;
    const triangularRamp = Math.cbrt(length) / Math.cbrt(jerk) / Math.cbrt(2);
    ramp = Math.min(fullRamp, triangularRamp);
    if (fullRamp < triangularRamp) {
      // Solve (ramp + hold)(2 * ramp + hold) = length / acceleration.
      const root = Math.sqrt(length) / Math.sqrt(acceleration);
      const scaledRamp = ramp / root;
      hold = root * (2 * (1 - 2 * scaledRamp ** 2)) /
        (Math.hypot(scaledRamp, 2) + 3 * scaledRamp);
    } else {
      hold = 0;
    }
    peakSpeed = (jerk * ramp) * (ramp + hold);
  }

  const signedJerk = jerk * direction;
  const phases = [];
  let state = origin;
  for (const [name, duration, segmentJerk] of [
    ["加速度上升", ramp, signedJerk],
    ["恆加速", hold, 0],
    ["加速度回到零", ramp, -signedJerk],
    ["等速", cruise, 0],
    ["減速度上升", ramp, -signedJerk],
    ["恆減速", hold, 0],
    ["減速度回到零", ramp, signedJerk]
  ]) {
    if (duration === 0) continue;
    const end = advance(state, segmentJerk, duration);
    phases.push({ name, duration, jerk: segmentJerk, start: state, end });
    state = end;
  }
  const peakAcceleration = jerk * ramp;
  if (ramp <= 0 || peakSpeed <= 0 ||
      !phases.every(({start, end}) => end.t > start.t && Object.values(end).every(Number.isFinite)) ||
      Math.abs(state.x / distance - 1) > 1e-8) {
    throw new RangeError("這組數值超出可計算精度，請調整輸入。");
  }
  Object.assign(state, { x: distance, v: 0, a: 0 });
  return { origin, phases, time: state.t, velocity: peakSpeed, acceleration: peakAcceleration, jerk, cruise, hold };
}

if (typeof module !== "undefined") module.exports = { solveMotion, advance };
