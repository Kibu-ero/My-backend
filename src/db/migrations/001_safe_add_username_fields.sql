-- SAFE Migration: Add username fields to all user tables
-- This migration is designed to be safe for existing data

-- Step 1: Add username columns WITHOUT constraints first
-- This allows us to populate data before adding constraints

ALTER TABLE customer_accounts 
ADD COLUMN IF NOT EXISTS username VARCHAR(50);

ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS username VARCHAR(50);

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS username VARCHAR(50);

-- Step 2: Check what we're working with
-- Run this to see your current data before proceeding:
/*
SELECT 'customer_accounts' as table_name, COUNT(*) as count FROM customer_accounts
UNION ALL
SELECT 'employees', COUNT(*) FROM employees
UNION ALL
SELECT 'users', COUNT(*) FROM users;

SELECT 'Sample emails:' as info;
SELECT email FROM customer_accounts LIMIT 3;
SELECT email FROM employees LIMIT 3;
SELECT email FROM users LIMIT 3;
*/

-- Step 3: Generate usernames from existing emails
-- This is safe because we're only setting NULL values

UPDATE customer_accounts 
SET username = SPLIT_PART(email, '@', 1)
WHERE username IS NULL AND email IS NOT NULL;

UPDATE employees 
SET username = SPLIT_PART(email, '@', 1)
WHERE username IS NULL AND email IS NOT NULL;

UPDATE users 
SET username = SPLIT_PART(email, '@', 1)
WHERE username IS NULL AND email IS NOT NULL;

-- Step 4: Check for duplicates before handling them
-- Run this to see if there are any duplicate usernames:
/*
SELECT username, COUNT(*) as count 
FROM customer_accounts 
WHERE username IS NOT NULL 
GROUP BY username 
HAVING COUNT(*) > 1;

SELECT username, COUNT(*) as count 
FROM employees 
WHERE username IS NOT NULL 
GROUP BY username 
HAVING COUNT(*) > 1;

SELECT username, COUNT(*) as count 
FROM users 
WHERE username IS NOT NULL 
GROUP BY username 
HAVING COUNT(*) > 1;
*/

-- Step 5: Handle duplicate usernames by adding numbers
-- This is safe because it only affects duplicate usernames

-- For customer_accounts
WITH numbered_users AS (
  SELECT id, username,
         ROW_NUMBER() OVER (PARTITION BY username ORDER BY id) as rn
  FROM customer_accounts
  WHERE username IS NOT NULL
)
UPDATE customer_accounts 
SET username = CASE 
  WHEN nu.rn > 1 THEN nu.username || '_' || nu.rn::text
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
  WHEN nu.rn > 1 THEN nu.username || '_' || nu.rn::text
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
  WHEN nu.rn > 1 THEN nu.username || '_' || nu.rn::text
  ELSE nu.username
END
FROM numbered_users nu
WHERE users.id = nu.id AND nu.rn > 1;

-- Step 6: Verify all usernames are unique
-- Run this to confirm no duplicates remain:
/*
SELECT 'Final check - any remaining duplicates?' as info;
SELECT username, COUNT(*) as count 
FROM customer_accounts 
WHERE username IS NOT NULL 
GROUP BY username 
HAVING COUNT(*) > 1
UNION ALL
SELECT username, COUNT(*) 
FROM employees 
WHERE username IS NOT NULL 
GROUP BY username 
HAVING COUNT(*) > 1
UNION ALL
SELECT username, COUNT(*) 
FROM users 
WHERE username IS NOT NULL 
GROUP BY username 
HAVING COUNT(*) > 1;
*/

-- Step 7: Add constraints only after data is populated
-- This is the final step - only run after verifying everything above

-- Make usernames NOT NULL
ALTER TABLE customer_accounts 
ALTER COLUMN username SET NOT NULL;

ALTER TABLE employees 
ALTER COLUMN username SET NOT NULL;

ALTER TABLE users 
ALTER COLUMN username SET NOT NULL;

-- Add UNIQUE constraints
ALTER TABLE customer_accounts 
ADD CONSTRAINT customer_accounts_username_unique UNIQUE (username);

ALTER TABLE employees 
ADD CONSTRAINT employees_username_unique UNIQUE (username);

ALTER TABLE users 
ADD CONSTRAINT users_username_unique UNIQUE (username);

-- Add indexes for performance
CREATE INDEX idx_customer_accounts_username ON customer_accounts(username);
CREATE INDEX idx_employees_username ON employees(username);
CREATE INDEX idx_users_username ON users(username);

-- Step 8: Final verification
-- Run this to see the final result:
/*
SELECT 'Migration Complete! Sample results:' as info;
SELECT 'Customer Accounts:' as table_name;
SELECT email, username FROM customer_accounts LIMIT 5;
SELECT 'Employees:' as table_name;
SELECT email, username FROM employees LIMIT 5;
SELECT 'Users:' as table_name;
SELECT email, username FROM users LIMIT 5;
*/
