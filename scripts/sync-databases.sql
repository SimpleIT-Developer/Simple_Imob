-- Script to sync data from production to development
-- This file contains the INSERT statements generated from production data

-- First, let's create the sequence of inserts based on foreign key dependencies:
-- 1. users (no deps)
-- 2. landlords (no deps) 
-- 3. tenants (no deps)
-- 4. service_providers (no deps)
-- 5. guarantors (depends on tenants)
-- 6. properties (depends on landlords)
-- 7. contracts (depends on properties, tenants)
-- 8. services (depends on contracts, service_providers)
-- 9. receipts (depends on contracts)
-- 10. cash_transactions, landlord_transfers, invoices

-- This file will be populated by the sync script
