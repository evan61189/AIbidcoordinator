-- ============================================
-- ADDENDA MANAGEMENT SCHEMA
-- Track project addenda and acknowledgments
-- ============================================

-- ============================================
-- ADDENDA TABLE
-- Main table for tracking addenda
-- ============================================
CREATE TABLE IF NOT EXISTS addenda (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    bid_round_id UUID REFERENCES bid_rounds(id) ON DELETE SET NULL,

    -- Addendum identification
    addendum_number INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,

    -- Content
    description TEXT,
    summary TEXT,  -- Brief summary for quick reference

    -- Files
    attachments JSONB DEFAULT '[]',  -- [{filename, storage_url, file_type, file_size}]

    -- Dates
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_date DATE,

    -- Impact
    extends_bid_date BOOLEAN DEFAULT FALSE,
    new_bid_date DATE,
    affected_trades JSONB DEFAULT '[]',  -- Array of trade IDs
    affected_spec_sections TEXT,
    affected_drawings TEXT,

    -- Type of changes
    change_types JSONB DEFAULT '[]',  -- ['scope_change', 'clarification', 'drawing_revision', 'spec_revision', 'schedule_change']

    -- Status
    status VARCHAR(50) DEFAULT 'draft'
        CHECK (status IN ('draft', 'issued', 'superseded', 'void')),

    -- Distribution
    distribute_to_all BOOLEAN DEFAULT TRUE,
    distribution_list JSONB DEFAULT '[]',  -- List of subcontractor IDs if not all

    -- AI processing
    ai_processed BOOLEAN DEFAULT FALSE,
    ai_summary TEXT,
    ai_extracted_changes JSONB,  -- Structured changes extracted by AI

    -- Notes
    internal_notes TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure unique addendum numbers per project
    UNIQUE(project_id, addendum_number)
);

-- ============================================
-- ADDENDUM ACKNOWLEDGMENTS TABLE
-- Track who has received/acknowledged addenda
-- ============================================
CREATE TABLE IF NOT EXISTS addendum_acknowledgments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    addendum_id UUID REFERENCES addenda(id) ON DELETE CASCADE NOT NULL,
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE CASCADE NOT NULL,

    -- Distribution
    distributed_at TIMESTAMPTZ DEFAULT NOW(),
    distributed_via VARCHAR(50) DEFAULT 'email'
        CHECK (distributed_via IN ('email', 'portal', 'manual', 'fax')),

    -- Email tracking
    email_sent BOOLEAN DEFAULT FALSE,
    email_sent_at TIMESTAMPTZ,
    email_opened BOOLEAN DEFAULT FALSE,
    email_opened_at TIMESTAMPTZ,

    -- Acknowledgment
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(100),  -- Name of person who acknowledged

    -- Signature (if required)
    signature_required BOOLEAN DEFAULT FALSE,
    signature_received BOOLEAN DEFAULT FALSE,
    signature_file_url TEXT,

    -- Notes
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(addendum_id, subcontractor_id)
);

-- ============================================
-- ADDENDUM ITEMS TABLE
-- Individual changes within an addendum
-- ============================================
CREATE TABLE IF NOT EXISTS addendum_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    addendum_id UUID REFERENCES addenda(id) ON DELETE CASCADE NOT NULL,

    -- Item details
    item_number INTEGER NOT NULL,
    change_type VARCHAR(50)
        CHECK (change_type IN ('add', 'delete', 'revise', 'clarify', 'substitute')),

    -- What's being changed
    affected_area VARCHAR(100),  -- e.g., "Drawing A1.01", "Spec 09 21 16"
    description TEXT NOT NULL,

    -- Trade/scope affected
    trade_id UUID REFERENCES trades(id) ON DELETE SET NULL,

    -- Cost/schedule impact
    has_cost_impact BOOLEAN DEFAULT FALSE,
    estimated_cost_impact DECIMAL(15, 2),
    has_schedule_impact BOOLEAN DEFAULT FALSE,
    schedule_impact_days INTEGER,

    -- Order
    sort_order INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_addenda_project ON addenda(project_id);
CREATE INDEX IF NOT EXISTS idx_addenda_status ON addenda(status);
CREATE INDEX IF NOT EXISTS idx_addenda_issue_date ON addenda(issue_date);
CREATE INDEX IF NOT EXISTS idx_addendum_acks_addendum ON addendum_acknowledgments(addendum_id);
CREATE INDEX IF NOT EXISTS idx_addendum_acks_sub ON addendum_acknowledgments(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_addendum_acks_acknowledged ON addendum_acknowledgments(acknowledged);
CREATE INDEX IF NOT EXISTS idx_addendum_items_addendum ON addendum_items(addendum_id);

-- ============================================
-- TRIGGERS
-- ============================================
CREATE TRIGGER update_addenda_updated_at BEFORE UPDATE ON addenda
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- FUNCTION: Get next addendum number
-- ============================================
CREATE OR REPLACE FUNCTION get_next_addendum_number(p_project_id UUID)
RETURNS INTEGER AS $$
DECLARE
    next_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(addendum_number), 0) + 1
    INTO next_num
    FROM addenda
    WHERE project_id = p_project_id;

    RETURN next_num;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEW: Addendum acknowledgment status
-- ============================================
CREATE OR REPLACE VIEW addendum_acknowledgment_status AS
SELECT
    a.id as addendum_id,
    a.project_id,
    a.addendum_number,
    a.title,
    a.issue_date,
    a.status,
    COUNT(aa.id) as total_distributed,
    COUNT(aa.id) FILTER (WHERE aa.email_sent = TRUE) as emails_sent,
    COUNT(aa.id) FILTER (WHERE aa.email_opened = TRUE) as emails_opened,
    COUNT(aa.id) FILTER (WHERE aa.acknowledged = TRUE) as acknowledged_count,
    ROUND(
        COUNT(aa.id) FILTER (WHERE aa.acknowledged = TRUE)::NUMERIC /
        NULLIF(COUNT(aa.id), 0) * 100,
        1
    ) as acknowledgment_rate
FROM addenda a
LEFT JOIN addendum_acknowledgments aa ON aa.addendum_id = a.id
GROUP BY a.id;

-- ============================================
-- VIEW: Subcontractor addendum status by project
-- ============================================
CREATE OR REPLACE VIEW subcontractor_addenda_status AS
SELECT
    s.id as subcontractor_id,
    s.company_name,
    p.id as project_id,
    p.name as project_name,
    COUNT(a.id) as total_addenda,
    COUNT(aa.id) FILTER (WHERE aa.acknowledged = TRUE) as acknowledged_count,
    COUNT(a.id) - COUNT(aa.id) FILTER (WHERE aa.acknowledged = TRUE) as pending_count,
    ARRAY_AGG(a.addendum_number ORDER BY a.addendum_number)
        FILTER (WHERE aa.acknowledged = FALSE OR aa.id IS NULL) as pending_addenda
FROM subcontractors s
CROSS JOIN projects p
JOIN addenda a ON a.project_id = p.id AND a.status = 'issued'
LEFT JOIN addendum_acknowledgments aa ON aa.addendum_id = a.id AND aa.subcontractor_id = s.id
GROUP BY s.id, s.company_name, p.id, p.name
HAVING COUNT(a.id) > 0;
