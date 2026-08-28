// Side-lateral-raise rep counting, ported line by line from the Django server
// code that ran on the server's webcam (the Django Patients/views.py,
// live copy :777-1208). Pure functions: no camera, no React, no clock. The
// browser hook (hooks/usePoseWorkout.js) feeds it MediaPipe landmarks per
// video frame. Golden-tested on identical landmarks against Django's own loop
// (tests/fixtures/exercise_golden.json, parity-tools/golden/exercise_landmarks.py).
//
// Every exercise type is scored with this logic, exactly like the live Django
// code (it ignored exercise_type; keeps that).

// Django parity: views.py:777-803 (LEFT_ARM_METRICS / RIGHT_ARM_METRICS / SYMMETRY_METRICS).
// The down/peak/ROM thresholds come from LEFT_ARM_METRICS and the up threshold
// from RIGHT_ARM_METRICS in Django; the two dicts only differ in an unused value.
export const METRICS = Object.freeze({
  downThreshold: 35,
  upThreshold: 100,
  excellentPeak: 105,
  goodPeak: 95,
  minRom: 60,
  maxElbowVariance: 5,
  maxShoulderElevation: 0.025,
  symmetryExcellent: 5,
  symmetryGood: 10,
  symmetryMaxAllowed: 15,
  elbowWarning: 165, // views.py:1060 (inline literal)
});

// MediaPipe Pose landmark indices Django read (mp_pose.PoseLandmark, views.py:932-941).
export const LANDMARK_INDEX = Object.freeze({
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_hip: 23,
  right_hip: 24,
});

export const WARNINGS = Object.freeze({
  uneven: '⚠ UNEVEN ARMS!',
  shrug: "⚠ DON'T SHRUG SHOULDERS!",
  elbows: '⚠ KEEP ELBOWS STRAIGHTER!',
});

/** Django parity: the dict literal in start_workout (:1165-1175) and generate_frames (:1022-1032). */
export function freshRep() {
  return {
    left_min_angle: 180,
    left_max_angle: 0,
    left_elbow_angles: [],
    left_shoulder_elevation: 0,
    right_min_angle: 180,
    right_max_angle: 0,
    right_elbow_angles: [],
    right_shoulder_elevation: 0,
    max_asymmetry: 0,
  };
}

/** Django parity: the module-level `workout_state` (:806-834), before any start. */
export function createWorkoutState() {
  return {
    active: false,
    complete: false,
    counter: 0,
    stage: null,
    excellent_reps: 0,
    good_reps: 0,
    partial_reps: 0,
    target_reps: 12,
    current_rep: freshRep(),
    initial_left_shoulder: null,
    initial_right_shoulder: null,
    form_warning: '',
    left_shoulder_angle: 0,
    right_shoulder_angle: 0,
    left_elbow_angle: 0,
    right_elbow_angle: 0,
    asymmetry: 0,
  };
}

/**
 * Django parity: start_workout (:1149-1182). Resets the counters, the stage,
 * the current rep and the initial shoulder positions; keeps the last angles.
 *
 * @param {ReturnType<typeof createWorkoutState>} state
 * @param {number} targetReps
 */
export function startWorkout(state, targetReps = 12) {
  return {
    ...state,
    active: true,
    complete: false,
    counter: 0,
    stage: null,
    excellent_reps: 0,
    good_reps: 0,
    partial_reps: 0,
    target_reps: targetReps,
    initial_left_shoulder: null,
    initial_right_shoulder: null,
    current_rep: freshRep(),
  };
}

/**
 * Django parity: reset_workout (:1198-1208). Only the counters and flags:
 * the stage, target, current rep and initial shoulders stay as they were.
 */
export function resetWorkout(state) {
  return { ...state, active: false, complete: false, counter: 0, excellent_reps: 0, good_reps: 0, partial_reps: 0 };
}

/** Django parity: get_workout_status (:1184-1196): the same 7 fields, in the same order. */
export function workoutStatus(state) {
  const { active, complete, counter, target_reps, excellent_reps, good_reps, partial_reps } = state;
  return { active, complete, counter, target_reps, excellent_reps, good_reps, partial_reps };
}

/**
 * Angle at vertex b between a and c, in degrees, 0-180.
 * Django parity: calculate_angle (:840-852). Same operation order as numpy.
 */
export function calculateAngle(a, b, c) {
  const radians = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(a[1] - b[1], a[0] - b[0]);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180.0) angle = 360 - angle;
  return angle;
}

/** Population standard deviation, as numpy's np.std (ddof=0). */
function populationStd(values) {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * The 8 landmarks the logic reads, from a MediaPipe Tasks result (an array of
 * 33 {x, y, …}), as [x, y] pairs. Visibility is ignored, as in Django.
 *
 * @param {{ x: number, y: number }[] | undefined} landmarks
 * @returns {Record<keyof typeof LANDMARK_INDEX, [number, number]> | null} null when no person was found
 */
export function pickLandmarks(landmarks) {
  if (!landmarks) return null;
  return Object.fromEntries(Object.entries(LANDMARK_INDEX).map(([name, i]) => [name, [landmarks[i].x, landmarks[i].y]]));
}

/**
 * One video frame. Returns the new state (the input isn't modified).
 * Django parity: generate_frames, the "ACTIVE WORKOUT" branch (:927-1076).
 * Django swallowed every exception there (`except: pass`); the only one that
 * happens in practice is "no person in this frame", which here is `points === null`.
 *
 * @param {ReturnType<typeof createWorkoutState>} previous
 * @param {ReturnType<typeof pickLandmarks>} points
 */
export function processFrame(previous, points) {
  if (!previous.active || previous.complete || !points) return previous;
  const state = structuredClone(previous);
  const p = points;

  // :943-952 angles
  const leftShoulderAngle = calculateAngle(p.left_hip, p.left_shoulder, p.left_elbow);
  const rightShoulderAngle = calculateAngle(p.right_hip, p.right_shoulder, p.right_elbow);
  const leftElbowAngle = calculateAngle(p.left_shoulder, p.left_elbow, p.left_wrist);
  const rightElbowAngle = calculateAngle(p.right_shoulder, p.right_elbow, p.right_wrist);
  state.left_shoulder_angle = leftShoulderAngle;
  state.right_shoulder_angle = rightShoulderAngle;
  state.left_elbow_angle = leftElbowAngle;
  state.right_elbow_angle = rightElbowAngle;

  // :955-956 asymmetry
  const asymmetry = Math.abs(leftShoulderAngle - rightShoulderAngle);
  state.asymmetry = asymmetry;

  // :959-961 the first frame's shoulder positions are the reference for shrugging
  if (state.initial_left_shoulder === null) {
    state.initial_left_shoulder = p.left_shoulder;
    state.initial_right_shoulder = p.right_shoulder;
  }
  // :964-967 calculate_shoulder_elevation: vertical movement only
  const leftElevation = Math.abs(p.left_shoulder[1] - state.initial_left_shoulder[1]);
  const rightElevation = Math.abs(p.right_shoulder[1] - state.initial_right_shoulder[1]);

  // :970-977 every frame, whatever the stage
  const rep = state.current_rep;
  const avgShoulderAngle = (leftShoulderAngle + rightShoulderAngle) / 2;
  rep.left_min_angle = Math.min(rep.left_min_angle, leftShoulderAngle);
  rep.left_max_angle = Math.max(rep.left_max_angle, leftShoulderAngle);
  rep.right_min_angle = Math.min(rep.right_min_angle, rightShoulderAngle);
  rep.right_max_angle = Math.max(rep.right_max_angle, rightShoulderAngle);
  rep.max_asymmetry = Math.max(rep.max_asymmetry, asymmetry);

  // :979-985 only while the arms are up (stage before this frame's transition)
  if (state.stage === 'up') {
    rep.left_elbow_angles.push(leftElbowAngle);
    rep.right_elbow_angles.push(rightElbowAngle);
    rep.left_shoulder_elevation = Math.max(rep.left_shoulder_elevation, leftElevation);
    rep.right_shoulder_elevation = Math.max(rep.right_shoulder_elevation, rightElevation);
  }

  // :988-1047 arms back down after being up: score the rep
  if (avgShoulderAngle <= METRICS.downThreshold && state.stage === 'up') {
    const leftRom = rep.left_max_angle - rep.left_min_angle;
    const rightRom = rep.right_max_angle - rep.right_min_angle;
    const avgRom = (leftRom + rightRom) / 2;
    const avgPeak = (rep.left_max_angle + rep.right_max_angle) / 2;
    // `np.std(list) if list else 0` (an empty list is falsy in Python)
    const leftElbowStd = rep.left_elbow_angles.length > 0 ? populationStd(rep.left_elbow_angles) : 0;
    const rightElbowStd = rep.right_elbow_angles.length > 0 ? populationStd(rep.right_elbow_angles) : 0;
    const elbowConsistent = leftElbowStd < METRICS.maxElbowVariance && rightElbowStd < METRICS.maxElbowVariance;
    const shoulderStable =
      rep.left_shoulder_elevation <= METRICS.maxShoulderElevation &&
      rep.right_shoulder_elevation <= METRICS.maxShoulderElevation;
    const symmetryExcellent = rep.max_asymmetry < METRICS.symmetryExcellent;
    const symmetryGood = rep.max_asymmetry < METRICS.symmetryGood;

    if (
      avgPeak >= METRICS.excellentPeak &&
      avgRom >= METRICS.minRom &&
      elbowConsistent &&
      shoulderStable &&
      symmetryExcellent
    ) {
      state.excellent_reps += 1;
      state.good_reps += 1; // good includes excellent
    } else if (avgPeak >= METRICS.goodPeak && avgRom >= METRICS.minRom && symmetryGood) {
      state.good_reps += 1;
    } else {
      state.partial_reps += 1;
    }
    state.stage = 'down';
    state.counter += 1;
    state.current_rep = freshRep();
    if (state.counter >= state.target_reps) {
      state.complete = true;
      state.active = false;
    }
  } else if (avgShoulderAngle >= METRICS.upThreshold && state.stage !== 'up') {
    state.stage = 'up'; // :1049-1050 (no count on the way up)
  }

  // :1053-1064 one warning, most important first. Drawn on the video only.
  let formWarning = '';
  if (asymmetry > METRICS.symmetryMaxAllowed) {
    formWarning = WARNINGS.uneven;
  } else if (leftElevation > METRICS.maxShoulderElevation || rightElevation > METRICS.maxShoulderElevation) {
    formWarning = WARNINGS.shrug;
  } else if (state.stage === 'up' && (leftElbowAngle + rightElbowAngle) / 2 < METRICS.elbowWarning) {
    formWarning = WARNINGS.elbows;
  }
  state.form_warning = formWarning;
  return state;
}
