-- ============================================
-- BID ROUNDS AND DRAWING VERSION CONTROL SCHEMA
-- Run this in Supabase SQL Editor to add bid rounds and versioning
-- ============================================

-- ============================================
-- BID ROUNDS TABLE
-- Represents pricing rounds as drawings mature
-- ============================================
CREATE TABLE IF NOT EXISTS bid_rounds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,

    -- Round identification
    round_number INTEGER NOT NULL DEFAULT 1,
    name VARCHAR(100),  -- e.g., "SD Pricing", "DD Pricing", "CD Pricing", "GMP Round 1"

    -- Description and context
    description TEXT,
    drawing_revision VARCHAR(50),  -- e.g., "SD Set", "DD Set Rev 1", "100% CD"

    -- Status
    status VARCHAR(50) DEFAULT 'active'
        CHECK (status IN ('active', 'closed', 'superseded')),

    -- Dates
    issued_date DATE,
    due_date DATE,

    -- Pricing summary (calculated/cached)
    total_bid_items INTEGER DEFAULT 0,
    responses_received INTEGER DEFAULT 0,
    lowest_total DECIMAL(15, 2),
    average_total DECIMAL(15, 2),

    -- Notes
    notes TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure unique round numbers per project
    UNIQUE(project_id, round_number)
);

-- ============================================
-- UPDATE DRAWINGS TABLE FOR VERSION CONTROL
-- ============================================
ALTER TABLE drawings
    ADD COLUMN IF NOT EXISTS bid_round_id UUID REFERENCES bid_rounds(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS version_number INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS is_current BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES drawings(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS storage_url TEXT,  -- Supabase storage public URL
    ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64),  -- For detecting duplicates
    ADD COLUMN IF NOT EXISTS page_count INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS ai_processed BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMPTZ;

-- ============================================
-- PROJECT DOCUMENTS TABLE
-- For spec books, addenda, and other documents
-- ============================================
CREATE TABLE IF NOT EXISTS project_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    bid_round_id UUID REFERENCES bid_rounds(id) ON DELETE SET NULL,

    -- Document type
    document_type VARCHAR(50) NOT NULL
        CHECK (document_type IN ('spec_book', 'addendum', 'rfi_response', 'geotechnical', 'survey', 'other')),

    -- File info
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255),
    title VARCHAR(200),
    file_type VARCHAR(20),
    file_size INTEGER,
    storage_path TEXT,
    storage_url TEXT,

    -- Version control
    version_number INTEGER DEFAULT 1,
    is_current BOOLEAN DEFAULT TRUE,
    superseded_by UUID REFERENCES project_documents(id) ON DELETE SET NULL,

    -- Processing
    ai_processed BOOLEAN DEFAULT FALSE,
    ai_summary TEXT,  -- AI-generated summary of document contents

    -- Metadata
    section_numbers TEXT,  -- Relevant spec sections, comma-separated
    notes TEXT,

    -- Timestamps
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- DRAWING SETS TABLE
-- Groups drawings by discipline for organization
-- ============================================
CREATE TABLE IF NOT EXISTS drawing_sets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    bid_round_id UUID REFERENCES bid_rounds(id) ON DELETE SET NULL,

    -- Set identification
    name VARCHAR(100) NOT NULL,  -- e.g., "Architectural", "Structural", "MEP"
    discipline VARCHAR(50),  -- A, S, M, E, P, etc.
    description TEXT,

    -- Sheet range
    sheet_prefix VARCHAR(10),  -- e.g., "A", "S", "M"
    total_sheets INTEGER DEFAULT 0,

    -- Status
    is_complete BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link drawings to drawing sets
ALTER TABLE drawings
    ADD COLUMN IF NOT EXISTS drawing_set_id UUID REFERENCES drawing_sets(id) ON DELETE SET NULL;

-- ============================================
-- UPDATE BID ITEMS TO LINK TO BID ROUNDS
-- ============================================
ALTER TABLE bid_items
    ADD COLUMN IF NOT EXISTS bid_round_id UUID REFERENCES bid_rounds(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_drawing_id UUID REFERENCES drawings(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ai_confidence DECIMAL(3, 2);  -- 0.00 to 1.00

-- ============================================
-- BID ROUND INVITATIONS TABLE
-- Track which subs were invited to each round
-- ============================================
CREATE TABLE IF NOT EXISTS bid_round_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_round_id UUID REFERENCES bid_rounds(id) ON DELETE CASCADE NOT NULL,
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE CASCADE NOT NULL,

    -- Invitation details
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    invited_by VARCHAR(100),

    -- Bid items they're bidding on (array of bid_item_ids)
    bid_item_ids JSONB DEFAULT '[]',

    -- Status tracking
    status VARCHAR(50) DEFAULT 'invited'
        CHECK (status IN ('invited', 'viewed', 'submitted', 'declined', 'no_response')),

    -- Response tracking
    response_received_at TIMESTAMPTZ,
    bid_response_id UUID,  -- Links to bid_responses table

    -- Email tracking
    email_sent BOOLEAN DEFAULT FALSE,
    email_sent_at TIMESTAMPTZ,
    email_opened_at TIMESTAMPTZ,

    -- Documents sent
    drawings_attached JSONB DEFAULT '[]',  -- Array of drawing IDs sent
    documents_attached JSONB DEFAULT '[]',  -- Array of document IDs sent

    notes TEXT,

    UNIQUE(bid_round_id, subcontractor_id)
);

-- ============================================
-- BID ROUND RESPONSES TABLE
-- Store responses specific to each bid round
-- ============================================
CREATE TABLE IF NOT EXISTS bid_round_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_round_id UUID REFERENCES bid_rounds(id) ON DELETE CASCADE NOT NULL,
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE CASCADE NOT NULL,
    bid_round_invitation_id UUID REFERENCES bid_round_invitations(id) ON DELETE SET NULL,

    -- Source (manual entry or parsed from email)
    source VARCHAR(50) DEFAULT 'manual'
        CHECK (source IN ('manual', 'email_parsed', 'portal_upload')),
    inbound_email_id UUID,  -- If parsed from email

    -- Pricing
    total_amount DECIMAL(15, 2),
    breakdown JSONB DEFAULT '[]',  -- Line item breakdown

    -- Scope
    scope_included TEXT,
    scope_excluded TEXT,
    clarifications TEXT,
    alternates JSONB DEFAULT '[]',

    -- Terms
    payment_terms VARCHAR(255),
    lead_time VARCHAR(100),
    valid_until DATE,
    warranty_info TEXT,

    -- Attachments (original files from sub)
    attachments JSONB DEFAULT '[]',  -- [{filename, storage_url, file_type}]

    -- AI analysis
    ai_confidence_score DECIMAL(3, 2),
    ai_analysis_notes TEXT,
    raw_extracted_data JSONB,

    -- Review status
    status VARCHAR(50) DEFAULT 'pending_review'
        CHECK (status IN ('pending_review', 'approved', 'rejected', 'needs_clarification', 'awarded')),
    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,

    -- Comparison to other rounds
    previous_round_response_id UUID REFERENCES bid_round_responses(id),
    price_change_amount DECIMAL(15, 2),  -- Difference from previous round
    price_change_percent DECIMAL(5, 2),

    -- Timestamps
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(bid_round_id, subcontractor_id)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_bid_rounds_project ON bid_rounds(project_id);
CREATE INDEX IF NOT EXISTS idx_bid_rounds_status ON bid_rounds(status);
CREATE INDEX IF NOT EXISTS idx_drawings_bid_round ON drawings(bid_round_id);
CREATE INDEX IF NOT EXISTS idx_drawings_current ON drawings(is_current) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_project_documents_type ON project_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_bid_items_round ON bid_items(bid_round_id);
CREATE INDEX IF NOT EXISTS idx_bid_round_invitations_round ON bid_round_invitations(bid_round_id);
CREATE INDEX IF NOT EXISTS idx_bid_round_invitations_sub ON bid_round_invitations(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_bid_round_responses_round ON bid_round_responses(bid_round_id);
CREATE INDEX IF NOT EXISTS idx_bid_round_responses_sub ON bid_round_responses(subcontractor_id);

-- ============================================
-- TRIGGERS
-- ============================================
CREATE TRIGGER update_bid_rounds_updated_at BEFORE UPDATE ON bid_rounds
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_documents_updated_at BEFORE UPDATE ON project_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bid_round_responses_updated_at BEFORE UPDATE ON bid_round_responses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- HELPER FUNCTION: Create initial bid round for project
-- ============================================
CREATE OR REPLACE FUNCTION create_initial_bid_round(p_project_id UUID, p_name VARCHAR DEFAULT 'Round 1')
RETURNS UUID AS $$
DECLARE
    new_round_id UUID;
BEGIN
    INSERT INTO bid_rounds (project_id, round_number, name, status)
    VALUES (p_project_id, 1, p_name, 'active')
    RETURNING id INTO new_round_id;

    RETURN new_round_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- HELPER FUNCTION: Create new bid round from previous
-- ============================================
CREATE OR REPLACE FUNCTION create_next_bid_round(
    p_project_id UUID,
    p_name VARCHAR,
    p_copy_bid_items BOOLEAN DEFAULT TRUE
)
RETURNS UUID AS $$
DECLARE
    new_round_id UUID;
    prev_round_number INTEGER;
    prev_round_id UUID;
BEGIN
    -- Get the latest round number
    SELECT round_number, id INTO prev_round_number, prev_round_id
    FROM bid_rounds
    WHERE project_id = p_project_id
    ORDER BY round_number DESC
    LIMIT 1;

    -- Mark previous round as superseded
    UPDATE bid_rounds
    SET status = 'superseded'
    WHERE id = prev_round_id;

    -- Create new round
    INSERT INTO bid_rounds (project_id, round_number, name, status)
    VALUES (p_project_id, COALESCE(prev_round_number, 0) + 1, p_name, 'active')
    RETURNING id INTO new_round_id;

    -- Optionally copy bid items from previous round
    IF p_copy_bid_items AND prev_round_id IS NOT NULL THEN
        INSERT INTO bid_items (project_id, bid_round_id, trade_id, item_number, description, scope_details, quantity, unit, estimated_cost, bid_due_date, status, notes, ai_generated, ai_confidence)
        SELECT project_id, new_round_id, trade_id, item_number, description, scope_details, quantity, unit, estimated_cost, bid_due_date, 'open', notes, ai_generated, ai_confidence
        FROM bid_items
        WHERE bid_round_id = prev_round_id;
    END IF;

    RETURN new_round_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- HELPER FUNCTION: Calculate round pricing summary
-- ============================================
CREATE OR REPLACE FUNCTION update_bid_round_summary(p_bid_round_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE bid_rounds
    SET
        total_bid_items = (
            SELECT COUNT(*) FROM bid_items WHERE bid_round_id = p_bid_round_id
        ),
        responses_received = (
            SELECT COUNT(*) FROM bid_round_responses WHERE bid_round_id = p_bid_round_id AND status != 'pending_review'
        ),
        lowest_total = (
            SELECT MIN(total_amount) FROM bid_round_responses WHERE bid_round_id = p_bid_round_id AND total_amount IS NOT NULL
        ),
        average_total = (
            SELECT AVG(total_amount) FROM bid_round_responses WHERE bid_round_id = p_bid_round_id AND total_amount IS NOT NULL
        ),
        updated_at = NOW()
    WHERE id = p_bid_round_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEW: Current drawings for each project
-- ============================================
CREATE OR REPLACE VIEW current_project_drawings AS
SELECT d.*, p.name as project_name, br.name as bid_round_name, br.round_number
FROM drawings d
JOIN projects p ON p.id = d.project_id
LEFT JOIN bid_rounds br ON br.id = d.bid_round_id
WHERE d.is_current = TRUE;

-- ============================================
-- VIEW: Bid round comparison
-- ============================================
CREATE OR REPLACE VIEW bid_round_comparison AS
SELECT
    br.project_id,
    br.id as bid_round_id,
    br.round_number,
    br.name as round_name,
    br.drawing_revision,
    br.status,
    s.id as subcontractor_id,
    s.company_name,
    brr.total_amount,
    brr.status as response_status,
    brr.price_change_amount,
    brr.price_change_percent,
    brr.submitted_at
FROM bid_rounds br
CROSS JOIN subcontractors s
LEFT JOIN bid_round_responses brr ON brr.bid_round_id = br.id AND brr.subcontractor_id = s.id
ORDER BY br.project_id, s.company_name, br.round_number;
