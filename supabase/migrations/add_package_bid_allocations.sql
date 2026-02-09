-- Add allocation fields to package_bids table
-- Stores how a package bid amount is distributed across divisions and items

-- Allocation method: 'even' (default), 'ai_suggested', 'manual'
ALTER TABLE package_bids
ADD COLUMN IF NOT EXISTS allocation_method TEXT DEFAULT 'even';

-- Division-level allocations as JSONB
-- Format: { "10": { "percent": 5, "amount": 25000 }, "11": { "percent": 60, "amount": 300000 }, ... }
ALTER TABLE package_bids
ADD COLUMN IF NOT EXISTS division_allocations JSONB DEFAULT '{}';

-- Item-level overrides (optional, for fine-grained control)
-- Format: { "item-uuid-1": 45000, "item-uuid-2": 30000, ... }
ALTER TABLE package_bids
ADD COLUMN IF NOT EXISTS item_allocations JSONB DEFAULT '{}';

-- Add comments for documentation
COMMENT ON COLUMN package_bids.allocation_method IS 'How the bid amount was distributed: even, ai_suggested, or manual';
COMMENT ON COLUMN package_bids.division_allocations IS 'Distribution of bid amount by CSI division code';
COMMENT ON COLUMN package_bids.item_allocations IS 'Optional item-level amount overrides';
