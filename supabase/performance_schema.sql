-- ============================================
-- SUBCONTRACTOR PERFORMANCE TRACKING SCHEMA
-- Track historical performance metrics
-- ============================================

-- ============================================
-- PERFORMANCE REVIEWS TABLE
-- Store individual project performance reviews
-- ============================================
CREATE TABLE IF NOT EXISTS subcontractor_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE CASCADE NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,

    -- Review details
    review_date DATE DEFAULT CURRENT_DATE,
    reviewer_name VARCHAR(100),

    -- Ratings (1-5 scale)
    pricing_competitiveness INTEGER CHECK (pricing_competitiveness BETWEEN 1 AND 5),
    response_time INTEGER CHECK (response_time BETWEEN 1 AND 5),
    bid_completeness INTEGER CHECK (bid_completeness BETWEEN 1 AND 5),
    communication INTEGER CHECK (communication BETWEEN 1 AND 5),
    overall_rating INTEGER CHECK (overall_rating BETWEEN 1 AND 5),

    -- Additional metrics
    met_deadline BOOLEAN,
    required_followup BOOLEAN,
    bid_was_competitive BOOLEAN,
    was_awarded BOOLEAN,
    would_invite_again BOOLEAN,

    -- Notes
    strengths TEXT,
    areas_for_improvement TEXT,
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PERFORMANCE METRICS TABLE
-- Calculated/cached performance metrics
-- ============================================
CREATE TABLE IF NOT EXISTS subcontractor_performance (
    subcontractor_id UUID PRIMARY KEY REFERENCES subcontractors(id) ON DELETE CASCADE,

    -- Bid statistics
    total_invitations INTEGER DEFAULT 0,
    total_responses INTEGER DEFAULT 0,
    response_rate DECIMAL(5, 2) DEFAULT 0,  -- Percentage

    -- Timing
    avg_response_days DECIMAL(5, 2),  -- Average days to respond
    on_time_percentage DECIMAL(5, 2),  -- Percentage of bids submitted on time

    -- Pricing
    times_lowest_bidder INTEGER DEFAULT 0,
    times_in_top_3 INTEGER DEFAULT 0,
    avg_price_variance DECIMAL(5, 2),  -- Average % from lowest bid

    -- Awards
    total_awarded INTEGER DEFAULT 0,
    award_rate DECIMAL(5, 2) DEFAULT 0,  -- Percentage of bids that won

    -- Quality
    avg_bid_completeness DECIMAL(3, 2),  -- 1-5 scale
    avg_communication_score DECIMAL(3, 2),  -- 1-5 scale
    overall_score DECIMAL(3, 2),  -- Calculated overall score

    -- Reliability
    followup_required_rate DECIMAL(5, 2),  -- How often followup was needed

    -- Recent activity
    last_invitation_date DATE,
    last_response_date DATE,
    last_award_date DATE,

    -- Counts by status
    invitations_last_90_days INTEGER DEFAULT 0,
    responses_last_90_days INTEGER DEFAULT 0,

    -- Timestamps
    last_calculated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- UPDATE SUBCONTRACTORS TABLE
-- Add performance-related fields
-- ============================================
ALTER TABLE subcontractors
    ADD COLUMN IF NOT EXISTS performance_tier VARCHAR(20) DEFAULT 'standard'
        CHECK (performance_tier IN ('preferred', 'standard', 'probation', 'inactive')),
    ADD COLUMN IF NOT EXISTS internal_notes TEXT,
    ADD COLUMN IF NOT EXISTS last_review_date DATE,
    ADD COLUMN IF NOT EXISTS next_review_date DATE;

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_sub_reviews_sub ON subcontractor_reviews(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_sub_reviews_project ON subcontractor_reviews(project_id);
CREATE INDEX IF NOT EXISTS idx_sub_reviews_date ON subcontractor_reviews(review_date);
CREATE INDEX IF NOT EXISTS idx_sub_performance_score ON subcontractor_performance(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_sub_performance_response_rate ON subcontractor_performance(response_rate DESC);

-- ============================================
-- TRIGGERS
-- ============================================
CREATE TRIGGER update_sub_reviews_updated_at BEFORE UPDATE ON subcontractor_reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sub_performance_updated_at BEFORE UPDATE ON subcontractor_performance
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- FUNCTION: Calculate subcontractor performance
-- ============================================
CREATE OR REPLACE FUNCTION calculate_subcontractor_performance(p_subcontractor_id UUID)
RETURNS VOID AS $$
DECLARE
    v_stats RECORD;
    v_review_stats RECORD;
BEGIN
    -- Calculate bid statistics
    SELECT
        COUNT(*) FILTER (WHERE status IN ('invited', 'submitted', 'declined')) as total_invitations,
        COUNT(*) FILTER (WHERE status = 'submitted') as total_responses,
        COUNT(*) FILTER (WHERE status = 'awarded') as total_awarded,
        ROUND(
            COUNT(*) FILTER (WHERE status = 'submitted')::NUMERIC /
            NULLIF(COUNT(*) FILTER (WHERE status IN ('invited', 'submitted', 'declined')), 0) * 100,
            2
        ) as response_rate,
        ROUND(
            COUNT(*) FILTER (WHERE status = 'awarded')::NUMERIC /
            NULLIF(COUNT(*) FILTER (WHERE status = 'submitted'), 0) * 100,
            2
        ) as award_rate,
        MAX(invitation_sent_at)::DATE as last_invitation_date,
        MAX(submitted_at)::DATE as last_response_date,
        MAX(CASE WHEN status = 'awarded' THEN submitted_at END)::DATE as last_award_date,
        COUNT(*) FILTER (
            WHERE invitation_sent_at > NOW() - INTERVAL '90 days'
        ) as invitations_last_90_days,
        COUNT(*) FILTER (
            WHERE status = 'submitted' AND submitted_at > NOW() - INTERVAL '90 days'
        ) as responses_last_90_days
    INTO v_stats
    FROM bids
    WHERE subcontractor_id = p_subcontractor_id;

    -- Calculate review averages
    SELECT
        ROUND(AVG(bid_completeness), 2) as avg_bid_completeness,
        ROUND(AVG(communication), 2) as avg_communication_score,
        ROUND(AVG(overall_rating), 2) as avg_overall,
        ROUND(
            COUNT(*) FILTER (WHERE required_followup = TRUE)::NUMERIC /
            NULLIF(COUNT(*), 0) * 100,
            2
        ) as followup_rate
    INTO v_review_stats
    FROM subcontractor_reviews
    WHERE subcontractor_id = p_subcontractor_id;

    -- Upsert performance record
    INSERT INTO subcontractor_performance (
        subcontractor_id,
        total_invitations,
        total_responses,
        response_rate,
        total_awarded,
        award_rate,
        avg_bid_completeness,
        avg_communication_score,
        overall_score,
        followup_required_rate,
        last_invitation_date,
        last_response_date,
        last_award_date,
        invitations_last_90_days,
        responses_last_90_days,
        last_calculated_at
    )
    VALUES (
        p_subcontractor_id,
        COALESCE(v_stats.total_invitations, 0),
        COALESCE(v_stats.total_responses, 0),
        COALESCE(v_stats.response_rate, 0),
        COALESCE(v_stats.total_awarded, 0),
        COALESCE(v_stats.award_rate, 0),
        COALESCE(v_review_stats.avg_bid_completeness, 3),
        COALESCE(v_review_stats.avg_communication_score, 3),
        COALESCE(v_review_stats.avg_overall, 3),
        COALESCE(v_review_stats.followup_rate, 0),
        v_stats.last_invitation_date,
        v_stats.last_response_date,
        v_stats.last_award_date,
        COALESCE(v_stats.invitations_last_90_days, 0),
        COALESCE(v_stats.responses_last_90_days, 0),
        NOW()
    )
    ON CONFLICT (subcontractor_id) DO UPDATE SET
        total_invitations = EXCLUDED.total_invitations,
        total_responses = EXCLUDED.total_responses,
        response_rate = EXCLUDED.response_rate,
        total_awarded = EXCLUDED.total_awarded,
        award_rate = EXCLUDED.award_rate,
        avg_bid_completeness = EXCLUDED.avg_bid_completeness,
        avg_communication_score = EXCLUDED.avg_communication_score,
        overall_score = EXCLUDED.overall_score,
        followup_required_rate = EXCLUDED.followup_required_rate,
        last_invitation_date = EXCLUDED.last_invitation_date,
        last_response_date = EXCLUDED.last_response_date,
        last_award_date = EXCLUDED.last_award_date,
        invitations_last_90_days = EXCLUDED.invitations_last_90_days,
        responses_last_90_days = EXCLUDED.responses_last_90_days,
        last_calculated_at = NOW(),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEW: Subcontractor performance leaderboard
-- ============================================
CREATE OR REPLACE VIEW subcontractor_leaderboard AS
SELECT
    s.id,
    s.company_name,
    s.performance_tier,
    s.is_preferred,
    sp.total_invitations,
    sp.total_responses,
    sp.response_rate,
    sp.total_awarded,
    sp.award_rate,
    sp.overall_score,
    sp.invitations_last_90_days,
    sp.responses_last_90_days,
    sp.last_response_date,
    RANK() OVER (ORDER BY sp.overall_score DESC NULLS LAST, sp.response_rate DESC) as rank
FROM subcontractors s
LEFT JOIN subcontractor_performance sp ON sp.subcontractor_id = s.id
WHERE s.is_active = TRUE
ORDER BY sp.overall_score DESC NULLS LAST, sp.response_rate DESC;

-- ============================================
-- VIEW: Performance by trade
-- ============================================
CREATE OR REPLACE VIEW trade_performance_summary AS
SELECT
    t.id as trade_id,
    t.name as trade_name,
    t.division_code,
    COUNT(DISTINCT st.subcontractor_id) as total_subs,
    COUNT(DISTINCT st.subcontractor_id) FILTER (
        WHERE sp.response_rate >= 50
    ) as responsive_subs,
    ROUND(AVG(sp.response_rate), 1) as avg_response_rate,
    ROUND(AVG(sp.overall_score), 2) as avg_score
FROM trades t
LEFT JOIN subcontractor_trades st ON st.trade_id = t.id
LEFT JOIN subcontractor_performance sp ON sp.subcontractor_id = st.subcontractor_id
LEFT JOIN subcontractors s ON s.id = st.subcontractor_id AND s.is_active = TRUE
GROUP BY t.id, t.name, t.division_code
ORDER BY t.division_code;
