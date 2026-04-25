-- ================================================================
-- VAANISETU - SUPABASE POSTGRESQL SCHEMA
-- ================================================================

-- USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  room_code TEXT UNIQUE,
  room_name TEXT DEFAULT 'My Room',
  active_subscription TEXT DEFAULT '',
  subscription_expiry BIGINT DEFAULT 0,
  subscription_type TEXT DEFAULT '',
  plan TEXT DEFAULT '',
  is_premium BOOLEAN DEFAULT FALSE,
  has_paid BOOLEAN DEFAULT FALSE,
  coins INTEGER DEFAULT 0,
  xp INTEGER DEFAULT 0,
  total_watch_time INTEGER DEFAULT 0,
  friends TEXT[] DEFAULT '{}',
  friend_requests TEXT[] DEFAULT '{}',
  referral_code TEXT,
  referred_by TEXT,
  referral_count INTEGER DEFAULT 0,
  room_host_access_type TEXT DEFAULT 'generic',
  room_film_ad_enabled BOOLEAN DEFAULT TRUE,
  push_subscription JSONB,
  free_day_used BOOLEAN DEFAULT FALSE,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- FILMS TABLE
CREATE TABLE IF NOT EXISTS films (
  film_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  thumbnail_base64 TEXT DEFAULT '',
  telegram_link TEXT DEFAULT '',
  trailer_link TEXT DEFAULT '',
  price INTEGER DEFAULT 20,
  rental_days INTEGER DEFAULT 3,
  ad_unlock_enabled BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  early_access_until BIGINT DEFAULT 0,
  avg_rating DECIMAL(3,2) DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- RENTALS TABLE
CREATE TABLE IF NOT EXISTS rentals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(uid),
  film_id TEXT NOT NULL,
  film_title TEXT NOT NULL,
  telegram_link TEXT DEFAULT '',
  thumbnail_base64 TEXT DEFAULT '',
  expires_at BIGINT NOT NULL,
  is_expired BOOLEAN DEFAULT FALSE,
  rental_days INTEGER DEFAULT 3,
  payment_id TEXT,
  order_id TEXT,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);
CREATE INDEX IF NOT EXISTS idx_rentals_user ON rentals(user_id);

-- AD FILM UNLOCKS TABLE
CREATE TABLE IF NOT EXISTS ad_film_unlocks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(uid),
  film_id TEXT NOT NULL,
  film_title TEXT NOT NULL,
  telegram_link TEXT DEFAULT '',
  expires_at BIGINT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);
CREATE INDEX IF NOT EXISTS idx_ad_unlocks_user ON ad_film_unlocks(user_id);

-- AD PASSES TABLE
CREATE TABLE IF NOT EXISTS ad_passes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(uid),
  valid_until BIGINT NOT NULL,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- AD TOKENS TABLE
CREATE TABLE IF NOT EXISTS ad_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  film_id TEXT,
  film_title TEXT,
  telegram_link TEXT,
  expires_at BIGINT NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- FILM RATINGS TABLE
CREATE TABLE IF NOT EXISTS film_ratings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(uid),
  film_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  UNIQUE(user_id, film_id)
);

-- WATCH HISTORY TABLE
CREATE TABLE IF NOT EXISTS watch_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id TEXT NOT NULL REFERENCES users(uid),
  film_id TEXT,
  film_title TEXT NOT NULL,
  thumbnail_base64 TEXT DEFAULT '',
  watched_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);
CREATE INDEX IF NOT EXISTS idx_watch_history_user ON watch_history(user_id);

-- CONTACT MESSAGES TABLE
CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id TEXT,
  user_email TEXT,
  user_name TEXT,
  message TEXT NOT NULL,
  has_screenshot BOOLEAN DEFAULT FALSE,
  screenshot_url TEXT,
  read BOOLEAN DEFAULT FALSE,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  order_id TEXT,
  payment_id TEXT,
  signature TEXT,
  amount INTEGER,
  currency TEXT DEFAULT 'INR',
  plan TEXT,
  status TEXT DEFAULT 'pending',
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- PUSH SUBSCRIPTIONS TABLE
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id TEXT NOT NULL REFERENCES users(uid),
  endpoint TEXT UNIQUE NOT NULL,
  keys JSONB NOT NULL,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- REFERRAL CLAIMS TABLE
CREATE TABLE IF NOT EXISTS referral_claims (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  referrer_id TEXT NOT NULL,
  new_user_id TEXT NOT NULL,
  claimed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  UNIQUE(new_user_id)
);

-- ACCESS CODES TABLE
CREATE TABLE IF NOT EXISTS access_codes (
  code TEXT PRIMARY KEY,
  valid_until BIGINT,
  plan TEXT DEFAULT 'monthly',
  used_by TEXT,
  used_at BIGINT,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- CONFIG TABLE
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);
INSERT INTO config (key, value) VALUES ('free_day_enabled', 'false') ON CONFLICT DO NOTHING;

-- PAGE VIEWS TABLE
CREATE TABLE IF NOT EXISTS page_views (
  id TEXT PRIMARY KEY DEFAULT 'global',
  count BIGINT DEFAULT 0,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);
INSERT INTO page_views (id, count) VALUES ('global', 0) ON CONFLICT DO NOTHING;

-- VISITORS TABLE
CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  visitor_id TEXT UNIQUE NOT NULL,
  first_seen BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  last_seen BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- FREE PASS CLAIMS TABLE
CREATE TABLE IF NOT EXISTS free_pass_claims (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id TEXT UNIQUE NOT NULL REFERENCES users(uid),
  claimed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);
