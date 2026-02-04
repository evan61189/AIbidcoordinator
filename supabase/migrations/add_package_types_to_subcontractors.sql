-- Add package_types column to subcontractors table
-- This stores the bid package types (e.g., 'electrical', 'plumbing', 'hvac')
-- that a subcontractor typically bids on.
--
-- This replaces the previous division-based system with a more practical
-- approach that reflects how subcontractors actually bid work.

ALTER TABLE subcontractors
ADD COLUMN IF NOT EXISTS package_types TEXT[] DEFAULT '{}';

-- Create an index for efficient querying by package type
CREATE INDEX IF NOT EXISTS idx_subcontractors_package_types
ON subcontractors USING GIN (package_types);

-- Add a comment for documentation
COMMENT ON COLUMN subcontractors.package_types IS 'Array of bid package type IDs (e.g., electrical, plumbing, hvac) this subcontractor bids on';
