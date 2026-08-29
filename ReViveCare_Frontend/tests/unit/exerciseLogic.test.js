// The ported rep logic against Django's own loop on identical landmarks
// (parity-tools/golden/exercise_landmarks.py ran views.generate_frames on the
// demo videos with real MediaPipe, and on scripted poses that reach every branch).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  calculateAngle,
  createWorkoutState,
  processFrame,
  resetWorkout,
  startWorkout,
  workoutStatus,
} from '../../src/utils/exerciseLogic.js';

const golden = JSON.parse(readFileSync(new URL('../fixtures/exercise_golden.json', import.meta.url), 'utf8'));

// numpy's arctan2 (platform libm) and V8's Math.atan2 may differ in the last
// bit, so angles are compared within 1e-9 degrees; everything discrete
// (stage, counts, warnings, completion) must match exactly.
const ANGLE_TOLERANCE = 1e-9;
const NUMERIC = ['left_shoulder_angle', 'right_shoulder_angle', 'left_elbow_angle', 'right_elbow_angle', 'asymmetry'];

function expectStateMatches(actual, expected, where) {
  const discrete = (s) => {
    const { current_rep: rep, ...rest } = s;
    for (const k of NUMERIC) delete rest[k];
    return { ...rest, elbow_samples: [rep.left_elbow_angles.length, rep.right_elbow_angles.length] };
  };
  expect(discrete(actual), where).toEqual(discrete(expected));
  for (const k of NUMERIC) expect(Math.abs(actual[k] - expected[k]), `${where} ${k}`).toBeLessThan(ANGLE_TOLERANCE);
  const repNumbers = (r) => [
    r.left_min_angle,
    r.left_max_angle,
    r.right_min_angle,
    r.right_max_angle,
    r.max_asymmetry,
    r.left_shoulder_elevation,
    r.right_shoulder_elevation,
    ...r.left_elbow_angles,
    ...r.right_elbow_angles,
  ];
  const a = repNumbers(actual.current_rep);
  const e = repNumbers(expected.current_rep);
  a.forEach((v, i) => expect(Math.abs(v - e[i]), `${where} current_rep[${i}]`).toBeLessThan(ANGLE_TOLERANCE));
}

describe('golden: Django generate_frames on identical landmarks', () => {
  it.each(golden.runs.map((r) => [r.name, r]))('%s', (_name, run) => {
    // Django's state right after start_workout: the same as startWorkout() apart
    // from the angles left over from the previous run, which start doesn't reset.
    let state = structuredClone(run.initial_state);
    expect(workoutStatus(state)).toEqual(workoutStatus(startWorkout(createWorkoutState(), run.target_reps)));
    run.frames.forEach((frame, i) => {
      state = processFrame(state, frame.landmarks);
      if (frame.reset_after) state = resetWorkout(state);
      expectStateMatches(state, frame.state, `frame ${i}`);
    });
  });

  it('covers every outcome somewhere in the fixture', () => {
    const finals = golden.runs.map((r) => r.frames.at(-1).state);
    const warnings = new Set(golden.runs.flatMap((r) => r.frames.map((f) => f.state.form_warning)));
    expect(finals.some((s) => s.excellent_reps > 0)).toBe(true);
    expect(finals.some((s) => s.good_reps > s.excellent_reps)).toBe(true);
    expect(finals.some((s) => s.partial_reps > 0)).toBe(true);
    expect(finals.some((s) => s.complete)).toBe(true);
    expect(warnings.size).toBe(4); // '', uneven, shrug, elbows
  });
});

describe('the rules, one by one', () => {
  it('measures the angle at the middle point, 0-180 degrees', () => {
    expect(calculateAngle([0, 1], [0, 0], [1, 0])).toBeCloseTo(90, 12);
    expect(calculateAngle([0, 1], [0, 0], [0, -1])).toBeCloseTo(180, 12);
    expect(calculateAngle([1, 1], [0, 0], [-1, -1])).toBeCloseTo(180, 12);
    expect(calculateAngle([0, 0], [0, 0], [0, 0])).toBe(0);
  });

  it('start resets everything; reset keeps the stage and the current rep (Django quirk)', () => {
    let s = startWorkout(createWorkoutState(), 5);
    s = { ...s, stage: 'up', counter: 3, good_reps: 3 };
    const reset = resetWorkout(s);
    expect(workoutStatus(reset)).toEqual({
      active: false,
      complete: false,
      counter: 0,
      target_reps: 5,
      excellent_reps: 0,
      good_reps: 0,
      partial_reps: 0,
    });
    expect(reset.stage).toBe('up');
  });

  it('ignores frames before start, after completion and without a person', () => {
    const idle = createWorkoutState();
    expect(processFrame(idle, null)).toBe(idle);
    const started = startWorkout(idle, 1);
    expect(processFrame(started, null)).toBe(started);
  });
});
