-- Migration: Add penalty column to billing

ALTER TABLE public.billing
ADD COLUMN IF NOT EXISTS penalty DECIMAL(10,2) DEFAULT 0.00;

-- Optional: index if you query by penalty frequently
-- CREATE INDEX IF NOT EXISTS idx_billing_penalty ON public.billing(penalty);



