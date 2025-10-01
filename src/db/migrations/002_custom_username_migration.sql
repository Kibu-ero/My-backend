-- CUSTOM Migration for your specific database structure
-- This migration adds username fields to your exact tables

-- ============================================
-- STEP 1: ADD USERNAME COLUMNS (SAFE)
-- ============================================

-- Add username column to customer_accounts table
ALTER TABLE public.customer_accounts 
ADD COLUMN IF NOT EXISTS username VARCHAR(50);

-- Add username column to employees table  
ALTER TABLE public.employees 
ADD COLUMN IF NOT EXISTS username VARCHAR(50);

-- Add username column to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS username VARCHAR(50);

-- ============================================
-- STEP 2: VERIFY COLUMNS ADDED (CHECK THIS)
-- ============================================
-- Run this to confirm columns were added:
/*
SELECT table_name, column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name IN ('customer_accounts', 'employees', 'users') 
AND column_name = 'username'
ORDER BY table_name;
*/

-- ============================================
-- STEP 3: GENERATE USERNAMES FROM EMAILS (SAFE)
-- ============================================

-- For customer_accounts: use email prefix as username
UPDATE public.customer_accounts 
SET username = SPLIT_PART(email, '@', 1)
WHERE username IS NULL AND email IS NOT NULL;

-- For employees: use email prefix as username  
UPDATE public.employees 
SET username = SPLIT_PART(email, '@', 1)
WHERE username IS NULL AND email IS NOT NULL;

-- For users: use email prefix as username
UPDATE public.users 
SET username = SPLIT_PART(email, '@', 1)
WHERE username IS NULL AND email IS NOT NULL;

-- ============================================
-- STEP 4: CHECK FOR DUPLICATES (VERIFY THIS)
-- ============================================
-- Run this to see if there are any duplicate usernames:
/*
SELECT 'customer_accounts duplicates:' as info;
SELECT username, COUNT(*) as count 
FROM public.customer_accounts 
WHERE username IS NOT NULL 
GROUP BY username 
HAVING COUNT(*) > 1;

SELECT 'employees duplicates:' as info;
SELECT username, COUNT(*) as count 
FROM public.employees 
WHERE username IS NOT NULL 
GROUP BY username 
HAVING COUNT(*) > 1;

SELECT 'users duplicates:' as info;
SELECT username, COUNT(*) as count 
FROM public.users 
WHERE username IS NOT NULL 
GROUP BY username 
HAVING COUNT(*) > 1;
*/

-- ============================================
-- STEP 5: HANDLE DUPLICATE USERNAMES (IF NEEDED)
-- ============================================

-- Handle duplicate usernames in customer_accounts
WITH numbered_users AS (
  SELECT id, username,
         ROW_NUMBER() OVER (PARTITION BY username ORDER BY id) as rn
  FROM public.customer_accounts
  WHERE username IS NOT NULL
)
UPDATE public.customer_accounts 
SET username = CASE 
  WHEN nu.rn > 1 THEN nu.username || '_' || nu.rn::text
  ELSE nu.username
END
FROM numbered_users nu
WHERE public.customer_accounts.id = nu.id AND nu.rn > 1;

-- Handle duplicate usernames in employees
WITH numbered_users AS (
  SELECT id, username,
         ROW_NUMBER() OVER (PARTITION BY username ORDER BY id) as rn
  FROM public.employees
  WHERE username IS NOT NULL
)
UPDATE public.employees 
SET username = CASE 
  WHEN nu.rn > 1 THEN nu.username || '_' || nu.rn::text
  ELSE nu.username
END
FROM numbered_users nu
WHERE public.employees.id = nu.id AND nu.rn > 1;

-- Handle duplicate usernames in users
WITH numbered_users AS (
  SELECT id, username,
         ROW_NUMBER() OVER (PARTITION BY username ORDER BY id) as rn
  FROM public.users
  WHERE username IS NOT NULL
)
UPDATE public.users 
SET username = CASE 
  WHEN nu.rn > 1 THEN nu.username || '_' || nu.rn::text
  ELSE nu.username
END
FROM numbered_users nu
WHERE public.users.id = nu.id AND nu.rn > 1;

-- ============================================
-- STEP 6: VERIFY NO DUPLICATES REMAIN (CHECK THIS)
-- ============================================
-- Run this to confirm no duplicates remain:
/*
SELECT 'Final check - any remaining duplicates?' as info;
SELECT username, COUNT(*) as count 
FROM public.customer_accounts 
WHERE username IS NOT NULL 
GROUP BY username 
HAVING COUNT(*) > 1
UNION ALL
SELECT username, COUNT(*) 
FROM public.employees 
WHERE username IS NOT NULL 
GROUP BY username 
HAVING COUNT(*) > 1
UNION ALL
SELECT username, COUNT(*) 
FROM public.users 
WHERE username IS NOT NULL 
GROUP BY username 
HAVING COUNT(*) > 1;
*/

-- ============================================
-- STEP 7: ADD CONSTRAINTS (FINAL STEP)
-- ============================================

-- Make usernames NOT NULL
ALTER TABLE public.customer_accounts 
ALTER COLUMN username SET NOT NULL;

ALTER TABLE public.employees 
ALTER COLUMN username SET NOT NULL;

ALTER TABLE public.users 
ALTER COLUMN username SET NOT NULL;

-- Add UNIQUE constraints
ALTER TABLE public.customer_accounts 
ADD CONSTRAINT customer_accounts_username_key UNIQUE (username);

ALTER TABLE public.employees 
ADD CONSTRAINT employees_username_key UNIQUE (username);

ALTER TABLE public.users 
ADD CONSTRAINT users_username_key UNIQUE (username);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_customer_accounts_username ON public.customer_accounts(username);
CREATE INDEX IF NOT EXISTS idx_employees_username ON public.employees(username);
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);

-- ============================================
-- STEP 8: FINAL VERIFICATION (CHECK RESULTS)
-- ============================================
-- Run this to see the final result:
/*
SELECT 'Migration Complete! Sample results:' as info;
SELECT 'Customer Accounts:' as table_name;
SELECT id, email, username, first_name, last_name FROM public.customer_accounts LIMIT 5;
SELECT 'Employees:' as table_name;
SELECT id, email, username, first_name, last_name FROM public.employees LIMIT 5;
SELECT 'Users:' as table_name;
SELECT id, email, username, name FROM public.users LIMIT 5;
*/
