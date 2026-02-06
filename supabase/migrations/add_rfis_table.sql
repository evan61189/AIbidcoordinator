-- RFIs (Request for Information) Table
-- Tracks questions from subcontractors during the bidding process

CREATE TABLE IF NOT EXISTS rfis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE SET NULL,
    bid_round_id UUID REFERENCES bid_rounds(id) ON DELETE SET NULL,

    -- RFI identification
    rfi_number VARCHAR(20) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    question TEXT NOT NULL,
    category VARCHAR(50) DEFAULT 'scope_clarification',

    -- Source tracking
    source VARCHAR(50) NOT NULL DEFAULT 'manual' CHECK (source IN ('email', 'manual', 'forwarded_email', 'phone', 'meeting')),
    source_email_id UUID REFERENCES inbound_emails(id) ON DELETE SET NULL,

    -- Submitter info (for RFIs from external sources)
    submitted_by_name VARCHAR(200),
    submitted_by_email VARCHAR(200),
    date_submitted DATE DEFAULT CURRENT_DATE,

    -- Related references
    trade_id UUID REFERENCES trades(id) ON DELETE SET NULL,
    scope_package_id UUID REFERENCES scope_packages(id) ON DELETE SET NULL,
    related_drawing_sheets TEXT, -- e.g., "A-101, A-102"
    related_spec_sections TEXT, -- e.g., "03 30 00, 09 21 16"
    internal_notes TEXT, -- Notes for internal reference (not shared)

    -- Status and workflow
    status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending_response', 'answered', 'closed', 'void')),
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    date_required DATE, -- Response needed by

    -- Response
    response TEXT,
    date_responded DATE,
    responded_by VARCHAR(200),

    -- Impact tracking
    distribute_to_all BOOLEAN DEFAULT FALSE,
    has_cost_impact BOOLEAN DEFAULT FALSE,
    cost_impact_description TEXT,
    has_schedule_impact BOOLEAN DEFAULT FALSE,
    schedule_impact_description TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RFI Comments table for discussion threads
CREATE TABLE IF NOT EXISTS rfi_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rfi_id UUID NOT NULL REFERENCES rfis(id) ON DELETE CASCADE,
    comment TEXT NOT NULL,
    comment_by VARCHAR(200) NOT NULL,
    comment_by_type VARCHAR(50) DEFAULT 'internal' CHECK (comment_by_type IN ('internal', 'subcontractor', 'architect', 'owner')),
    is_internal BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique constraint for RFI numbers within a project
CREATE UNIQUE INDEX IF NOT EXISTS idx_rfis_project_number ON rfis(project_id, rfi_number);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_rfis_project ON rfis(project_id);
CREATE INDEX IF NOT EXISTS idx_rfis_subcontractor ON rfis(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_rfis_status ON rfis(status);
CREATE INDEX IF NOT EXISTS idx_rfis_source ON rfis(source);
CREATE INDEX IF NOT EXISTS idx_rfi_comments_rfi ON rfi_comments(rfi_id);

-- Function to get next RFI number for a project
CREATE OR REPLACE FUNCTION get_next_rfi_number(p_project_id UUID)
RETURNS VARCHAR AS $$
DECLARE
    next_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(rfi_number FROM 5) AS INTEGER)), 0) + 1
    INTO next_num
    FROM rfis
    WHERE project_id = p_project_id;

    RETURN 'RFI-' || LPAD(next_num::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate RFI numbers
CREATE OR REPLACE FUNCTION generate_rfi_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.rfi_number IS NULL OR NEW.rfi_number = '' THEN
        NEW.rfi_number := get_next_rfi_number(NEW.project_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_generate_rfi_number ON rfis;
CREATE TRIGGER trigger_generate_rfi_number
    BEFORE INSERT ON rfis
    FOR EACH ROW
    EXECUTE FUNCTION generate_rfi_number();

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_rfis_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_rfis_updated_at ON rfis;
CREATE TRIGGER trigger_rfis_updated_at
    BEFORE UPDATE ON rfis
    FOR EACH ROW
    EXECUTE FUNCTION update_rfis_updated_at();

-- Enable Row Level Security
ALTER TABLE rfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfi_comments ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (adjust based on auth requirements)
CREATE POLICY "Allow all operations on rfis" ON rfis
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on rfi_comments" ON rfi_comments
    FOR ALL USING (true) WITH CHECK (true);
