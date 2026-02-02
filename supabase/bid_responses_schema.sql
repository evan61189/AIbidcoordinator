-- ============================================
-- BID RESPONSES SCHEMA UPDATE
-- Run this in Supabase SQL Editor to add email parsing support
-- ============================================

-- ============================================
-- INBOUND EMAILS TABLE
-- Stores raw incoming emails from SendGrid Inbound Parse
-- ============================================
CREATE TABLE IF NOT EXISTS inbound_emails (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Email metadata
    from_email VARCHAR(255) NOT NULL,
    from_name VARCHAR(255),
    to_email VARCHAR(255),
    subject VARCHAR(500),

    -- Email content
    body_plain TEXT,
    body_html TEXT,

    -- Attachments stored as JSON array
    -- [{filename, content_type, size, storage_path}]
    attachments JSONB DEFAULT '[]',

    -- SendGrid metadata
    sendgrid_message_id VARCHAR(255),
    spam_score DECIMAL(5, 2),

    -- Processing status
    processing_status VARCHAR(50) DEFAULT 'pending'
        CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed', 'ignored')),
    processing_error TEXT,

    -- Linking (populated after AI analysis)
    matched_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    matched_subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE SET NULL,
    matched_bid_id UUID REFERENCES bids(id) ON DELETE SET NULL,

    -- Timestamps
    email_date TIMESTAMPTZ,
    received_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- ============================================
-- BID RESPONSES TABLE
-- Stores AI-parsed bid data from email responses
-- ============================================
CREATE TABLE IF NOT EXISTS bid_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Links
    inbound_email_id UUID REFERENCES inbound_emails(id) ON DELETE CASCADE NOT NULL,
    bid_id UUID REFERENCES bids(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE SET NULL,

    -- Extracted bid data
    total_amount DECIMAL(15, 2),
    unit_price DECIMAL(15, 2),

    -- Line items extracted (JSON array)
    -- [{description, quantity, unit, unit_price, total, trade}]
    line_items JSONB DEFAULT '[]',

    -- Scope and terms
    scope_included TEXT,
    scope_excluded TEXT,
    clarifications TEXT,
    alternates JSONB DEFAULT '[]',  -- [{description, add_amount, deduct_amount}]

    -- Terms
    payment_terms VARCHAR(255),
    lead_time VARCHAR(100),
    valid_until DATE,
    warranty_info TEXT,

    -- AI analysis metadata
    ai_confidence_score DECIMAL(3, 2),  -- 0.00 to 1.00
    ai_analysis_notes TEXT,
    raw_extracted_data JSONB,  -- Full AI response for debugging

    -- Status
    status VARCHAR(50) DEFAULT 'pending_review'
        CHECK (status IN ('pending_review', 'approved', 'rejected', 'needs_clarification')),
    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BID INVITATIONS TABLE
-- Track outbound invitations for reply matching
-- ============================================
CREATE TABLE IF NOT EXISTS bid_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Links
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE CASCADE NOT NULL,

    -- Invitation details
    to_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500),

    -- Bid items included in invitation (JSON array of bid_item_ids)
    bid_item_ids JSONB DEFAULT '[]',

    -- Unique tracking token for reply matching
    tracking_token UUID DEFAULT uuid_generate_v4() UNIQUE,

    -- Status
    status VARCHAR(50) DEFAULT 'sent'
        CHECK (status IN ('sent', 'delivered', 'opened', 'replied', 'bounced')),

    -- Email sending
    email_sent BOOLEAN DEFAULT FALSE,
    sendgrid_message_id VARCHAR(255),

    -- Timestamps
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    opened_at TIMESTAMPTZ,
    replied_at TIMESTAMPTZ
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_inbound_emails_status ON inbound_emails(processing_status);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_from ON inbound_emails(from_email);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_project ON inbound_emails(matched_project_id);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_received ON inbound_emails(received_at);

CREATE INDEX IF NOT EXISTS idx_bid_responses_project ON bid_responses(project_id);
CREATE INDEX IF NOT EXISTS idx_bid_responses_subcontractor ON bid_responses(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_bid_responses_status ON bid_responses(status);
CREATE INDEX IF NOT EXISTS idx_bid_responses_bid ON bid_responses(bid_id);

CREATE INDEX IF NOT EXISTS idx_bid_invitations_project ON bid_invitations(project_id);
CREATE INDEX IF NOT EXISTS idx_bid_invitations_subcontractor ON bid_invitations(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_bid_invitations_token ON bid_invitations(tracking_token);
CREATE INDEX IF NOT EXISTS idx_bid_invitations_email ON bid_invitations(to_email);

-- ============================================
-- TRIGGERS
-- ============================================
CREATE TRIGGER update_bid_responses_updated_at BEFORE UPDATE ON bid_responses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- HELPER FUNCTION: Find matching invitation by email
-- ============================================
CREATE OR REPLACE FUNCTION find_invitation_by_email(sender_email VARCHAR)
RETURNS TABLE (
    invitation_id UUID,
    project_id UUID,
    subcontractor_id UUID,
    project_name VARCHAR,
    subcontractor_name VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        bi.id as invitation_id,
        bi.project_id,
        bi.subcontractor_id,
        p.name as project_name,
        s.company_name as subcontractor_name
    FROM bid_invitations bi
    JOIN projects p ON p.id = bi.project_id
    JOIN subcontractors s ON s.id = bi.subcontractor_id
    WHERE LOWER(bi.to_email) = LOWER(sender_email)
       OR LOWER(s.email) = LOWER(sender_email)
    ORDER BY bi.sent_at DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;
