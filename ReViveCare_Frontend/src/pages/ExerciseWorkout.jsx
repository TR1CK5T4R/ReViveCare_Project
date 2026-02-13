import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Play, Pause, RotateCcw, CheckCircle2, Camera, AlertCircle, Dumbbell, Activity, Zap, Target, Settings, Timer, X } from 'lucide-react';
import { Card, Button, PageLayout } from '../components';
import djangoAPI from '../services/djangoApi';

// Map exercise IDs to their icons
const exerciseIcons = {
    'bicep-curl': Dumbbell,
    'shoulder-extension': Activity,
    'jumping-jacks': Zap,
    'arm-raises': Target
};

const SettingsModal = ({ isOpen, onClose, onSave, defaultReps, defaultSets, defaultRest }) => {
    const [reps, setReps] = useState(defaultReps);
    const [sets, setSets] = useState(defaultSets);
    const [rest, setRest] = useState(defaultRest);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-xl font-bold text-gray-900">Workout Settings</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Reps Selection */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Target Reps per Set</label>
                        <div className="flex items-center gap-4">
                            <input
                                type="range"
                                min="1"
                                max="50"
                                value={reps}
                                onChange={(e) => setReps(parseInt(e.target.value))}
                                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                            />
                            <span className="text-xl font-bold text-emerald-600 min-w-[3ch]">{reps}</span>
                        </div>
                    </div>

                    {/* Sets Selection */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Number of Sets</label>
                        <div className="flex gap-2">
                            {[1, 2, 3, 4, 5].map((num) => (
                                <button
                                    key={num}
                                    onClick={() => setSets(num)}
                                    className={`flex-1 py-2 rounded-lg font-medium transition-colors ${sets === num
                                        ? 'bg-emerald-600 text-white shadow-md'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                >
                                    {num}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Rest Time */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Rest Between Sets (Seconds)</label>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => setRest(Math.max(15, rest - 15))}
                                className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200 font-bold"
                            >
                                -
                            </button>
                            <div className="flex-1 text-center">
                                <span className="text-2xl font-bold text-gray-900">{rest}s</span>
                            </div>
                            <button
                                onClick={() => setRest(Math.min(120, rest + 15))}
                                className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200 font-bold"
                            >
                                +
                            </button>
                        </div>
                    </div>
                </div>

                <div className="p-6 bg-gray-50 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave(reps, sets, rest)}
                        className="flex-1 py-3 px-4 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-semibold rounded-xl hover:from-emerald-700 hover:to-emerald-800 shadow-lg transition-all transform hover:scale-[1.02]"
                    >
                        Save Settings
                    </button>
                </div>
            </div>
        </div>
    );
};

const RestTimer = ({ duration, onComplete }) => {
    const [timeLeft, setTimeLeft] = useState(duration);

    useEffect(() => {
        if (timeLeft <= 0) {
            onComplete();
            return;
        }

        const timer = setInterval(() => {
            setTimeLeft((prev) => prev - 1);
        }, 1000);

        return () => clearInterval(timer);
    }, [timeLeft, onComplete]);

    const progress = ((duration - timeLeft) / duration) * 100;

    return (
        <div className="absolute inset-0 z-10 bg-black/80 flex flex-col items-center justify-center text-white backdrop-blur-sm animate-in fade-in duration-300">
            <div className="relative w-48 h-48 mb-8 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90">
                    <circle
                        className="text-gray-700"
                        strokeWidth="8"
                        stroke="currentColor"
                        fill="transparent"
                        r="90"
                        cx="96"
                        cy="96"
                    />
                    <circle
                        className="text-emerald-500 transition-all duration-1000 ease-linear"
                        strokeWidth="8"
                        strokeDasharray={2 * Math.PI * 90}
                        strokeDashoffset={2 * Math.PI * 90 * (progress / 100)}
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="transparent"
                        r="90"
                        cx="96"
                        cy="96"
                    />
                </svg>
                <div className="absolute flex flex-col items-center">
                    <span className="text-5xl font-bold font-mono">{timeLeft}</span>
                    <span className="text-sm text-gray-400 mt-1">SECONDS</span>
                </div>
            </div>

            <h3 className="text-2xl font-bold mb-2">Rest Time</h3>
            <p className="text-gray-400 mb-8">Take a breath and get ready for the next set</p>

            <button
                onClick={onComplete}
                className="px-8 py-3 bg-white text-black font-bold rounded-full hover:bg-emerald-50 transition-colors flex items-center gap-2"
            >
                Skip Rest <ArrowLeft className="w-4 h-4 rotate-180" />
            </button>
        </div>
    );
};

export default function ExerciseWorkout() {
    const navigate = useNavigate();
    const location = useLocation();
    const exercise = location.state?.exercise;

    // Workout Configuration
    const [targetReps, setTargetReps] = useState(exercise?.targetReps || 12);
    const [targetSets, setTargetSets] = useState(3);
    const [restTime, setRestTime] = useState(30);
    const [currentSet, setCurrentSet] = useState(1);
    const [isResting, setIsResting] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    const [workoutStarted, setWorkoutStarted] = useState(false);
    const [workoutStatus, setWorkoutStatus] = useState(null);
    const [error, setError] = useState(null);
    const [cameraPermission, setCameraPermission] = useState(null);
    const videoRef = useRef(null);

    // Redirect if no exercise data
    useEffect(() => {
        if (!exercise) {
            navigate('/patient/exercises');
        }
    }, [exercise, navigate]);

    // Update local state if exercise prop changes
    useEffect(() => {
        if (exercise) {
            setTargetReps(exercise.targetReps || 12);
        }
    }, [exercise]);

    const handleStartWorkout = async () => {
        try {
            setError(null);
            console.log(`Starting Set ${currentSet}/${targetSets} with ${targetReps} reps`);

            // Start the workout session on Django backend
            const response = await djangoAPI.exercise.startWorkout(targetReps);
            console.log('Workout started:', response);

            setWorkoutStarted(true);
            setIsResting(false);

            // Start polling for workout status
            pollWorkoutStatus();
        } catch (err) {
            console.error('Failed to start workout:', err);
            setError('Failed to start workout. Please make sure Django is running.');
        }
    };

    const pollWorkoutStatus = async () => {
        try {
            const status = await djangoAPI.exercise.getWorkoutStatus();
            setWorkoutStatus(status);

            // Check if set is complete
            if (status.completed && !isResting) {
                if (currentSet < targetSets) {
                    // Start rest period
                    setWorkoutStarted(false);
                    setIsResting(true);
                } else {
                    // All sets done
                    setWorkoutStarted(false);
                    // Could show a completion modal here
                }
            }

            // Continue polling if workout is active and not resting
            if (workoutStarted && !status.completed && !isResting) {
                setTimeout(pollWorkoutStatus, 500); // Poll every 500ms
            }
        } catch (err) {
            console.error('Failed to get workout status:', err);
        }
    };

    const handleResetWorkout = async () => {
        try {
            await djangoAPI.exercise.resetWorkout();
            setWorkoutStatus(null);
            setWorkoutStarted(false);
            // Don't reset current set here, user might want to retry current set
        } catch (err) {
            console.error('Failed to reset workout:', err);
        }
    };

    const handleNextSet = () => {
        setIsResting(false);
        setCurrentSet(prev => prev + 1);
        setWorkoutStatus(null);
        handleStartWorkout();
    };

    const handleSettingsSave = (newReps, newSets, newRest) => {
        setTargetReps(newReps);
        setTargetSets(newSets);
        setRestTime(newRest);
        setShowSettings(false);
    };

    if (!exercise) {
        return null;
    }

    // Get the icon component for this exercise
    const Icon = exerciseIcons[exercise.id] || Activity;

    return (
        <PageLayout>
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/20 pb-20">
                {/* Header */}
                <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200 shadow-sm sticky top-0 z-30">
                    <div className="max-w-7xl mx-auto px-6 py-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => navigate('/patient/exercises')}
                                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-slate-600"
                                >
                                    <ArrowLeft className="w-5 h-5" />
                                </button>
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 bg-gradient-to-br from-${exercise.color}-500 to-${exercise.color}-600 rounded-xl flex items-center justify-center shadow-sm`}>
                                        <Icon className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <h1 className="text-xl font-bold text-gray-900">{exercise.name}</h1>
                                        <div className="flex items-center gap-3 text-sm text-gray-500">
                                            <span>Set {currentSet} of {targetSets}</span>
                                            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                                            <span>{targetReps} Reps</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => setShowSettings(true)}
                                disabled={workoutStarted || isResting}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                <Settings className="w-4 h-4" />
                                Settings
                            </button>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div className="max-w-7xl mx-auto px-6 py-8">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Video Feed */}
                        <Card className="lg:col-span-2 overflow-hidden relative">
                            {isResting && (
                                <RestTimer
                                    duration={restTime}
                                    onComplete={handleNextSet}
                                />
                            )}

                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                    <Camera className="w-5 h-5" />
                                    {exercise.hasCamera ? 'Live Camera Feed' : 'Exercise Video'}
                                </h2>
                                {workoutStarted && (
                                    <div className="px-3 py-1 bg-red-100 text-red-600 rounded-full text-xs font-bold animate-pulse flex items-center gap-2">
                                        <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                                        LIVE
                                    </div>
                                )}
                            </div>

                            {error && (
                                <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2">
                                    <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
                                    <p className="text-sm text-rose-700">{error}</p>
                                </div>
                            )}

                            {exercise.hasCamera ? (
                                <div className="relative bg-black rounded-xl overflow-hidden shadow-inner aspect-video group">
                                    {workoutStarted ? (
                                        <img
                                            ref={videoRef}
                                            src={djangoAPI.exercise.getVideoFeedUrl()}
                                            alt="Exercise video feed"
                                            className="w-full h-full object-contain"
                                            onError={(e) => {
                                                console.error('Video feed error:', e);
                                                setError('Failed to load video feed. Make sure your camera is connected and Django is running.');
                                            }}
                                        />
                                    ) : (
                                        <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
                                            <div className="text-center text-white">
                                                {currentSet > 1 && !isResting && workoutStatus?.completed ? (
                                                    // Set Complete State
                                                    <div className="animate-in zoom-in duration-300">
                                                        <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/30">
                                                            <CheckCircle2 className="w-10 h-10 text-white" />
                                                        </div>
                                                        <h3 className="text-3xl font-bold mb-2">Set {currentSet} Complete!</h3>
                                                        <p className="text-emerald-200 mb-8">Great job! Prepare for the next set.</p>
                                                        <Button
                                                            onClick={handleNextSet}
                                                            size="lg"
                                                            className="bg-white text-emerald-900 hover:bg-emerald-50"
                                                            icon={Play}
                                                        >
                                                            Start Set {currentSet + 1}
                                                        </Button>
                                                    </div>
                                                ) : currentSet === targetSets + 1 ? (
                                                    // All Sets Complete State
                                                    <div className="animate-in zoom-in duration-300">
                                                        <div className="w-24 h-24 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-500/40">
                                                            <Target className="w-12 h-12 text-white" />
                                                        </div>
                                                        <h3 className="text-4xl font-bold mb-2">Workout Complete!</h3>
                                                        <p className="text-emerald-200 mb-8 text-lg">You've crushed your daily goal.</p>
                                                        <div className="flex gap-4 justify-center">
                                                            <Button
                                                                onClick={() => navigate('/patient/dashboard')}
                                                                variant="white"
                                                            >
                                                                Back to Dashboard
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    // Ready to Start State
                                                    <div className="group-hover:scale-105 transition-transform duration-300">
                                                        <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-6 backdrop-blur-md border border-white/20">
                                                            <Play className="w-10 h-10 text-white pl-1" />
                                                        </div>
                                                        <h3 className="text-2xl font-bold mb-2">Ready for Set {currentSet}</h3>
                                                        <p className="text-slate-400">Click "Start Workout" to begin</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="bg-gray-100 rounded-xl flex items-center justify-center aspect-video">
                                    <div className="text-center text-gray-500">
                                        <Icon className="w-16 h-16 mx-auto mb-4 opacity-20" />
                                        <p>Exercise demonstration coming soon</p>
                                    </div>
                                </div>
                            )}
                        </Card>

                        {/* Stats & Controls */}
                        <div className="space-y-6">
                            {/* Set Progress */}
                            <Card>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-bold text-gray-900">Current Set</h3>
                                    <span className="px-2 py-1 bg-gray-100 rounded-md text-xs font-semibold text-gray-600">
                                        {currentSet} / {targetSets} Sets
                                    </span>
                                </div>

                                <div className="flex gap-2 mb-6">
                                    {Array.from({ length: targetSets }).map((_, i) => (
                                        <div
                                            key={i}
                                            className={`h-2 flex-1 rounded-full transition-colors ${i + 1 < currentSet ? 'bg-emerald-500' :
                                                i + 1 === currentSet ? (workoutStarted ? 'bg-emerald-500 animate-pulse' : 'bg-emerald-200') :
                                                    'bg-gray-200'
                                                }`}
                                        />
                                    ))}
                                </div>

                                <div className="text-center py-6 bg-slate-50 rounded-xl mb-4 border border-slate-100">
                                    <span className="block text-sm text-slate-500 mb-1">REPS COMPLETED</span>
                                    <div className="flex items-baseline justify-center gap-2">
                                        <span className={`text-5xl font-bold ${workoutStatus?.completed ? 'text-emerald-600' : 'text-slate-900'}`}>
                                            {workoutStatus?.reps_count || 0}
                                        </span>
                                        <span className="text-xl text-slate-400 font-medium">/ {targetReps}</span>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    {!workoutStarted ? (
                                        currentSet <= targetSets ? (
                                            <Button
                                                variant="primary"
                                                size="lg"
                                                className="w-full shadow-lg shadow-emerald-500/20"
                                                icon={Play}
                                                onClick={handleStartWorkout}
                                                disabled={exercise.hasCamera && cameraPermission === 'denied'}
                                            >
                                                {currentSet === 1 ? 'Start Workout' : `Start Set ${currentSet}`}
                                            </Button>
                                        ) : (
                                            <Button
                                                variant="primary"
                                                size="lg"
                                                className="w-full"
                                                onClick={() => navigate('/patient/dashboard')}
                                            >
                                                Finish Workout
                                            </Button>
                                        )
                                    ) : (
                                        <Button
                                            variant="secondary"
                                            size="lg"
                                            className="w-full border-2 border-slate-200 hover:border-slate-300"
                                            icon={RotateCcw}
                                            onClick={handleResetWorkout}
                                        >
                                            Reset Set
                                        </Button>
                                    )}
                                </div>
                            </Card>

                            {/* Instructions with Tips */}
                            <Card className="bg-blue-50/50 border-blue-100">
                                <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                                    <Zap className="w-4 h-4 text-blue-500" />
                                    Quick Tips
                                </h3>
                                <ul className="text-sm text-slate-600 space-y-3">
                                    <li className="flex gap-2">
                                        <span className="text-blue-500 font-bold">•</span>
                                        Keep your movements steady and controlled
                                    </li>
                                    <li className="flex gap-2">
                                        <span className="text-blue-500 font-bold">•</span>
                                        Position yourself clearly in the frame
                                    </li>
                                    <li className="flex gap-2">
                                        <span className="text-blue-500 font-bold">•</span>
                                        Ensure good lighting for best tracking
                                    </li>
                                </ul>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>

            {/* Config Modal */}
            <SettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
                onSave={handleSettingsSave}
                defaultReps={targetReps}
                defaultSets={targetSets}
                defaultRest={restTime}
            />
        </PageLayout>
    );
}
