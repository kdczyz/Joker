import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { oauthRouter } from './oauth';
import { proxyRouter } from './proxy';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health Check
app.get('/health', (req, res) => {
    res.send({ status: 'ok', time: new Date().toISOString() });
});

// Admin OAuth Routes
// Used by admins to link new Antigravity/Google accounts to the pool
app.use('/oauth', oauthRouter);

// OpenAI Proxy Gateway
// Set your AI client base URL to http://localhost:3000/v1
app.use('/v1', proxyRouter);

app.listen(PORT, () => {
    console.log(`[Server] Antigravity Provider Gateway is running on http://localhost:${PORT}`);
    console.log(`[Server] To authorize an account, visit http://localhost:${PORT}/oauth/login`);
});
