// Camera + pose tracking in the browser. Replaces Django's
// server-side webcam stream (/exercise/video_feed/) and the start/status/reset
// endpoints: MediaPipe finds the landmarks on each video frame and the ported
// rep logic (utils/exerciseLogic.js) updates the workout state, per browser tab.
import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
    createWorkoutState,
    pickLandmarks,
    processFrame,
    resetWorkout,
    startWorkout,
    workoutStatus,
} from '../utils/exerciseLogic';

// Pinned: the WASM runtime matches the installed @mediapipe/tasks-vision
// version, and the model is Google's versioned "full" pose model, the Tasks
// equivalent of Django's mp.solutions.pose model_complexity=1.
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

// Django parity: mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5) (views.py:888)
const LANDMARKER_OPTIONS = {
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
};

// The landmarks drawn on the overlay: the arms and the hips the logic uses.
const CONNECTIONS = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24]];

function drawOverlay(canvas, video, landmarks, warning) {
    const ctx = canvas.getContext('2d');
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (landmarks) {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 4;
        for (const [a, b] of CONNECTIONS) {
            ctx.beginPath();
            ctx.moveTo(landmarks[a].x * canvas.width, landmarks[a].y * canvas.height);
            ctx.lineTo(landmarks[b].x * canvas.width, landmarks[b].y * canvas.height);
            ctx.stroke();
        }
    }
    if (warning) {
        // The canvas is mirrored with the video (CSS), so un-mirror the text.
        ctx.save();
        ctx.scale(-1, 1);
        ctx.font = 'bold 28px sans-serif';
        ctx.fillStyle = '#ef4444';
        ctx.fillText(warning, -canvas.width + 20, canvas.height - 24);
        ctx.restore();
    }
}

/**
 * @param {boolean} cameraOn true while a set is running
 * @returns {{ videoRef, canvasRef, status, formWarning: string, cameraError: string | null,
 *   start: (targetReps: number) => void, reset: () => void }}
 *   status has Django's 7 status fields (active, complete, counter, target_reps,
 *   excellent_reps, good_reps, partial_reps).
 */
export function usePoseWorkout(cameraOn) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const stateRef = useRef(createWorkoutState());
    const [status, setStatus] = useState(() => workoutStatus(createWorkoutState()));
    const [formWarning, setFormWarning] = useState('');
    const [cameraError, setCameraError] = useState(null);

    // Re-render only when something the page shows changed, not on every frame.
    const publish = useCallback((next) => {
        const previous = stateRef.current;
        stateRef.current = next;
        const a = workoutStatus(previous);
        const b = workoutStatus(next);
        if (Object.keys(b).some((k) => a[k] !== b[k])) setStatus(b);
        if (previous.form_warning !== next.form_warning) setFormWarning(next.form_warning);
    }, []);

    const start = useCallback((targetReps) => publish(startWorkout(stateRef.current, targetReps)), [publish]);
    const reset = useCallback(() => publish(resetWorkout(stateRef.current)), [publish]);

}
