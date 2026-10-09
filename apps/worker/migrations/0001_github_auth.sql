PRAGMA foreign_keys = ON;
CREATE TABLE users (id INTEGER PRIMARY KEY, login TEXT NOT NULL, name TEXT, avatar_url TEXT NOT NULL, html_url TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE github_credentials (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, access_token TEXT NOT NULL, refresh_token TEXT, expires_at INTEGER, refresh_expires_at INTEGER, version INTEGER NOT NULL DEFAULT 1, refresh_lock_until INTEGER);
CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE oauth_transactions (state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, verifier_ciphertext TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX oauth_expiry ON oauth_transactions(expires_at);
CREATE TABLE repository_selections (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, repository_id INTEGER NOT NULL, selected_at INTEGER NOT NULL, PRIMARY KEY (user_id, repository_id));
