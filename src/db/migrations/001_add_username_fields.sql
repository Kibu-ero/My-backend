-- Migration: Add username fields to all user tables
-- This migration adds username columns to customer_accounts, employees, and users tables

-- Add username column to customer_accounts table
ALTER TABLE customer_accounts 
ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE;

-- Add username column to employees table  
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE;

-- Add username column to users table (if it exists)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_customer_accounts_username ON customer_accounts(username);
CREATE INDEX IF NOT EXISTS idx_employees_username ON employees(username);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Add constraints to ensure username is not null and unique
ALTER TABLE customer_accounts 
ADD CONSTRAINT IF NOT EXISTS customer_accounts_username_not_null CHECK (username IS NOT NULL);

ALTER TABLE employees 
ADD CONSTRAINT IF NOT EXISTS employees_username_not_null CHECK (username IS NOT NULL);

ALTER TABLE users 
ADD CONSTRAINT IF NOT EXISTS users_username_not_null CHECK (username IS NOT NULL);

-- Optional: Generate usernames from existing email addresses for existing users
-- This is a one-time operation to populate usernames for existing records

-- For customer_accounts: use email prefix as username
UPDATE customer_accounts 
SET username = SPLIT_PART(email, '@', 1)
WHERE username IS NULL AND email IS NOT NULL;

-- For employees: use email prefix as username  
UPDATE employees 
SET username = SPLIT_PART(email, '@', 1)
WHERE username IS NULL AND email IS NOT NULL;

-- For users: use email prefix as username
UPDATE users 
SET username = SPLIT_PART(email, '@', 1)
WHERE username IS NULL AND email IS NOT NULL;

-- Handle duplicate usernames by appending numbers
-- This is a simplified approach - in production you might want more sophisticated handling

-- For customer_accounts
WITH numbered_users AS (
  SELECT id, username,
         ROW_NUMBER() OVER (PARTITION BY username ORDER BY id) as rn
  FROM customer_accounts
  WHERE username IS NOT NULL
)
UPDATE customer_accounts 
SET username = CASE 
  WHEN nu.rn > 1 THEN nu.username || nu.rn::text
  ELSE nu.username
END
FROM numbered_users nu
WHERE customer_accounts.id = nu.id AND nu.rn > 1;

-- For employees
WITH numbered_users AS (
  SELECT id, username,
         ROW_NUMBER() OVER (PARTITION BY username ORDER BY id) as rn
  FROM employees
  WHERE username IS NOT NULL
)
UPDATE employees 
SET username = CASE 
  WHEN nu.rn > 1 THEN nu.username || nu.rn::text
  ELSE nu.username
END
FROM numbered_users nu
WHERE employees.id = nu.id AND nu.rn > 1;

-- For users
WITH numbered_users AS (
  SELECT id, username,
         ROW_NUMBER() OVER (PARTITION BY username ORDER BY id) as rn
  FROM users
  WHERE username IS NOT NULL
)
UPDATE users 
SET username = CASE 
  WHEN nu.rn > 1 THEN nu.username || nu.rn::text
  ELSE nu.username
END
FROM numbered_users nu
WHERE users.id = nu.id AND nu.rn > 1;
