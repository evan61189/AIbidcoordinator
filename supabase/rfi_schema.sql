-- ============================================
-- RFI (REQUEST FOR INFORMATION) TRACKING SCHEMA
-- Track clarifications and questions during bidding
-- ============================================

-- ============================================
-- RFI TABLE
-- Main table for tracking RFIs
-- ============================================
CREATE TABLE IF NOT EXISTS rfis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    bid_round_id UUID REFERENCES bid_rounds(id) ON DELETE SET NULL,

    -- RFI identification
    rfi_number VARCHAR(20) NOT NULL,  -- e.g., "RFI-001"
    subject VARCHAR(255) NOT NULL,

    -- Question details
    question TEXT NOT NULL,
    question_attachments JSONB DEFAULT '[]',  -- [{filename, storage_url}]

    -- Source
    submitted_by_type VARCHAR(50) DEFAULT 'subcontractor'
        CHECK (submitted_by_type IN ('subcontractor', 'internal', 'owner', 'architect')),
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE SET NULL,
    submitted_by_name VARCHAR(100),
    submitted_by_email VARCHAR(255),

    -- Related items
    related_drawing_ids JSONB DEFAULT '[]',
    related_spec_sections TEXT,
    related_bid_item_ids JSONB DEFAULT '[]',

    -- Priority and category
    priority VARCHAR(20) DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    category VARCHAR(50)
        CHECK (category IN ('scope_clarification', 'drawing_conflict', 'spec_question', 'schedule', 'pricing', 'substitution', 'other')),

    -- Dates
    date_submitted DATE DEFAULT CURRENT_DATE,
    date_required DATE,  -- When response is needed
    date_responded DATE,

    -- Status
    status VARCHAR(50) DEFAULT 'open'
        CHECK (status IN ('open', 'pending_response', 'answered', 'closed', 'void')),

    -- Response
    response TEXT,
    response_attachments JSONB DEFAULT '[]',
    responded_by VARCHAR(100),

    -- Distribution
    distribute_to_all BOOLEAN DEFAULT FALSE,  -- Send response to all bidders
    distribution_list JSONB DEFAULT '[]',  -- List of subcontractor IDs to distribute to

    -- Cost/Schedule impact
    has_cost_impact BOOLEAN DEFAULT FALSE,
    cost_impact_description TEXT,
    has_schedule_impact BOOLEAN DEFAULT FALSE,
    schedule_impact_description TEXT,

    -- Notes
    internal_notes TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- RFI COMMENTS TABLE
-- Track discussion/comments on RFIs
-- ============================================
CREATE TABLE IF NOT EXISTS rfi_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rfi_id UUID REFERENCES rfis(id) ON DELETE CASCADE NOT NULL,

    -- Comment details
    comment TEXT NOT NULL,
    comment_by VARCHAR(100),
    comment_by_type VARCHAR(50) DEFAULT 'internal'
        CHECK (comment_by_type IN ('internal', 'subcontractor', 'architect', 'owner')),
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE SET NULL,

    -- Attachments
    attachments JSONB DEFAULT '[]',

    -- Visibility
    is_internal BOOLEAN DEFAULT TRUE,  -- Only visible to GC if true

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- RFI DISTRIBUTION LOG
-- Track who received the RFI response
-- ============================================
CREATE TABLE IF NOT EXISTS rfi_distributions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rfi_id UUID REFERENCES rfis(id) ON DELETE CASCADE NOT NULL,
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE CASCADE NOT NULL,

    -- Distribution details
    distributed_at TIMESTAMPTZ DEFAULT NOW(),
    distributed_via VARCHAR(50) DEFAULT 'email'
        CHECK (distributed_via IN ('email', 'portal', 'manual')),

    -- Tracking
    email_sent BOOLEAN DEFAULT FALSE,
    email_opened_at TIMESTAMPTZ,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,

    UNIQUE(rfi_id, subcontractor_id)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_rfis_project ON rfis(project_id);
CREATE INDEX IF NOT EXISTS idx_rfis_status ON rfis(status);
CREATE INDEX IF NOT EXISTS idx_rfis_number ON rfis(rfi_number);
CREATE INDEX IF NOT EXISTS idx_rfis_subcontractor ON rfis(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_rfi_comments_rfi ON rfi_comments(rfi_id);
CREATE INDEX IF NOT EXISTS idx_rfi_distributions_rfi ON rfi_distributions(rfi_id);

-- ============================================
-- TRIGGERS
-- ============================================
CREATE TRIGGER update_rfis_updated_at BEFORE UPDATE ON rfis
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- FUNCTION: Generate next RFI number
-- ============================================
CREATE OR REPLACE FUNCTION get_next_rfi_number(p_project_id UUID)
RETURNS VARCHAR AS $$
DECLARE
    next_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(rfi_number FROM 5) AS INTEGER)), 0) + 1
    INTO next_num
    FROM rfis
    WHERE project_id = p_project_id
      AND rfi_number ~ '^RFI-[0-9]+$';

    RETURN 'RFI-' || LPAD(next_num::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEW: RFI summary by project
-- ============================================
CREATE OR REPLACE VIEW rfi_project_summary AS
SELECT
    project_id,
    COUNT(*) as total_rfis,
    COUNT(*) FILTER (WHERE status = 'open') as open_rfis,
    COUNT(*) FILTER (WHERE status = 'pending_response') as pending_rfis,
    COUNT(*) FILTER (WHERE status = 'answered') as answered_rfis,
    COUNT(*) FILTER (WHERE priority = 'urgent' AND status IN ('open', 'pending_response')) as urgent_open,
    COUNT(*) FILTER (WHERE has_cost_impact = TRUE) as with_cost_impact,
    MIN(date_required) FILTER (WHERE status IN ('open', 'pending_response')) as earliest_due_date
FROM rfis
GROUP BY project_id;
