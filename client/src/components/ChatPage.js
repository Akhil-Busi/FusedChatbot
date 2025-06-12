// client/src/components/ChatPage.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition'; // <-- Import Speech Recognition
import { sendMessage, saveChatHistory, getUserFiles } from '../services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { v4 as uuidv4 } from 'uuid';
import { LLM_OPTIONS } from '../config/constants';
import { FiMessageSquare, FiDatabase, FiSettings, FiLogOut, FiSun, FiMoon, FiSend, FiPlus, FiArchive } from 'react-icons/fi';

import { useTheme } from '../context/ThemeContext';
import SystemPromptWidget, { availablePrompts, getPromptTextById } from './SystemPromptWidget';
import HistoryModal from './HistoryModal';
import FileUploadWidget from './FileUploadWidget';
import FileManagerWidget from './FileManagerWidget';
import AnalysisResultModal from './AnalysisResultModal';
import VoiceInputButton from './VoiceInputButton'; // <-- Import the new component

import './ChatPage.css';

// UI Sub-Components (ActivityBar, Panels, etc. remain unchanged)
const ActivityBar = ({ activeView, setActiveView }) => ( <div className="activity-bar"> <button className={`activity-button ${activeView === 'ASSISTANT' ? 'active' : ''}`} onClick={() => setActiveView('ASSISTANT')} title="Assistant Settings"> <FiSettings size={24} /> </button> <button className={`activity-button ${activeView === 'DATA' ? 'active' : ''}`} onClick={() => setActiveView('DATA')} title="Data Sources"> <FiDatabase size={24} /> </button> </div> );
const AssistantSettingsPanel = (props) => ( <div className="sidebar-panel"> <h3 className="sidebar-header">Assistant Settings</h3> <SystemPromptWidget selectedPromptId={props.currentSystemPromptId} promptText={props.editableSystemPromptText} onSelectChange={props.handlePromptSelectChange} onTextChange={props.handlePromptTextChange} /> <div className="llm-settings-widget"> <h4>AI Settings</h4> <div className="setting-item"> <label htmlFor="llm-provider-select">Provider:</label> <select id="llm-provider-select" value={props.llmProvider} onChange={props.handleLlmProviderChange} disabled={props.isProcessing}> {Object.keys(LLM_OPTIONS).map(key => ( <option key={key} value={key}>{LLM_OPTIONS[key].name}</option> ))} </select> </div> {LLM_OPTIONS[props.llmProvider] && LLM_OPTIONS[props.llmProvider].models.length > 0 && ( <div className="setting-item"> <label htmlFor="llm-model-select">Model:</label> <select id="llm-model-select" value={props.llmModelName} onChange={props.handleLlmModelChange} disabled={props.isProcessing}> {LLM_OPTIONS[props.llmProvider].models.map(model => <option key={model} value={model}>{model}</option>)} <option value="">Provider Default</option> </select> </div> )} <div className="setting-item rag-toggle-container" title="Enable Multi-Query for RAG"> <label htmlFor="multi-query-toggle">Multi-Query (RAG)</label> <input type="checkbox" id="multi-query-toggle" checked={props.enableMultiQuery} onChange={props.handleMultiQueryToggle} disabled={props.isProcessing || !props.isRagEnabled} /> </div> </div> </div> );
const DataSourcePanel = (props) => ( <div className="sidebar-panel"> <h3 className="sidebar-header">Data Sources</h3> <FileUploadWidget onUploadSuccess={props.triggerFileRefresh} /> <FileManagerWidget refreshTrigger={props.refreshTrigger} onAnalysisComplete={props.onAnalysisComplete} /> </div> );
const Sidebar = ({ activeView, ...props }) => ( <div className="sidebar-area"> {activeView === 'ASSISTANT' && <AssistantSettingsPanel {...props} />} {activeView === 'DATA' && <DataSourcePanel {...props} />} </div> );
const ThemeToggleButton = () => { const { theme, toggleTheme } = useTheme(); return ( <button onClick={toggleTheme} className="header-button theme-toggle-button" title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}> {theme === 'light' ? <FiMoon size={20} /> : <FiSun size={20} />} </button> ); };


// ===================================================================================
//  Main ChatPage Component
// ===================================================================================
const ChatPage = ({ setIsAuthenticated }) => {
    // All existing state hooks...
    const [activeView, setActiveView] = useState('ASSISTANT');
    const [messages, setMessages] = useState([]);
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [sessionId, setSessionId] = useState('');
    const [userId, setUserId] = useState('');
    const [username, setUsername] = useState('');
    const [currentSystemPromptId, setCurrentSystemPromptId] = useState('friendly');
    const [editableSystemPromptText, setEditableSystemPromptText] = useState(() => getPromptTextById('friendly'));
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [fileRefreshTrigger, setFileRefreshTrigger] = useState(0);
    const [hasFiles, setHasFiles] = useState(false);
    const [isRagEnabled, setIsRagEnabled] = useState(false);
    const [llmProvider, setLlmProvider] = useState('groq_llama3');
    const [llmModelName, setLlmModelName] = useState(LLM_OPTIONS['groq_llama3']?.models[0] || '');
    const [enableMultiQuery, setEnableMultiQuery] = useState(true);
    const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
    const [analysisModalData, setAnalysisModalData] = useState(null);
    const messagesEndRef = useRef(null);
    const navigate = useNavigate();

    // --- NEW: Speech Recognition Hooks ---
    const {
        transcript,
        listening,
        resetTranscript,
        browserSupportsSpeechRecognition
    } = useSpeechRecognition();

    // Sync the speech recognition transcript with the input text state
    useEffect(() => {
        setInputText(transcript);
    }, [transcript]);
    
    // All existing handler functions (performLogoutCleanup, handleSendMessage, etc.)...
    const performLogoutCleanup = useCallback(() => { localStorage.clear(); setIsAuthenticated(false); setMessages([]); setSessionId(''); setUsername(''); setUserId(''); setError(''); setHasFiles(false); setIsRagEnabled(false); setAnalysisModalData(null); setIsAnalysisModalOpen(false); requestAnimationFrame(() => { if (window.location.pathname !== '/login') navigate('/login', { replace: true }); }); }, [setIsAuthenticated, navigate]);
    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
    useEffect(() => { const storedSessionId = localStorage.getItem('sessionId') || uuidv4(); const storedUserId = localStorage.getItem('userId'); const storedUsername = localStorage.getItem('username'); if (!storedUserId || !storedUsername) { performLogoutCleanup(); } else { setSessionId(storedSessionId); if (!localStorage.getItem('sessionId')) { localStorage.setItem('sessionId', storedSessionId); } setUserId(storedUserId); setUsername(storedUsername); } }, [performLogoutCleanup]);
    const handlePromptSelectChange = useCallback((newId) => { setCurrentSystemPromptId(newId); setEditableSystemPromptText(getPromptTextById(newId)); setError(prev => (prev && (prev.includes("Session invalid") || prev.includes("Critical Error"))) ? prev : `Assistant mode changed.`); setTimeout(() => { setError(prev => prev === `Assistant mode changed.` ? '' : prev); }, 3000); }, []);
    const saveAndReset = useCallback(async (isLoggingOut = false, onCompleteCallback = null) => { const currentSessionIdToSave = localStorage.getItem('sessionId'); const currentUserIdToSave = localStorage.getItem('userId'); const messagesToSave = messages.map(m => ({ role: m.role, parts: m.parts, timestamp: m.timestamp })); if (!currentSessionIdToSave || !currentUserIdToSave || messagesToSave.length === 0 || isLoading) { if (onCompleteCallback) onCompleteCallback(); return; } setIsLoading(true); setError(prev => (prev && (prev.includes("Session invalid") || prev.includes("Critical Error"))) ? prev : ''); try { const response = await saveChatHistory({ sessionId: currentSessionIdToSave, messages: messagesToSave }); const newSessionIdForStorage = response.data.newSessionId; if (!newSessionIdForStorage) { throw new Error("Backend failed to provide new session ID for storage."); } localStorage.setItem('sessionId', newSessionIdForStorage); setSessionId(newSessionIdForStorage); setMessages([]); if (!isLoggingOut) { handlePromptSelectChange('friendly'); setError(''); } } catch (err) { const failErrorMsg = err.response?.data?.message || err.message || 'Failed to save/reset session.'; setError(`Session Error: ${failErrorMsg}`); if (!isLoggingOut) { const fallbackNewSessionId = uuidv4(); localStorage.setItem('sessionId', fallbackNewSessionId); setSessionId(fallbackNewSessionId); setMessages([]); handlePromptSelectChange('friendly'); } } finally { setIsLoading(false); if (onCompleteCallback) onCompleteCallback(); } }, [messages, isLoading, handlePromptSelectChange]);
    const handleLogout = useCallback((skipSave = false) => { const cleanupAndRedirect = () => performLogoutCleanup(); if (!skipSave && messages.length > 0 && !isLoading) { saveAndReset(true, cleanupAndRedirect); } else { cleanupAndRedirect(); } }, [messages.length, performLogoutCleanup, isLoading, saveAndReset]);
    useEffect(() => { const checkUserFiles = async () => { const currentUserIdFromStorage = localStorage.getItem('userId'); if (!currentUserIdFromStorage) { setHasFiles(false); setIsRagEnabled(false); return; } try { const response = await getUserFiles(); const filesExist = response.data && response.data.length > 0; setHasFiles(filesExist); if (filesExist && messages.length === 0) { setIsRagEnabled(true); } else if (!filesExist) { setIsRagEnabled(false); } } catch (err) { setError(err.response?.data?.message || "Could not check user files."); setHasFiles(false); setIsRagEnabled(false); } }; const currentUserIdFromStorage = localStorage.getItem('userId'); if (currentUserIdFromStorage) checkUserFiles(); }, [userId, fileRefreshTrigger, messages.length]);
    const triggerFileRefresh = useCallback(() => setFileRefreshTrigger(prev => prev + 1), []);
    const handlePromptTextChange = useCallback((newText) => { setEditableSystemPromptText(newText); const matchingPreset = availablePrompts.find(p => p.id !== 'custom' && p.prompt === newText); setCurrentSystemPromptId(matchingPreset ? matchingPreset.id : 'custom'); }, []);
    const handleHistory = useCallback(() => setIsHistoryModalOpen(true), []);
    const closeHistoryModal = useCallback(() => setIsHistoryModalOpen(false), []);
    const handleNewChat = useCallback(() => { if (!isLoading) { resetTranscript(); saveAndReset(false, null); } }, [isLoading, saveAndReset, resetTranscript]);
    const handleSendMessage = useCallback(async (e) => { if (e) e.preventDefault(); const textToSend = inputText.trim(); if (!textToSend || isLoading) return; SpeechRecognition.stopListening(); const newUserMessage = { role: 'user', parts: [{ text: textToSend }], timestamp: new Date().toISOString(), }; setMessages(prev => [...prev, newUserMessage]); setInputText(''); resetTranscript(); setError(''); setIsLoading(true); const historyForBackend = messages.map(m => ({ role: m.role, parts: m.parts, })); const messageData = { message: textToSend, history: historyForBackend, sessionId: localStorage.getItem('sessionId'), systemPrompt: editableSystemPromptText, isRagEnabled, llmProvider, llmModelName: llmModelName || null, enableMultiQuery, }; try { const response = await sendMessage(messageData); const responseData = response.data; if (!responseData || !responseData.reply || !responseData.reply.parts || !responseData.reply.parts[0]) { throw new Error("Received an invalid response from the AI."); } setMessages(prev => [...prev, responseData.reply]); } catch (err) { const errorMessage = err.response?.data?.message || err.message || 'Failed to get response.'; setError(`Chat Error: ${errorMessage}`); setMessages(prev => [...prev, { role: 'model', parts: [{ text: `Error: ${errorMessage}` }], isError: true, timestamp: new Date().toISOString() }]); } finally { setIsLoading(false); } }, [inputText, isLoading, messages, editableSystemPromptText, isRagEnabled, llmProvider, llmModelName, enableMultiQuery, resetTranscript]);
    const handleEnterKey = useCallback((e) => { if (e.key === 'Enter' && !e.shiftKey && !isLoading) { e.preventDefault(); handleSendMessage(null); } }, [handleSendMessage, isLoading]);
    const handleRagToggle = (event) => setIsRagEnabled(event.target.checked);
    const handleMultiQueryToggle = (event) => setEnableMultiQuery(event.target.checked);
    const handleLlmProviderChange = (event) => { const newProvider = event.target.value; setLlmProvider(newProvider); setLlmModelName(LLM_OPTIONS[newProvider]?.models[0] || ''); };
    const handleLlmModelChange = (event) => { setLlmModelName(event.target.value); };
    const handleAnalysisComplete = useCallback((data) => { setAnalysisModalData(data); setIsAnalysisModalOpen(true); }, []);
    const closeAnalysisModal = useCallback(() => { setIsAnalysisModalOpen(false); setAnalysisModalData(null); }, []);

    // --- NEW: Handler for the voice input button ---
    const handleToggleListen = () => {
        if (listening) {
            SpeechRecognition.stopListening();
        } else {
            resetTranscript();
            SpeechRecognition.startListening({ continuous: true });
        }
    };

    const isProcessing = isLoading;
    const sidebarProps = { currentSystemPromptId, editableSystemPromptText, handlePromptSelectChange, handlePromptTextChange, llmProvider, llmModelName, handleLlmProviderChange, handleLlmModelChange, isProcessing, enableMultiQuery, handleMultiQueryToggle, isRagEnabled, triggerFileRefresh, refreshTrigger: fileRefreshTrigger, onAnalysisComplete: handleAnalysisComplete };

    return (
        <div className="main-layout">
            <ActivityBar activeView={activeView} setActiveView={setActiveView} />
            <Sidebar activeView={activeView} {...sidebarProps} />
            <div className="chat-view">
                <header className="chat-header">
                    <h1>FusedChat</h1>
                    <div className="header-controls">
                        <span className="username-display">Hi, {username}</span>
                        <ThemeToggleButton />
                        <button onClick={handleHistory} className="header-button" title="Chat History" disabled={isProcessing}><FiArchive size={20} /></button>
                        <button onClick={handleNewChat} className="header-button" title="New Chat" disabled={isProcessing}><FiPlus size={20} /></button>
                        <button onClick={() => handleLogout(false)} className="header-button" title="Logout" disabled={isProcessing}><FiLogOut size={20} /></button>
                    </div>
                </header>
                <main className="messages-area">
                    {messages.length === 0 && !isLoading && (
                         <div className="welcome-screen">
                            <FiMessageSquare size={48} className="welcome-icon" />
                            <h2>Start a conversation</h2>
                            <p>Ask a question, upload a document, or select a model to begin.</p>
                         </div>
                    )}
                    {messages.map((msg, index) => (
                        <div key={`${sessionId}-${index}-${msg.timestamp || index}`} className={`message ${msg.role.toLowerCase()}${msg.isError ? '-error-message' : ''}`}>
                             <div className="message-content-wrapper">
                                 <p className="message-sender-name">{msg.role === 'user' ? username : 'Assistant'}</p>
                                 <div className="message-text">
                                     <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.parts[0].text}</ReactMarkdown>
                                 </div>
                                {msg.thinking && (<details className="message-thinking-trace"><summary>Thinking Process</summary><pre>{typeof msg.thinking === 'string' ? msg.thinking : JSON.stringify(msg.thinking, null, 2)}</pre></details>)}
                                {msg.references && msg.references.length > 0 && (<div className="message-references"><strong>References:</strong><ul>{msg.references.map((ref, i) => (<li key={i} title={ref.preview_snippet || 'Reference details'}>{ref.documentName || `Source ${i+1}`} (Score: {ref.score?.toFixed(2)})</li>))}</ul></div>)}
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </main>
                {isProcessing && <div className="loading-indicator"><span>Thinking...</span></div>}
                {!isProcessing && error && <div className="error-indicator">{error}</div>}
                <footer className="input-area">
                    {/* MODIFICATION: Input area now has a voice button */}
                    <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={handleEnterKey} placeholder="Type or say something..." rows="1" disabled={isProcessing} />
                    <VoiceInputButton
                        isListening={listening}
                        onToggleListen={handleToggleListen}
                        isSupported={browserSupportsSpeechRecognition}
                    />
                    <div className="rag-toggle-container" title={!hasFiles ? "Upload files to enable RAG" : "Toggle RAG"}>
                        <label htmlFor="rag-toggle">RAG</label>
                        <input type="checkbox" id="rag-toggle" checked={isRagEnabled} onChange={handleRagToggle} disabled={!hasFiles || isProcessing} />
                    </div>
                    <button onClick={() => handleSendMessage(null)} disabled={isProcessing || !inputText.trim()} title="Send Message" className="send-button">
                        <FiSend size={20} />
                    </button>
                </footer>
            </div>
            <HistoryModal isOpen={isHistoryModalOpen} onClose={closeHistoryModal} />
            {analysisModalData && (
                <AnalysisResultModal isOpen={isAnalysisModalOpen} onClose={closeAnalysisModal} analysisData={analysisModalData} />
            )}
        </div>
    );
};

export default ChatPage;