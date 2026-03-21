-- Rate limit OTP verify attempts (prevent brute force on 6-digit codes)
CREATE TABLE IF NOT EXISTS otp_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  attempted_at INTEGER NOT NULL,
  succeeded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_otp_attempts_email ON otp_attempts(email, attempted_at);
