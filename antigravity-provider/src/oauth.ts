import { Router, Request, Response } from 'express';
import axios from 'axios';
import { db } from './db';

export const oauthRouter = Router();

/**
 * Route to start the OAuth flow.
 * Redirects the user to Google's consent screen.
 */
oauthRouter.get('/login', (req: Request, res: Response) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    
    if (!clientId || !redirectUri) {
        return res.status(500).send('OAuth configuration is missing (CLIENT_ID or REDIRECT_URI).');
    }

    const scopes = [
        "openid",
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/cclog",
        "https://www.googleapis.com/auth/experimentsandconfigs"
    ].join(" ");

    // Generate a random state for CSRF protection
    const state = Math.random().toString(36).substring(7);

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', scopes);
    authUrl.searchParams.append('access_type', 'offline');
    authUrl.searchParams.append('prompt', 'consent');
    authUrl.searchParams.append('state', state);

    res.redirect(authUrl.toString());
});

/**
 * OAuth callback route.
 * Handles the redirect from Google, extracts the code, and exchanges it for tokens.
 */
oauthRouter.get('/callback', async (req: Request, res: Response) => {
    const { code, state, error } = req.query;

    if (error) {
        return res.status(400).send(`OAuth Error: ${error}`);
    }

    if (!code) {
        return res.status(400).send('No authorization code returned.');
    }

    try {
        // Exchange code for tokens
        const response = await axios.post('https://oauth2.googleapis.com/token', null, {
            params: {
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                code: code as string,
                redirect_uri: process.env.GOOGLE_REDIRECT_URI,
                grant_type: 'authorization_code'
            }
        });

        const { access_token, refresh_token, expires_in, id_token } = response.data;
        
        if (!refresh_token) {
            console.warn('[OAuth] No refresh_token received. The app may have been authorized previously without offline access.');
        }

        // Get user email from Google UserInfo
        const userInfoRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        const email = userInfoRes.data.email;

        const expiresAt = Date.now() + (expires_in * 1000);

        // Save to DB
        db.saveAccount({
            id: email,
            access_token,
            refresh_token: refresh_token || '', // if missing, manual re-auth required eventually
            expires_at: expiresAt
        });

        res.send(`
            <h2>Authorization Successful!</h2>
            <p>Account <b>${email}</b> has been successfully added to the proxy pool.</p>
            <p>You can now close this window.</p>
        `);
    } catch (err: any) {
        console.error('[OAuth] Token exchange failed:', err.response?.data || err.message);
        res.status(500).send('Failed to exchange authorization code for tokens.');
    }
});
