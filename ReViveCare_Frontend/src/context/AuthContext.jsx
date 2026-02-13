import React, { createContext, useContext, useState, useEffect } from 'react';
import djangoAPI from '../services/djangoApi';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Check if user is already logged in on mount
    useEffect(() => {
        checkAuthStatus();
    }, []);

    const checkAuthStatus = async () => {
        try {
            console.log('[AuthContext] Fetching dashboard data...');
            setLoading(true);
            const response = await djangoAPI.patient.getDashboard();
            console.log('[AuthContext] Dashboard API response:', response);

            if (response && response.patient) {
                console.log('[AuthContext] Found patient data:', response.patient);
                setUser({
                    id: response.patient.id,
                    name: response.patient.name,
                    email: response.patient.email,
                    role: 'patient'
                });
            } else {
                console.log('[AuthContext] No patient data in response');
                setUser(null);
            }
        } catch (err) {
            console.error('[AuthContext] Dashboard fetch error:', err);
            // User is not logged in, which is fine
            setUser(null);
        } finally {
            setLoading(false);
        }
    };

    const login = async (email) => {
        try {
            console.log('[AuthContext] Starting login for:', email);
            setLoading(true);
            setError(null);

            // Django uses session-based auth, login returns redirect or error
            const response = await djangoAPI.patient.login(email);
            console.log('[AuthContext] Login API response:', response);

            // After successful login, fetch user data
            console.log('[AuthContext] Checking auth status...');
            await checkAuthStatus();
            console.log('[AuthContext] User after checkAuthStatus:', user);

            return { success: true };
        } catch (err) {
            console.error('[AuthContext] Login error:', err);
            setError(err.message || 'Login failed');
            throw err; // Re-throw so PatientLogin can catch it
        } finally {
            setLoading(false);
        }
    };

    const logout = async () => {
        try {
            setLoading(true);
            await djangoAPI.patient.logout();
            setUser(null);
            return { success: true };
        } catch (err) {
            setError(err.message || 'Logout failed');
            return { success: false, error: err.message };
        } finally {
            setLoading(false);
        }
    };

    const value = {
        user,
        loading,
        error,
        login,
        logout,
        isAuthenticated: !!user,
        checkAuthStatus,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
