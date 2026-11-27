CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE, phone VARCHAR(20) NOT NULL,
  password_hash TEXT NOT NULL, city VARCHAR(100) NOT NULL, state VARCHAR(100) NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS donor_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  blood_group VARCHAR(3) NOT NULL CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  age SMALLINT NOT NULL CHECK (age BETWEEN 18 AND 100), gender VARCHAR(30), city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL, last_donation_date DATE, is_available BOOLEAN NOT NULL DEFAULT true,
  contact_preference VARCHAR(20) NOT NULL DEFAULT 'enquiry' CHECK (contact_preference IN ('enquiry','phone','hidden')),
  is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS donors_search_idx ON donor_profiles(blood_group, state, city) WHERE is_active AND is_available;
CREATE TABLE IF NOT EXISTS blood_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_name VARCHAR(120) NOT NULL, blood_group VARCHAR(3) NOT NULL CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  units_required SMALLINT NOT NULL CHECK (units_required BETWEEN 1 AND 100), hospital_name VARCHAR(180) NOT NULL,
  city VARCHAR(100) NOT NULL, state VARCHAR(100) NOT NULL, required_date DATE NOT NULL,
  contact_number VARCHAR(20) NOT NULL, urgency VARCHAR(12) NOT NULL CHECK (urgency IN ('normal','urgent','critical')),
  description TEXT NOT NULL DEFAULT '', status VARCHAR(15) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','fulfilled','cancelled','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_location_idx ON blood_requests(state, city, status);
CREATE TABLE IF NOT EXISTS donation_enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL REFERENCES blood_requests(id) ON DELETE CASCADE,
  donor_id UUID NOT NULL REFERENCES donor_profiles(id) ON DELETE CASCADE, requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '', status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(request_id, donor_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL, is_read BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), reported_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES blood_requests(id) ON DELETE CASCADE, reason TEXT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
