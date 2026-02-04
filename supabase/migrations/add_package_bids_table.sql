-- Package-level bids table for storing bids at the package level
-- This allows for proper bid leveling when subs provide lump sum pricing per package

CREATE TABLE IF NOT EXISTS package_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scope_package_id UUID NOT NULL REFERENCES scope_packages(id) ON DELETE CASCADE,
    subcontractor_id UUID NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,

    -- Bid details
    amount DECIMAL(15, 2),
    status VARCHAR(50) DEFAULT 'pending_approval',  -- pending_approval, approved, rejected, withdrawn

    -- Source tracking
    source VARCHAR(50) DEFAULT 'email',  -- email, manual, clarification_response
    bid_response_id UUID REFERENCES bid_responses(id),  -- Link to original parsed response
    clarification_id UUID REFERENCES bid_clarifications(id),  -- If from clarification response

    -- Metadata
    notes TEXT,
    scope_included TEXT,
    scope_excluded TEXT,
    clarifications TEXT,

    -- Timestamps
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    approved_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure one bid per package per subcontractor (can have multiple with different statuses via versioning)
    UNIQUE(project_id, scope_package_id, subcontractor_id, submitted_at)
);

-- Index for common queries
CREATE INDEX idx_package_bids_project ON package_bids(project_id);
CREATE INDEX idx_package_bids_package ON package_bids(scope_package_id);
CREATE INDEX idx_package_bids_subcontractor ON package_bids(subcontractor_id);
CREATE INDEX idx_package_bids_status ON package_bids(status);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_package_bids_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER package_bids_updated_at
    BEFORE UPDATE ON package_bids
    FOR EACH ROW
    EXECUTE FUNCTION update_package_bids_updated_at();

-- Add package_ids column to bid_invitations if not exists
-- This tracks which packages were invited (instead of just bid_item_ids)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bid_invitations' AND column_name = 'package_ids'
    ) THEN
        ALTER TABLE bid_invitations ADD COLUMN package_ids JSONB;
    END IF;
END $$;

-- Comments
COMMENT ON TABLE package_bids IS 'Stores bids at the package level for proper bid leveling';
COMMENT ON COLUMN package_bids.status IS 'pending_approval: needs review, approved: accepted for leveling, rejected: declined, withdrawn: sub withdrew';
COMMENT ON COLUMN package_bids.source IS 'How the bid was received: email parsing, manual entry, or clarification response';
