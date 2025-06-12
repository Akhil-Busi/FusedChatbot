// client/src/components/ApiKeyModal.js
import React, { useState } from 'react';
// We no longer need a dedicated CSS file if it's empty,
// as styles are inherited from AuthPage's injected CSS.
// import './ApiKeyModal.css'; 

const ApiKeyModal = ({ username, onSave }) => {
    const [geminiApiKey, setGeminiApiKey] = useState('');
    const [grokApiKey, setGrokApiKey] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        // You can adjust this validation if only one key is required.
        if (!geminiApiKey.trim() || !grokApiKey.trim()) {
            setError('For the best experience, both Gemini and Grok API keys are recommended.');
            // This is just a warning now, so we don't return.
        }

        setLoading(true);
        try {
            await onSave({ geminiApiKey, grokApiKey });
            // AuthPage handles navigation on success.
        } catch (err) {
            const errorMessage = err.response?.data?.message || 'Failed to save keys. Please try again.';
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    // ==================================================================
    //  START OF MODIFICATION: Replaced overlay with .auth-box
    // ==================================================================
    return (
        // Use the 'auth-box' class to inherit all styling from AuthPage
        <div className="auth-box"> 
            <h2>Welcome, {username}!</h2>
            <p className="auth-sub-header">To complete your setup, please enter your API keys.</p>
            
            <form onSubmit={handleSubmit}>
                <div className="input-group">
                    <label htmlFor="gemini-key">Gemini AI API Key</label>
                    <input
                        id="gemini-key"
                        type="password"
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        placeholder="Enter your Gemini API Key"
                        disabled={loading}
                        autoComplete="new-password" // Prevent browser autofill
                    />
                </div>
                <div className="input-group">
                    <label htmlFor="grok-key">Grok API Key</label>
                    <input
                        id="grok-key"
                        type="password"
                        value={grokApiKey}
                        onChange={(e) => setGrokApiKey(e.target.value)}
                        placeholder="Enter your Grok API Key"
                        disabled={loading}
                        autoComplete="new-password" // Prevent browser autofill
                    />
                </div>
                {error && <p className="error-message">{error}</p>}
                <button type="submit" disabled={loading} className="auth-button">
                    {loading ? 'Saving...' : 'Save and Continue'}
                </button>
            </form>
        </div>
    );
    // ==================================================================
    //  END OF MODIFICATION
    // ==================================================================
};

export default ApiKeyModal;