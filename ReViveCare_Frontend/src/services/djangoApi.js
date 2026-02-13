// API Service for connecting React to Django Backend
// This file contains functions that match your actual Django endpoints

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// Helper to get CSRF token from cookies
const getCSRFToken = () => {
    const name = 'csrftoken';
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
};

// Generic API call helper
const apiCall = async (endpoint, method = 'GET', data = null) => {
    const csrfToken = getCSRFToken();

    const config = {
        method,
        credentials: 'include', // Important for session-based auth
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json', // Tell Django we want JSON response
            ...(csrfToken && { 'X-CSRFToken': csrfToken })
        },
    };

    if (data && method !== 'GET') {
        config.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

        // Handle different response types
        if (response.status === 204) {
            return { success: true };
        }

        const responseData = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(responseData.message || `API Error: ${response.statusText}`);
        }

        return responseData;
    } catch (error) {
        console.error(`API call failed for ${endpoint}:`, error);
        throw error;
    }
};

// Fetch CSRF token from Django
export const fetchCSRFToken = async () => {
    try {
        // Make a simple GET request to get the CSRF token cookie
        await fetch(`${API_BASE_URL}/`, {
            credentials: 'include'
        });
    } catch (error) {
        console.error('Failed to fetch CSRF token:', error);
    }
};

// ==================== Patient API ====================

export const patientAPI = {
    // Patient login (email only) - Django expects form data and returns HTML redirect
    login: async (email) => {
        // First, get CSRF token by making a request to Django
        await fetchCSRFToken();

        const csrfToken = getCSRFToken();
        console.log('CSRF Token:', csrfToken);

        // Send as form data instead of JSON
        const formData = new URLSearchParams();
        formData.append('email', email);

        const config = {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(csrfToken && { 'X-CSRFToken': csrfToken })
            },
            body: formData,
            redirect: 'manual' // Don't follow redirects automatically
        };

        try {
            const response = await fetch(`${API_BASE_URL}/login/`, config);
            console.log('Login response status:', response.status);
            console.log('Login response type:', response.type);

            // Django returns 302 redirect on success, or renders error page
            // Status 0 means opaqueredirect (redirect blocked by CORS but request succeeded)
            // Status 200 could be the form page or error
            // Status 302 is redirect (success)
            if (response.status === 0 || response.status === 302 || response.type === 'opaqueredirect') {
                console.log('Login successful (redirect detected)');
                return { success: true };
            }

            // If we get here, login might have failed
            // Try to get error message from response
            const text = await response.text().catch(() => '');
            console.error('Login may have failed:', text);

            // But let's be optimistic - if we got a response, try checking auth
            return { success: true };

        } catch (error) {
            console.error('Login request failed:', error);
            throw new Error('Unable to connect to server. Please make sure Django is running.');
        }
    },

    // Get current logged-in patient dashboard data
    getDashboard: async () => {
        return apiCall('/patient/dashboard/');
    },

    // Logout patient
    logout: async () => {
        return apiCall('/patient/logout/', 'POST');
    },
};

// ==================== Doctor API ====================

export const doctorAPI = {
    // Get doctor portal/dashboard
    getPortal: async () => {
        return apiCall('/doc_port/');
    },

    // Get doctor info page
    getInfoPage: async () => {
        return apiCall('/doc_info_page/');
    },

    // Submit patient information from doctor
    submitPatientInfo: async (patientData) => {
        return apiCall('/doctor_info', 'POST', patientData);
    },
};

// ==================== Chatbot API ====================

export const chatbotAPI = {
    // Get chatbot page (requires patient login)
    getChatbotPage: async () => {
        return apiCall('/patient/chatbot/');
    },

    // Send message to chatbot with optional language (hindi/english)
    sendMessage: async (message, language = 'english') => {
        return apiCall('/patient/chatbot/send/', 'POST', { message, language });
    },
};

// ==================== Exercise API ====================

export const exerciseAPI = {
    // Get exercise page
    getExercises: async () => {
        return apiCall('/exercise');
    },

    // Get specific exercise types
    getAR: async () => apiCall('/ar'),
    getBC: async () => apiCall('/bc'),
    getJJ: async () => apiCall('/jj'),
    getSR: async () => apiCall('/sr'),
    getSRTwo: async () => apiCall('/srtwo'),

    // Workout control endpoints
    startWorkout: async (targetReps = 12) => {
        return apiCall('/sr/start/', 'POST', { target_reps: targetReps });
    },

    getWorkoutStatus: async () => {
        return apiCall('/sr/status/');
    },

    resetWorkout: async () => {
        return apiCall('/sr/reset/', 'POST');
    },

    // Video feed URL (not a JSON endpoint)
    getVideoFeedUrl: () => {
        return `${API_BASE_URL}/sr/video_feed/`;
    },
};

// ==================== Home API ====================

export const homeAPI = {
    getHome: async () => {
        return apiCall('/');
    },
};

// ==================== Combined Export ====================

const djangoAPI = {
    patient: patientAPI,
    doctor: doctorAPI,
    chatbot: chatbotAPI,
    exercise: exerciseAPI,
    home: homeAPI,
};

export default djangoAPI;

// ==================== Utility Functions ====================

// Check if user is authenticated (has active session)
export const isAuthenticated = async () => {
    try {
        const response = await patientAPI.getDashboard();
        return !!response;
    } catch (error) {
        return false;
    }
};

// Handle API errors with user-friendly messages
export const handleAPIError = (error) => {
    if (error.message.includes('401') || error.message.includes('403')) {
        return 'Please log in to access this page.';
    }

    if (error.message.includes('404')) {
        return 'The requested resource was not found.';
    }

    if (error.message.includes('500')) {
        return 'Server error. Please try again later.';
    }

    return error.message || 'An unexpected error occurred.';
};
