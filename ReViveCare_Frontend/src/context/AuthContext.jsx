import { createContext, useContext, useState, useEffect } from 'react';
import djangoAPI from '../services/djangoApi';

const AuthContext = createContext(null);

// The hook lives next to its provider; Fast Refresh just reloads this file in full.
// eslint-disable-next-line react-refresh/only-export-components
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
            setLoading(true);
            const response = await djangoAPI.patient.getDashboard();

            if (response && response.patient) {
                setUser({
                    id: response.patient.id,
                    name: response.patient.name,
                    email: response.patient.email,
                    role: 'patient'
                });
            } else {
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
            setLoading(true);
            setError(null);

            // Django uses session-based auth, login returns redirect or error
            await djangoAPI.patient.login(email);

            // After successful login, fetch user data
            await checkAuthStatus();

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
