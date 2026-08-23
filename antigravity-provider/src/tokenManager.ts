import axios from 'axios';
import { db, Account } from './db';

const REFRESH_THRESHOLD_MS = 15 * 60 * 1000; // Refresh 15 minutes before expiration

export class TokenManager {
    private currentAccountIndex = 0;

    /**
     * Get an available access token from the pool.
     * Uses a simple round-robin approach for load balancing.
     */
    public async getAvailableToken(): Promise<string> {
        const accounts = db.getAccounts();
        if (accounts.length === 0) {
            throw new Error('No authorized accounts available in the pool.');
        }

        // Round robin
        const account = accounts[this.currentAccountIndex % accounts.length];
        this.currentAccountIndex++;

        const token = await this.ensureFreshToken(account);
        return token;
    }

    /**
     * Checks if a token needs refreshing and refreshes it if necessary.
     */
    private async ensureFreshToken(account: Account): Promise<string> {
        const now = Date.now();
        if (account.expires_at > now + REFRESH_THRESHOLD_MS) {
            // Token is still fresh
            return account.access_token;
        }

        console.log(`[TokenManager] Token for ${account.id} is expiring, refreshing...`);
        try {
            const response = await axios.post('https://oauth2.googleapis.com/token', null, {
                params: {
                    client_id: process.env.GOOGLE_CLIENT_ID,
                    client_secret: process.env.GOOGLE_CLIENT_SECRET,
                    refresh_token: account.refresh_token,
                    grant_type: 'refresh_token'
                }
            });

            const data = response.data;
            const newAccessToken = data.access_token;
            const expiresInMs = data.expires_in * 1000;
            const newExpiresAt = now + expiresInMs;
            
            // Sometimes refresh_token might be returned as well, update if present
            const newRefreshToken = data.refresh_token; 

            db.updateToken(account.id, newAccessToken, newExpiresAt, newRefreshToken);
            console.log(`[TokenManager] Successfully refreshed token for ${account.id}.`);
            
            return newAccessToken;
        } catch (error: any) {
            console.error(`[TokenManager] Failed to refresh token for ${account.id}:`, error.response?.data || error.message);
            throw new Error(`Failed to refresh token for account ${account.id}`);
        }
    }
}

export const tokenManager = new TokenManager();
