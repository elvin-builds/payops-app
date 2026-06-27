-- PayOps Database Initialization
-- This runs automatically when PostgreSQL container starts for the first time

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(255) UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,
    role        VARCHAR(50) DEFAULT 'user',
    balance     DECIMAL(12,2) DEFAULT 1000.00,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),
    amount          DECIMAL(12,2) NOT NULL,
    recipient       VARCHAR(255) NOT NULL,
    description     TEXT,
    status          VARCHAR(20) DEFAULT 'pending',
    failure_reason  TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),
    transaction_id  UUID REFERENCES transactions(id),
    type            VARCHAR(50) NOT NULL,
    message         TEXT NOT NULL,
    read            BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

-- Seed a test user (password: test123)
-- bcrypt hash of 'test123' with 10 rounds
INSERT INTO users (email, password, role, balance)
VALUES ('test@payops.local', '$2b$10$8dkjWWDOgcqqVk/NpPMbMu609GCSVFtyn3.yprOtkkg8MhRvS7/ne', 'admin', 5000.00)
ON CONFLICT (email) DO NOTHING;
