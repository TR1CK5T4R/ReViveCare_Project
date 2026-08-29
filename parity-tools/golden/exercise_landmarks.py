"""Golden data for the exercise rep logic (R-EX-01/02/03).

Runs Django's real generate_frames() loop and start/reset views from the
reference copy. Only the camera and the pose detector are swapped (no Python
file is edited):
- recorded runs: cv2.VideoCapture(0) reads one of the demo videos instead of
  the webcam, and the real MediaPipe Pose (same version and settings as
  Django) finds the landmarks;
- synthetic runs: a scripted pose detector returns arm positions that drive
  every branch (excellent / good / partial reps, shrug, uneven arms, bent
  elbows, frames with no person, completion).
For every frame it records the 8 landmarks the logic reads (or null when no
person was found) and the workout state after Django processed that frame.
Writes ReViveCare_Frontend/tests/fixtures/exercise_golden.json.
"""
import copy
import json
import math
import pathlib
import random
import sys

import django

django.setup()

import cv2  # noqa: E402
import mediapipe as mp  # noqa: E402
import numpy as np  # noqa: E402
from django.test import RequestFactory  # noqa: E402
from mediapipe.framework.formats import landmark_pb2  # noqa: E402

import Patients.views as views  # noqa: E402

out = pathlib.Path(sys.argv[1]) / "exercise_golden.json"
VIDEOS = pathlib.Path(views.__file__).parent / "static" / "Patients" / "videos"
USED = {11: "left_shoulder", 12: "right_shoulder", 13: "left_elbow", 14: "right_elbow",
        15: "left_wrist", 16: "right_wrist", 23: "left_hip", 24: "right_hip"}
STATE_KEYS = ["active", "complete", "counter", "stage", "excellent_reps", "good_reps", "partial_reps",
              "target_reps", "current_rep", "initial_left_shoulder", "initial_right_shoulder", "form_warning",
              "left_shoulder_angle", "right_shoulder_angle", "left_elbow_angle", "right_elbow_angle", "asymmetry"]
RealPose = mp.solutions.pose.Pose
RealVideoCapture = cv2.VideoCapture  # views.cv2 is this same module: keep the original
factory = RequestFactory()


def plain(value):
    """numpy floats → Python floats, recursively (json can't write np.float64 keys/values otherwise)."""
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [plain(v) for v in value]
    if isinstance(value, (np.floating,)):
        return float(value)
    return value


class Results:
    def __init__(self, landmarks):
        self.pose_landmarks = landmarks


def record(frames_landmarks, results):
    if results.pose_landmarks is None:
        frames_landmarks.append(None)
    else:
        lm = results.pose_landmarks.landmark
        frames_landmarks.append({name: [float(lm[i].x), float(lm[i].y)] for i, name in USED.items()})


def run(pose_class, capture_factory, target_reps, reset_after=None):
    """Drive generate_frames once; return per-frame landmarks and states."""
    landmarks_per_frame = []

    class RecordingPose(pose_class):
        def process(self, image):
            results = super().process(image)
            record(landmarks_per_frame, results)
            return results

    views.mp.solutions.pose.Pose = RecordingPose
    views.cv2.VideoCapture = capture_factory
    views.reset_workout(factory.post("/exercise/reset/"))
    views.start_workout(factory.post("/exercise/start/", data=json.dumps({"target_reps": target_reps}),
                                     content_type="application/json"))
    # start_workout keeps the previous frame's angles (it only resets counters and the rep),
    # so each run records the exact state it starts from.
    initial = {k: plain(copy.deepcopy(views.workout_state[k])) for k in STATE_KEYS}
    frames = []
    for i, _jpeg in enumerate(views.generate_frames()):
        reset = reset_after is not None and i == reset_after
        if reset:  # the patient presses Reset after this frame (E21)
            views.reset_workout(factory.post("/exercise/reset/"))
        state = {k: plain(copy.deepcopy(views.workout_state[k])) for k in STATE_KEYS}
        frames.append({"landmarks": landmarks_per_frame[-1], "reset_after": reset, "state": state})
    views.mp.solutions.pose.Pose = RealPose
    return {"initial_state": initial, "frames": frames}


def video_capture(path, every=1):
    def factory_(index):
        assert index == 0
        cap = RealVideoCapture(str(path))

        class Sampled:
            def isOpened(self):
                return cap.isOpened()

            def read(self):
                for _ in range(every - 1):
                    cap.read()
                return cap.read()

            def release(self):
                cap.release()

        return Sampled()
    return factory_


# ── synthetic poses ──────────────────────────────────────────────────────────

def arm(shoulder, side, shoulder_deg, elbow_deg, upper=0.12, fore=0.11):
    """Points for one arm: the angle at the shoulder between hip and elbow, and the elbow angle."""
    sx, sy = shoulder
    t = math.radians(shoulder_deg)
    elbow = (sx + side * upper * math.sin(t), sy + upper * math.cos(t))
    bend = math.radians(180 - elbow_deg)
    u = (elbow[0] - sx, elbow[1] - sy)
    n = math.hypot(*u)
    u = (u[0] / n, u[1] / n)
    c, s = math.cos(side * bend), math.sin(side * bend)
    d = (u[0] * c - u[1] * s, u[0] * s + u[1] * c)
    wrist = (elbow[0] + fore * d[0], elbow[1] + fore * d[1])
    return elbow, wrist


def pose_points(l_sh, r_sh, l_el=178, r_el=178, shrug_l=0.0, shrug_r=0.0, rng=None, jitter=0.0):
    j = (lambda: rng.uniform(-jitter, jitter)) if rng else (lambda: 0.0)
    ls, rs = (0.42 + j(), 0.35 - shrug_l + j()), (0.58 + j(), 0.35 - shrug_r + j())
    lh, rh = (0.44, 0.65), (0.56, 0.65)
    le, lw = arm(ls, -1, l_sh, l_el)
    re, rw = arm(rs, 1, r_sh, r_el)
    # A real NormalizedLandmarkList, as MediaPipe returns (the drawing code needs it).
    # Its fields are float32, so the values Django reads are rounded like real landmarks.
    points = {11: ls, 12: rs, 13: le, 14: re, 15: lw, 16: rw, 23: lh, 24: rh}
    result = landmark_pb2.NormalizedLandmarkList()
    for idx in range(33):
        x, y = points.get(idx, (0.5, 0.5))
        result.landmark.add(x=x, y=y, z=0.0, visibility=1.0)
    return result


def rep(peak_l, peak_r=None, steps=10, **kw):
    peak_r = peak_l if peak_r is None else peak_r
    up = [(20 + (peak_l - 20) * i / steps, 20 + (peak_r - 20) * i / steps) for i in range(steps + 1)]
    return [(l, r, kw) for l, r in up + up[::-1]]


def script(seed):
    rng = random.Random(seed)
    frames = [None, None]  # no person yet
    frames += rep(112) + rep(112, l_el=150, r_el=150) + rep(100) + rep(108, 96)
    frames += rep(112, shrug_l=0.04, shrug_r=0.04) + [None] + rep(115, 92) + rep(104)
    frames += rep(102, steps=3) + rep(130, 125, l_el=170, r_el=171)
    for _ in range(6):
        frames += rep(rng.uniform(95, 125), rng.uniform(95, 125), steps=rng.randint(3, 14),
                      l_el=rng.uniform(150, 180), r_el=rng.uniform(150, 180),
                      shrug_l=rng.choice([0, 0, 0.01, 0.03]), shrug_r=rng.choice([0, 0.02]))
    out_frames = []
    for f in frames:
        if f is None:
            out_frames.append(None)
        else:
            l, r, kw = f
            out_frames.append(pose_points(l, r, rng=rng, jitter=0.002, **kw))
    return out_frames


class ScriptedCapture:
    def __init__(self, n):
        self.n = n

    def isOpened(self):
        return self.n > 0

    def read(self):
        self.n -= 1
        return True, np.zeros((48, 64, 3), dtype=np.uint8)

    def release(self):
        pass


def scripted_pose(frames):
    class ScriptedPose:
        def __init__(self, **kwargs):
            self.frames = iter(frames)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def process(self, image):
            return Results(next(self.frames))

    return ScriptedPose


runs = []
for name, every in [("sl.mp4", 1), ("ar.mp4", 1), ("bc.mp4", 2), ("jj.mp4", 4)]:
    for target in [12, 3]:
        runs.append({"name": f"video {name} every {every} frame(s), target {target}", "target_reps": target,
                     **run(RealPose, video_capture(VIDEOS / name, every), target)})
        print("recorded", runs[-1]["name"], len(runs[-1]["frames"]), "frames", "reps", runs[-1]["frames"][-1]["state"]["counter"])
for seed, target in [(1, 50), (2, 50), (3, 7), (4, 2)]:
    frames = script(seed)
    runs.append({"name": f"synthetic seed {seed}, target {target}", "target_reps": target,
                 **run(scripted_pose(frames), lambda i, n=len(frames): ScriptedCapture(n), target)})
frames = script(5)
runs.append({"name": "synthetic seed 5, reset in the middle", "target_reps": 50,
             **run(scripted_pose(frames), lambda i, n=len(frames): ScriptedCapture(n), 50, reset_after=60)})

summary = {r["name"]: {k: r["frames"][-1]["state"][k] for k in ("counter", "excellent_reps", "good_reps", "partial_reps", "complete")}
           for r in runs}
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"mediapipe": mp.__version__, "numpy": np.__version__, "runs": runs}) + "\n", encoding="utf-8")
print(json.dumps(summary, indent=1))
