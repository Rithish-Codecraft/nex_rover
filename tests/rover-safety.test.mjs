import test from 'node:test';
import assert from 'node:assert/strict';

// --- Allowlist and Protocol Definitions ---
const ALLOWED_COMMANDS = new Set(['F', 'B', 'L', 'R', 'S', 'STOP', 'PING', 'STATUS']);
const VALID_JOINTS = new Set(['BASE', 'SHOULDER', 'ELBOW', 'GRIPPER']);

function validateCommand(cmd) {
  if (typeof cmd !== 'string') return { valid: false, error: 'Command must be a string' };
  const trimmed = cmd.trim().toUpperCase();

  if (ALLOWED_COMMANDS.has(trimmed)) {
    return { valid: true, command: trimmed === 'STOP' ? 'S' : trimmed };
  }

  // ARM command: ARM:JOINT:ANGLE
  const armMatch = trimmed.match(/^ARM:(BASE|SHOULDER|ELBOW|GRIPPER):(\d{1,3})$/);
  if (armMatch) {
    const joint = armMatch[1];
    const angle = parseInt(armMatch[2], 10);
    if (angle < 0 || angle > 180) {
      return { valid: false, error: `Servo angle out of bounds (0-180): ${angle}` };
    }
    return { valid: true, command: `ARM:${joint}:${angle}`, joint, angle };
  }

  // Speed command: V:SPEED
  const speedMatch = trimmed.match(/^V:(\d{1,3})$/);
  if (speedMatch) {
    const speed = parseInt(speedMatch[1], 10);
    if (speed < 0 || speed > 255) {
      return { valid: false, error: `Speed out of bounds (0-255): ${speed}` };
    }
    return { valid: true, command: `V:${speed}`, speed };
  }

  return { valid: false, error: `Command not in allowlist: ${cmd}` };
}

function clampMovementDuration(durationMs) {
  if (typeof durationMs !== 'number' || isNaN(durationMs) || durationMs <= 0) {
    return 0;
  }
  return Math.min(1000, Math.round(durationMs)); // Strictly bounded to 1000ms max!
}

function arbitrateMovement({ command, source, obstacleDistanceCm, currentControlMode }) {
  // Priority 1: E-STOP (always allowed and immediately halts)
  if (source === 'estop' || command === 'S') {
    return { approved: true, action: 'S', reason: 'Emergency Stop / Halt' };
  }

  // Priority 2: Safety Restriction (Obstacle Detection < 20cm blocks forward movement)
  if (command === 'F' && typeof obstacleDistanceCm === 'number' && obstacleDistanceCm > 0 && obstacleDistanceCm < 20) {
    return { approved: false, action: 'S', reason: `Obstacle proximity hazard: ${obstacleDistanceCm} cm` };
  }

  // Priority 3: Manual Operator Control (always executed, overrides autonomous mode)
  if (source === 'manual') {
    return { approved: true, action: command, reason: 'Manual operator input' };
  }

  // Priority 4: Approved AI / Autonomous commands
  if (source === 'ai' && (currentControlMode === 'approval' || currentControlMode === 'autonomous')) {
    return { approved: true, action: command, reason: 'Approved AI recommendation' };
  }

  return { approved: false, action: 'S', reason: 'Unauthorized command source for mode' };
}

// ==================== TEST SUITES ====================

test('Command Validation: Allowlisted commands must pass', () => {
  for (const cmd of ['F', 'B', 'L', 'R', 'S', 'STOP', 'PING', 'STATUS']) {
    const res = validateCommand(cmd);
    assert.equal(res.valid, true, `Expected ${cmd} to be valid`);
  }
});

test('Command Validation: Invalid and injection commands must be rejected', () => {
  const invalidCommands = [
    'rm -rf /',
    'DROP TABLE users',
    'FORWARD_FOREVER',
    'SPEED:999',
    'V:300',
    'ARM:WRIST:90',
    'ARM:BASE:250',
    'ARM:BASE:-10',
    '<script>alert(1)</script>',
    'F; reboot',
  ];

  for (const cmd of invalidCommands) {
    const res = validateCommand(cmd);
    assert.equal(res.valid, false, `Expected ${cmd} to be rejected`);
  }
});

test('Duration Limits: Must strictly clamp movement durations to <= 1000ms', () => {
  assert.equal(clampMovementDuration(500), 500);
  assert.equal(clampMovementDuration(1000), 1000);
  assert.equal(clampMovementDuration(1500), 1000, 'Durations > 1000ms must be clamped to 1000ms');
  assert.equal(clampMovementDuration(60000), 1000, 'Unbounded movement durations must be clamped');
  assert.equal(clampMovementDuration(-50), 0);
  assert.equal(clampMovementDuration(NaN), 0);
});

test('Safety Command Arbitration: Priority 1 - Emergency Stop always overrides', () => {
  const res = arbitrateMovement({
    command: 'S',
    source: 'estop',
    obstacleDistanceCm: 50,
    currentControlMode: 'autonomous',
  });
  assert.equal(res.approved, true);
  assert.equal(res.action, 'S');
});

test('Safety Command Arbitration: Priority 2 - Obstacle proximity < 20cm blocks forward motion', () => {
  const resBlocked = arbitrateMovement({
    command: 'F',
    source: 'manual',
    obstacleDistanceCm: 14, // 14 cm < 20 cm
    currentControlMode: 'manual',
  });
  assert.equal(resBlocked.approved, false, 'Forward motion must be blocked when obstacle is < 20cm');
  assert.equal(resBlocked.action, 'S');

  // Reverse motion should still be permitted to back away from obstacle
  const resReverse = arbitrateMovement({
    command: 'B',
    source: 'manual',
    obstacleDistanceCm: 14,
    currentControlMode: 'manual',
  });
  assert.equal(resReverse.approved, true, 'Reverse should be allowed to back away from obstacle');
});

test('Safety Command Arbitration: Priority 3 - Manual operator overrides autonomous AI', () => {
  const resManual = arbitrateMovement({
    command: 'L',
    source: 'manual',
    obstacleDistanceCm: 80,
    currentControlMode: 'autonomous',
  });
  assert.equal(resManual.approved, true);
  assert.equal(resManual.action, 'L');
});

test('Servo Angle Limits: Must enforce 0 to 180 degrees strictly', () => {
  assert.equal(validateCommand('ARM:BASE:0').valid, true);
  assert.equal(validateCommand('ARM:SHOULDER:90').valid, true);
  assert.equal(validateCommand('ARM:ELBOW:180').valid, true);
  assert.equal(validateCommand('ARM:GRIPPER:60').valid, true);

  assert.equal(validateCommand('ARM:BASE:181').valid, false);
  assert.equal(validateCommand('ARM:BASE:-5').valid, false);
});
