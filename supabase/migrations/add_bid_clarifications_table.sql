-- Table to track clarification requests sent to subcontractors
-- Used when a sub provides a lump sum bid for multiple packages

CREATE TABLE IF NOT EXISTS bid_clarifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE CASCADE,
  original_bid_id UUID REFERENCES bids(id) ON DELETE SET NULL,

  -- Packages that need breakdown
  packages_requested TEXT[] NOT NULL,
  lump_sum_amount DECIMAL(12, 2),

  -- Response tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'resolved')),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,

  -- Response data (when they reply with breakdown)
  package_amounts JSONB, -- {"Electrical": 50000, "Fire Alarm": 25000, "Low Voltage": 15000}

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_bid_clarifications_project ON bid_clarifications(project_id);
CREATE INDEX IF NOT EXISTS idx_bid_clarifications_sub ON bid_clarifications(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_bid_clarifications_status ON bid_clarifications(status);

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_bid_clarifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bid_clarifications_updated_at ON bid_clarifications;
CREATE TRIGGER bid_clarifications_updated_at
  BEFORE UPDATE ON bid_clarifications
  FOR EACH ROW
  EXECUTE FUNCTION update_bid_clarifications_updated_at();
