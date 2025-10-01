-- Migration: Add credit/balance system to customer accounts
-- This migration adds credit fields to customer_accounts table

-- Add credit balance column to customer_accounts
ALTER TABLE public.customer_accounts 
ADD COLUMN IF NOT EXISTS credit_balance DECIMAL(10,2) DEFAULT 0.00;

-- Add credit limit column (optional - for credit limits)
ALTER TABLE public.customer_accounts 
ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(10,2) DEFAULT 0.00;

-- Create index for credit balance queries
CREATE INDEX IF NOT EXISTS idx_customer_accounts_credit_balance ON public.customer_accounts(credit_balance);

-- Create audit table for credit transactions
CREATE TABLE IF NOT EXISTS public.customer_credit_transactions (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('credit', 'debit', 'adjustment', 'refund', 'payment')),
    amount DECIMAL(10,2) NOT NULL,
    previous_balance DECIMAL(10,2) NOT NULL,
    new_balance DECIMAL(10,2) NOT NULL,
    description TEXT,
    reference_type VARCHAR(50), -- 'bill_payment', 'manual_adjustment', 'refund', etc.
    reference_id INTEGER, -- ID of related bill, payment, etc.
    created_by INTEGER REFERENCES public.employees(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for credit transactions
CREATE INDEX IF NOT EXISTS idx_credit_transactions_customer_id ON public.customer_credit_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON public.customer_credit_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON public.customer_credit_transactions(created_at);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_credit_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_customer_credit_transactions_updated_at 
    BEFORE UPDATE ON public.customer_credit_transactions 
    FOR EACH ROW EXECUTE FUNCTION update_credit_transactions_updated_at();

-- Add constraint to ensure credit balance is not negative (optional)
-- ALTER TABLE public.customer_accounts 
-- ADD CONSTRAINT check_credit_balance_non_negative CHECK (credit_balance >= 0);

COMMENT ON COLUMN public.customer_accounts.credit_balance IS 'Current credit balance available to customer';
COMMENT ON COLUMN public.customer_accounts.credit_limit IS 'Maximum credit limit allowed for customer';
COMMENT ON TABLE public.customer_credit_transactions IS 'Audit trail for all credit transactions';


