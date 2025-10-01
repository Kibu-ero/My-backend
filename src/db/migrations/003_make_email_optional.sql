-- Migration: Make email optional in user tables
-- This migration removes the NOT NULL constraint from email columns

-- Make email optional in customer_accounts
ALTER TABLE public.customer_accounts 
ALTER COLUMN email DROP NOT NULL;

-- Make email optional in employees
ALTER TABLE public.employees 
ALTER COLUMN email DROP NOT NULL;

-- Make email optional in users
ALTER TABLE public.users 
ALTER COLUMN email DROP NOT NULL;

-- Note: We keep the UNIQUE constraints but allow NULL values
-- PostgreSQL allows multiple NULL values in a UNIQUE column
