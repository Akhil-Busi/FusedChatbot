// server/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getLocalIPs } = require('./utils/networkUtils');
const fs = require('fs');
const axios = require('axios');
const os = require('os');
const mongoose = require('mongoose');
require('dotenv').config();
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
});

const connectDB = require('./config/db');
const { performAssetCleanup } = require('./utils/assetCleanup');
const analysisRoutes = require('./routes/analysis');

// --- START OF MODIFICATION ---
// Import the new history routes
const historyRoutes = require('./routes/history');
// --- END OF MODIFICATION ---

const DEFAULT_PORT = 5000;
const DEFAULT_MONGO_URI = 'mongodb://localhost:27017/chatbotGeminiDB';
const DEFAULT_PYTHON_SERVICE_URL = 'http://localhost:5001';

let port = process.env.PORT || DEFAULT_PORT;
let mongoUri = process.env.MONGO_URI || '';
let pythonServiceUrl = process.env.PYTHON_AI_CORE_SERVICE_URL || '';
let geminiApiKey = process.env.GEMINI_API_KEY || '';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('Chatbot Backend API is running...'));

app.use('/api/network', require('./routes/network'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/files', require('./routes/files'));
app.use('/api/syllabus', require('./routes/syllabus'));
app.use('/api/analysis', analysisRoutes);
// --- START OF MODIFICATION ---
// Mount the new history routes
app.use('/api/history', historyRoutes);
// --- END OF MODIFICATION ---

app.use((err, req, res, next) => {
    console.error("Unhandled Error:", err.stack || err);
    const statusCode = err.status || 500;
    let message = err.message || 'An internal server error occurred.';
    if (process.env.NODE_ENV === 'production' && statusCode === 500) {
        message = 'An internal server error occurred.';
    }
    if (req.originalUrl.startsWith('/api/')) {
         return res.status(statusCode).json({ message: message });
    }
    res.status(statusCode).send(message);
});

let server;

const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    readline.close();
    try {
        if (server) {
            server.close(async () => {
                console.log('HTTP server closed.');
                try {
                    await mongoose.connection.close();
                    console.log('MongoDB connection closed.');
                } catch (dbCloseError) {
                    console.error("Error closing MongoDB connection:", dbCloseError);
                }
                process.exit(0);
            });
        } else {
             try {
                 await mongoose.connection.close();
                 console.log('MongoDB connection closed.');
             } catch (dbCloseError) {
                 console.error("Error closing MongoDB connection:", dbCloseError);
             }
            process.exit(0);
        }
        setTimeout(() => {
            console.error('Graceful shutdown timed out, forcing exit.');
            process.exit(1);
        }, 10000);
    } catch (shutdownError) {
        console.error("Error during graceful shutdown initiation:", shutdownError);
        process.exit(1);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

async function checkPythonService(url) {
    console.log(`\nChecking Python AI Core service health at ${url}...`);
    try {
        const response = await axios.get(`${url}/health`, { timeout: 7000 });
        if (response.status === 200 && response.data?.status === 'ok') {
            console.log('✓ Python AI Core service is available and healthy.');
            if(response.data.embedding_model_type) console.log(`  Embedding: ${response.data.embedding_model_type} (${response.data.embedding_model_name || 'N/A'})`);
            if(response.data.default_index_loaded !== undefined) console.log(`  Default Index Loaded: ${response.data.default_index_loaded}`);
            if (response.data.message && response.data.message.includes("Warning:")) {
                 console.warn(`  Python Service Health Warning: ${response.data.message}`);
            }
            return true;
        } else {
             console.warn(`! Python AI Core service responded but status is not OK: ${response.status} - ${JSON.stringify(response.data)}`);
             return false;
        }
    } catch (error) {
        console.warn('! Python AI Core service is not reachable.');
        if (error.code === 'ECONNREFUSED') {
             console.warn(`  Connection refused at ${url}. Ensure the Python AI Core service (ai_core_service/app.py) is running.`);
        } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
             console.warn(`  Connection timed out to ${url}. The Python service might be slow to start or unresponsive.`);
        } else {
             console.warn(`  Error: ${error.message}`);
        }
        console.warn('  Features dependent on this service (e.g., RAG, document analysis) may be unavailable or impaired.');
        return false;
    }
}

async function ensureServerDirectories() {
    const dirs = [
        path.join(__dirname, 'assets'),
        path.join(__dirname, 'backup_assets'),
    ];
    console.log("\nEnsuring server directories exist...");
    try {
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                await fs.promises.mkdir(dir, { recursive: true });
                console.log(`  Created directory: ${dir}`);
            }
        }
        console.log("✓ Server directories checked/created.");
    } catch (error) {
        console.error('!!! Error creating essential server directories:', error);
        throw error;
    }
}

function askQuestion(query) {
    return new Promise(resolve => readline.question(query, resolve));
}

async function configureAndStart() {
    console.log("--- Starting Server Configuration ---");
    if (!geminiApiKey) {
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.error("!!! FATAL: GEMINI_API_KEY environment variable is not set. !!!");
        console.error("!!! Please set it in your .env file.                     !!!");
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        process.exit(1);
    } else {
        console.log("✓ GEMINI_API_KEY found (from .env).");
    }
    if (!mongoUri) {
        const answer = await askQuestion(`Enter MongoDB URI or press Enter for default (${DEFAULT_MONGO_URI}): `);
        mongoUri = answer.trim() || DEFAULT_MONGO_URI;
    }
    console.log(`Using MongoDB URI: ${mongoUri}`);
    if (!pythonServiceUrl) {
        const answer = await askQuestion(`Enter Python AI Core Service URL or press Enter for default (${DEFAULT_PYTHON_SERVICE_URL}): `);
        pythonServiceUrl = answer.trim() || DEFAULT_PYTHON_SERVICE_URL;
    }
    console.log(`Using Python AI Core Service URL: ${pythonServiceUrl}`);
    console.log(`Node.js server will attempt to listen on port: ${port} (from .env or default)`);
    readline.close();
    process.env.MONGO_URI = mongoUri;
    process.env.PYTHON_AI_CORE_SERVICE_URL = pythonServiceUrl;
    console.log("--- Configuration Complete ---");
    await startServer();
}

async function startServer() {
    console.log("\n--- Starting Server Initialization ---");
    try {
        await ensureServerDirectories();
        await connectDB(mongoUri);
        await performAssetCleanup();
        await checkPythonService(pythonServiceUrl);
        const PORT = parseInt(port, 10);
        server = app.listen(PORT, '0.0.0.0', () => {
            const nodeEnv = process.env.NODE_ENV || 'development';
            console.log(`\n=== Node.js Server Ready ===`);
            console.log(`🚀 Node.js Server running on port ${PORT} in ${nodeEnv} mode.`);
            const availableIPs = getLocalIPs();
            const networkIP = availableIPs.length > 0 ? availableIPs[0] : 'your-network-ip';
            console.log(`   Accessible at http://localhost:${PORT}`);
            if (networkIP !== 'your-network-ip' && networkIP !== '127.0.0.1') {
                console.log(`   And externally (on your network) at http://${networkIP}:${PORT}`);
            }
            console.log('============================\n');
        });
    } catch (error) {
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.error("!!! Failed to start Node.js server:", error.message);
        if (error.code === 'EADDRINUSE') {
            console.error(`!!! Port ${port} is already in use. ` +
                          `Please check if another application is using this port, ` +
                          `or change the PORT in your .env file to an available port.`);
        }
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        process.exit(1);
    }
}
configureAndStart();