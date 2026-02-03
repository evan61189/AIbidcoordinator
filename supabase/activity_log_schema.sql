-- ============================================
-- ACTIVITY LOG / AUDIT TRAIL SCHEMA
-- Track all important actions in the system
-- ============================================

-- ============================================
-- ACTIVITY LOG TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- What happened
    action VARCHAR(100) NOT NULL,  -- e.g., 'bid_invitation_sent', 'bid_submitted', 'project_created'
    action_category VARCHAR(50) NOT NULL
        CHECK (action_category IN (
            'project', 'bid', 'subcontractor', 'communication',
            'rfi', 'addendum', 'drawing', 'system', 'user'
        )),

    -- Human-readable description
    description TEXT NOT NULL,

    -- Related entities
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE SET NULL,
    bid_id UUID,  -- Not a foreign key to allow logging even if bid deleted
    bid_item_id UUID,
    rfi_id UUID,
    addendum_id UUID,
    drawing_id UUID,

    -- Change details (for updates)
    entity_type VARCHAR(50),  -- 'project', 'bid', 'subcontractor', etc.
    entity_id UUID,
    old_values JSONB,  -- Previous values
    new_values JSONB,  -- New values

    -- Metadata
    ip_address INET,
    user_agent TEXT,
    performed_by VARCHAR(100),  -- User who performed the action

    -- Severity/importance
    importance VARCHAR(20) DEFAULT 'normal'
        CHECK (importance IN ('low', 'normal', 'high', 'critical')),

    -- Timestamp
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_subcontractor ON activity_log(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);
CREATE INDEX IF NOT EXISTS idx_activity_log_category ON activity_log(action_category);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_importance ON activity_log(importance) WHERE importance IN ('high', 'critical');

-- ============================================
-- FUNCTION: Log activity
-- ============================================
CREATE OR REPLACE FUNCTION log_activity(
    p_action VARCHAR,
    p_action_category VARCHAR,
    p_description TEXT,
    p_project_id UUID DEFAULT NULL,
    p_subcontractor_id UUID DEFAULT NULL,
    p_entity_type VARCHAR DEFAULT NULL,
    p_entity_id UUID DEFAULT NULL,
    p_old_values JSONB DEFAULT NULL,
    p_new_values JSONB DEFAULT NULL,
    p_importance VARCHAR DEFAULT 'normal',
    p_performed_by VARCHAR DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO activity_log (
        action,
        action_category,
        description,
        project_id,
        subcontractor_id,
        entity_type,
        entity_id,
        old_values,
        new_values,
        importance,
        performed_by
    )
    VALUES (
        p_action,
        p_action_category,
        p_description,
        p_project_id,
        p_subcontractor_id,
        p_entity_type,
        p_entity_id,
        p_old_values,
        p_new_values,
        p_importance,
        p_performed_by
    )
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGER: Log project changes
-- ============================================
CREATE OR REPLACE FUNCTION log_project_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_activity(
            'project_created',
            'project',
            'Project "' || NEW.name || '" was created',
            NEW.id,
            NULL,
            'project',
            NEW.id,
            NULL,
            to_jsonb(NEW),
            'normal'
        );
    ELSIF TG_OP = 'UPDATE' THEN
        -- Log status changes
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            PERFORM log_activity(
                'project_status_changed',
                'project',
                'Project "' || NEW.name || '" status changed from ' || COALESCE(OLD.status, 'none') || ' to ' || NEW.status,
                NEW.id,
                NULL,
                'project',
                NEW.id,
                jsonb_build_object('status', OLD.status),
                jsonb_build_object('status', NEW.status),
                'high'
            );
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM log_activity(
            'project_deleted',
            'project',
            'Project "' || OLD.name || '" was deleted',
            OLD.id,
            NULL,
            'project',
            OLD.id,
            to_jsonb(OLD),
            NULL,
            'high'
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_log_project_changes ON projects;
CREATE TRIGGER tr_log_project_changes
    AFTER INSERT OR UPDATE OR DELETE ON projects
    FOR EACH ROW EXECUTE FUNCTION log_project_changes();

-- ============================================
-- TRIGGER: Log bid changes
-- ============================================
CREATE OR REPLACE FUNCTION log_bid_changes()
RETURNS TRIGGER AS $$
DECLARE
    v_project_id UUID;
    v_sub_name VARCHAR;
    v_item_desc TEXT;
BEGIN
    -- Get related info
    SELECT bi.project_id, bi.description INTO v_project_id, v_item_desc
    FROM bid_items bi
    WHERE bi.id = COALESCE(NEW.bid_item_id, OLD.bid_item_id);

    SELECT company_name INTO v_sub_name
    FROM subcontractors
    WHERE id = COALESCE(NEW.subcontractor_id, OLD.subcontractor_id);

    IF TG_OP = 'INSERT' THEN
        PERFORM log_activity(
            'bid_created',
            'bid',
            'Bid created for ' || COALESCE(v_sub_name, 'unknown') || ' on "' || COALESCE(v_item_desc, 'item') || '"',
            v_project_id,
            NEW.subcontractor_id,
            'bid',
            NEW.id,
            NULL,
            to_jsonb(NEW)
        );
    ELSIF TG_OP = 'UPDATE' THEN
        -- Log status changes
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            PERFORM log_activity(
                CASE NEW.status
                    WHEN 'invited' THEN 'bid_invitation_sent'
                    WHEN 'submitted' THEN 'bid_submitted'
                    WHEN 'awarded' THEN 'bid_awarded'
                    WHEN 'declined' THEN 'bid_declined'
                    ELSE 'bid_status_changed'
                END,
                'bid',
                'Bid for ' || COALESCE(v_sub_name, 'unknown') || ' ' ||
                CASE NEW.status
                    WHEN 'invited' THEN 'was invited'
                    WHEN 'submitted' THEN 'was submitted' ||
                        CASE WHEN NEW.amount IS NOT NULL THEN ' ($' || NEW.amount::TEXT || ')' ELSE '' END
                    WHEN 'awarded' THEN 'was awarded'
                    WHEN 'declined' THEN 'declined to bid'
                    ELSE 'status changed to ' || NEW.status
                END,
                v_project_id,
                NEW.subcontractor_id,
                'bid',
                NEW.id,
                jsonb_build_object('status', OLD.status, 'amount', OLD.amount),
                jsonb_build_object('status', NEW.status, 'amount', NEW.amount),
                CASE WHEN NEW.status = 'awarded' THEN 'high' ELSE 'normal' END
            );
        END IF;

        -- Log amount changes on submitted bids
        IF OLD.amount IS DISTINCT FROM NEW.amount AND NEW.amount IS NOT NULL THEN
            PERFORM log_activity(
                'bid_amount_updated',
                'bid',
                'Bid amount updated for ' || COALESCE(v_sub_name, 'unknown') ||
                ' from $' || COALESCE(OLD.amount::TEXT, '0') || ' to $' || NEW.amount::TEXT,
                v_project_id,
                NEW.subcontractor_id,
                'bid',
                NEW.id,
                jsonb_build_object('amount', OLD.amount),
                jsonb_build_object('amount', NEW.amount)
            );
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_log_bid_changes ON bids;
CREATE TRIGGER tr_log_bid_changes
    AFTER INSERT OR UPDATE ON bids
    FOR EACH ROW EXECUTE FUNCTION log_bid_changes();

-- ============================================
-- TRIGGER: Log RFI changes
-- ============================================
CREATE OR REPLACE FUNCTION log_rfi_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_activity(
            'rfi_created',
            'rfi',
            'RFI ' || NEW.rfi_number || ' created: "' || NEW.subject || '"',
            NEW.project_id,
            NEW.subcontractor_id,
            'rfi',
            NEW.id,
            NULL,
            to_jsonb(NEW)
        );
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'answered' THEN
            PERFORM log_activity(
                'rfi_answered',
                'rfi',
                'RFI ' || NEW.rfi_number || ' was answered',
                NEW.project_id,
                NEW.subcontractor_id,
                'rfi',
                NEW.id,
                jsonb_build_object('status', OLD.status),
                jsonb_build_object('status', NEW.status, 'response', NEW.response),
                'normal'
            );
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_log_rfi_changes ON rfis;
CREATE TRIGGER tr_log_rfi_changes
    AFTER INSERT OR UPDATE ON rfis
    FOR EACH ROW EXECUTE FUNCTION log_rfi_changes();

-- ============================================
-- TRIGGER: Log addendum changes
-- ============================================
CREATE OR REPLACE FUNCTION log_addendum_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_activity(
            'addendum_created',
            'addendum',
            'Addendum #' || NEW.addendum_number || ' created: "' || NEW.title || '"',
            NEW.project_id,
            NULL,
            'addendum',
            NEW.id,
            NULL,
            to_jsonb(NEW)
        );
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'issued' THEN
            PERFORM log_activity(
                'addendum_issued',
                'addendum',
                'Addendum #' || NEW.addendum_number || ' was issued',
                NEW.project_id,
                NULL,
                'addendum',
                NEW.id,
                jsonb_build_object('status', OLD.status),
                jsonb_build_object('status', NEW.status),
                'high'
            );
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_log_addendum_changes ON addenda;
CREATE TRIGGER tr_log_addendum_changes
    AFTER INSERT OR UPDATE ON addenda
    FOR EACH ROW EXECUTE FUNCTION log_addendum_changes();

-- ============================================
-- VIEW: Recent activity
-- ============================================
CREATE OR REPLACE VIEW recent_activity AS
SELECT
    al.*,
    p.name as project_name,
    s.company_name as subcontractor_name
FROM activity_log al
LEFT JOIN projects p ON p.id = al.project_id
LEFT JOIN subcontractors s ON s.id = al.subcontractor_id
ORDER BY al.created_at DESC;

-- ============================================
-- VIEW: Activity summary by day
-- ============================================
CREATE OR REPLACE VIEW activity_daily_summary AS
SELECT
    DATE(created_at) as activity_date,
    action_category,
    COUNT(*) as total_actions,
    COUNT(DISTINCT project_id) as projects_affected,
    COUNT(DISTINCT subcontractor_id) as subcontractors_involved
FROM activity_log
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at), action_category
ORDER BY activity_date DESC, action_category;
