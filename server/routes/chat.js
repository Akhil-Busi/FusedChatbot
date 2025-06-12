// server/routes/chat.js
const express = require('express');
const axios = require('axios');
const { tempAuth } = require('../middleware/authMiddleware');
const ChatHistory = require('../models/ChatHistory');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const { decrypt } = require('../services/encryptionService');

const router = express.Router();

const PYTHON_AI_SERVICE_URL = process.env.PYTHON_AI_CORE_SERVICE_URL;
if (!PYTHON_AI_SERVICE_URL) {
    console.error("FATAL ERROR: PYTHON_AI_CORE_SERVICE_URL is not set. AI features will not work.");
}

// The /message route is unchanged
router.post('/message', tempAuth, async (req, res) => {
    const { message, history, sessionId, systemPrompt, isRagEnabled, llmProvider, llmModelName, enableMultiQuery } = req.body;
    const userId = req.user._id.toString();
    if (!message || typeof message !== 'string' || message.trim() === '') { return res.status(400).json({ message: 'Message text required.' }); }
    if (!sessionId || typeof sessionId !== 'string') { return res.status(400).json({ message: 'Session ID required.' }); }
    if (!Array.isArray(history)) { return res.status(400).json({ message: 'Invalid history format.'}); }
    try {
        const user = await User.findById(userId).select('+geminiApiKey +grokApiKey');
        if (!user) { return res.status(404).json({ message: "User account not found." }); }
        const decryptedGeminiKey = user.geminiApiKey ? decrypt(user.geminiApiKey) : null;
        const decryptedGrokKey = user.grokApiKey ? decrypt(user.grokApiKey) : null;
        const selectedLlmProvider = llmProvider || process.env.DEFAULT_LLM_PROVIDER_NODE || 'gemini';
        if (selectedLlmProvider.startsWith('gemini') && !decryptedGeminiKey) { return res.status(400).json({ message: "Chat Error: User Gemini API key is required but was not provided." }); }
        if (selectedLlmProvider.startsWith('grok') && !decryptedGrokKey) { return res.status(400).json({ message: "Chat Error: User Grok API key is required but was not provided." }); }
        if (!PYTHON_AI_SERVICE_URL) { throw new Error("AI Service communication error."); }
        
        const KNOWLEDGE_CHECK_IDENTIFIER = "You are a Socratic quizmaster";
        const isKnowledgeCheckStart = (systemPrompt && systemPrompt.includes(KNOWLEDGE_CHECK_IDENTIFIER) && (!history || history.length === 0));
        let performRagRequest = isKnowledgeCheckStart ? false : !!isRagEnabled;
        if (isKnowledgeCheckStart) { console.log(`>>> Knowledge Check Start detected. Forcing RAG OFF.`); }

        const pythonPayload = {
            user_id: userId,
            query: message.trim(),
            chat_history: history,
            llm_provider: selectedLlmProvider,
            llm_model_name: llmModelName || null,
            system_prompt: systemPrompt,
            perform_rag: performRagRequest,
            enable_multi_query: enableMultiQuery === undefined ? true : !!enableMultiQuery,
            api_keys: { gemini: decryptedGeminiKey, grok: decryptedGrokKey }
        };
        const pythonResponse = await axios.post(`${PYTHON_AI_SERVICE_URL}/generate_chat_response`, pythonPayload, { timeout: 120000 });
        if (!pythonResponse.data || pythonResponse.data.status !== 'success') { throw new Error(pythonResponse.data?.error || "Failed to get valid response from AI service."); }
        const { llm_response: aiReplyText, references: retrievedReferences, thinking_content: thinkingContent } = pythonResponse.data;
        const modelResponseMessage = { role: 'model', parts: [{ text: aiReplyText || "[No response text from AI]" }], timestamp: new Date(), references: retrievedReferences || [], thinking: thinkingContent || null };
        res.status(200).json({ reply: modelResponseMessage });
    } catch (error) {
        console.error(`!!! Error in /message route for session ${sessionId}:`, error.response?.data || error.message || error);
        res.status(error.response?.status || 500).json({ message: error.response?.data?.error || error.message || "Failed to get response." });
    }
});

// The /history route is unchanged
router.post('/history', tempAuth, async (req, res) => {
    const { sessionId, messages } = req.body;
    const userId = req.user._id;
    if (!sessionId) return res.status(400).json({ message: 'Session ID required.' });
    if (!Array.isArray(messages)) return res.status(400).json({ message: 'Invalid messages format.' });
    try {
        const validMessages = messages.map(m => ({ role: m.role, parts: m.parts, timestamp: m.timestamp, references: m.role === 'model' ? (m.references || []) : undefined, thinking: m.role === 'model' ? (m.thinking || null) : undefined, })).filter(m => m && m.role && m.parts && m.parts[0]?.text && m.timestamp );
        const newSessionId = uuidv4();
        if (validMessages.length === 0) { return res.status(200).json({ message: 'No history to save.', savedSessionId: null, newSessionId: newSessionId }); }
        const savedHistory = await ChatHistory.findOneAndUpdate( { sessionId: sessionId, userId: userId }, { $set: { userId: userId, sessionId: sessionId, messages: validMessages, updatedAt: Date.now() } }, { new: true, upsert: true, setDefaultsOnInsert: true } );
        res.status(200).json({ message: 'Chat history saved.', savedSessionId: savedHistory.sessionId, newSessionId: newSessionId });
    } catch (error) {
        console.error(`Error saving chat history for session ${sessionId}:`, error);
        res.status(500).json({ message: 'Failed to save chat history.' });
    }
});

// The /sessions GET route is unchanged
router.get('/sessions', tempAuth, async (req, res) => {
    const userId = req.user._id;
    try {
        const sessions = await ChatHistory.find({ userId: userId }).sort({ updatedAt: -1 }).select('sessionId createdAt updatedAt messages').lean();
        const sessionSummaries = sessions.map(session => { const firstUserMessage = session.messages?.find(m => m.role === 'user'); let preview = firstUserMessage?.parts?.[0]?.text.substring(0, 75) || 'Chat Session'; if (preview.length === 75) preview += '...'; return { sessionId: session.sessionId, createdAt: session.createdAt, updatedAt: session.updatedAt, messageCount: session.messages?.length || 0, preview: preview }; });
        res.status(200).json(sessionSummaries);
    } catch (error) {
        console.error(`Error fetching sessions for user ${userId}:`, error);
        res.status(500).json({ message: 'Failed to retrieve sessions.' });
    }
});

// The /session/:sessionId GET route is unchanged
router.get('/session/:sessionId', tempAuth, async (req, res) => {
    const userId = req.user._id;
    const { sessionId } = req.params;
    if (!sessionId) return res.status(400).json({ message: 'Session ID is required.' });
    try {
        const session = await ChatHistory.findOne({ sessionId: sessionId, userId: userId }).lean();
        if (!session) return res.status(404).json({ message: 'Chat session not found or access denied.' });
        res.status(200).json(session);
    } catch (error) {
        console.error(`Error fetching session ${sessionId} for user ${userId}:`, error);
        res.status(500).json({ message: 'Failed to retrieve session.' });
    }
});

// ==================================================================
//  START OF THE DEFINITIVE FIX: Add the missing DELETE route
// ==================================================================
router.delete('/session/:sessionId', tempAuth, async (req, res) => {
    const userId = req.user._id;
    const { sessionId } = req.params;

    if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required to delete.' });
    }

    try {
        console.log(`>>> DELETE /api/chat/session/${sessionId} requested by User ${userId}`);
        
        // Find and delete the chat history document that matches BOTH the session ID
        // and the authenticated user's ID. This is a crucial security check.
        const result = await ChatHistory.findOneAndDelete({ 
            sessionId: sessionId, 
            userId: userId 
        });

        if (!result) {
            // This can happen if the user tries to delete a session that doesn't exist
            // or doesn't belong to them.
            console.warn(`   Session not found or user mismatch for session ${sessionId} and user ${userId}.`);
            return res.status(404).json({ message: 'Session not found or you do not have permission to delete it.' });
        }

        console.log(`<<< Session ${sessionId} successfully deleted for user ${userId}.`);
        res.status(200).json({ message: 'Session deleted successfully.' });

    } catch (error) {
        console.error(`!!! Error deleting session ${sessionId} for user ${userId}:`, error);
        res.status(500).json({ message: 'Failed to delete session due to a server error.' });
    }
});
// ==================================================================
//  END OF THE DEFINITIVE FIX
// ==================================================================

module.exports = router;