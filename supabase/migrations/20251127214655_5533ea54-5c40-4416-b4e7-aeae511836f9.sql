-- Step 1: Add super_admin role to the enum
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'super_admin';