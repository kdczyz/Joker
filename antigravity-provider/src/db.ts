import fs from 'fs';
import path from 'path';

export interface Account {
    id: string; // usually email
    access_token: string;
    refresh_token: string;
    expires_at: number; // timestamp in milliseconds
}

export interface DbSchema {
    accounts: Account[];
}

export class Database {
    private dbPath: string;
    private data: DbSchema;

    constructor(dbPath: string = process.env.DB_PATH || './db.json') {
        this.dbPath = path.resolve(dbPath);
        this.data = { accounts: [] };
        this.load();
    }

    private load() {
        if (fs.existsSync(this.dbPath)) {
            try {
                const fileContent = fs.readFileSync(this.dbPath, 'utf8');
                this.data = JSON.parse(fileContent);
                console.log(`[DB] Loaded ${this.data.accounts.length} accounts.`);
            } catch (err) {
                console.error('[DB] Failed to load db file, starting fresh.', err);
            }
        }
    }

    public save() {
        try {
            fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
        } catch (err) {
            console.error('[DB] Failed to save to db file.', err);
        }
    }

    public getAccounts(): Account[] {
        return this.data.accounts;
    }

    public getAccount(id: string): Account | undefined {
        return this.data.accounts.find(a => a.id === id);
    }

    public saveAccount(account: Account) {
        const index = this.data.accounts.findIndex(a => a.id === account.id);
        if (index >= 0) {
            this.data.accounts[index] = account;
        } else {
            this.data.accounts.push(account);
        }
        this.save();
    }

    public updateToken(id: string, access_token: string, expires_at: number, refresh_token?: string) {
        const account = this.getAccount(id);
        if (account) {
            account.access_token = access_token;
            account.expires_at = expires_at;
            if (refresh_token) {
                account.refresh_token = refresh_token;
            }
            this.save();
        }
    }
}

export const db = new Database();
