-- ============================================
-- AUTOMATED FOLLOW-UP REMINDERS SCHEMA
-- Handles reminder preferences and tracking
-- ============================================

-- ============================================
-- REMINDER SETTINGS TABLE
-- Global settings for automated reminders
-- ============================================
CREATE TABLE IF NOT EXISTS reminder_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Reminder timing
    first_reminder_days INTEGER DEFAULT 3,  -- Days after invitation to send first reminder
    second_reminder_days INTEGER DEFAULT 5, -- Days after invitation to send second reminder
    final_reminder_days INTEGER DEFAULT 7,  -- Days after invitation to send final reminder

    -- Max reminders
    max_reminders INTEGER DEFAULT 3,

    -- Auto-send settings
    auto_send_enabled BOOLEAN DEFAULT FALSE,
    send_time TIME DEFAULT '09:00:00',  -- Time of day to send reminders (in user's timezone)
    timezone VARCHAR(50) DEFAULT 'America/Los_Angeles',

    -- Days to send (array of weekday numbers, 0=Sunday, 1=Monday, etc.)
    send_days INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5],  -- Weekdays by default

    -- Email settings
    reminder_subject_template VARCHAR(255) DEFAULT 'Reminder: Bid Request for {{project_name}}',
    reminder_message_template TEXT DEFAULT 'This is a friendly reminder about our bid request for {{project_name}}. We would appreciate receiving your proposal at your earliest convenience.',

    -- Notifications
    notify_on_send BOOLEAN DEFAULT TRUE,
    notification_email VARCHAR(255),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings if none exist
INSERT INTO reminder_settings (id)
SELECT uuid_generate_v4()
WHERE NOT EXISTS (SELECT 1 FROM reminder_settings);

-- ============================================
-- REMINDER HISTORY TABLE
-- Track all reminders sent
-- ============================================
CREATE TABLE IF NOT EXISTS reminder_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Links
    bid_id UUID REFERENCES bids(id) ON DELETE CASCADE,
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE CASCADE NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    bid_item_id UUID REFERENCES bid_items(id) ON DELETE SET NULL,

    -- Reminder details
    reminder_number INTEGER NOT NULL,  -- 1st, 2nd, 3rd, etc.
    reminder_type VARCHAR(50) DEFAULT 'automatic'
        CHECK (reminder_type IN ('automatic', 'manual', 'scheduled')),

    -- Email details
    to_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255),
    message TEXT,

    -- Status
    status VARCHAR(50) DEFAULT 'sent'
        CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    error_message TEXT,

    -- Response tracking
    response_received BOOLEAN DEFAULT FALSE,
    response_received_at TIMESTAMPTZ,

    sent_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- REMINDER QUEUE TABLE
-- Queue for scheduled reminders
-- ============================================
CREATE TABLE IF NOT EXISTS reminder_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Links
    bid_id UUID REFERENCES bids(id) ON DELETE CASCADE NOT NULL,
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE CASCADE NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,

    -- Schedule
    scheduled_for TIMESTAMPTZ NOT NULL,
    reminder_number INTEGER NOT NULL,

    -- Status
    status VARCHAR(50) DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),

    -- Processing
    processed_at TIMESTAMPTZ,
    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint to prevent duplicate reminders
    UNIQUE(bid_id, reminder_number)
);

-- ============================================
-- UPDATE BIDS TABLE FOR REMINDER TRACKING
-- ============================================
ALTER TABLE bids
    ADD COLUMN IF NOT EXISTS reminder_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_reminder_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reminders_paused BOOLEAN DEFAULT FALSE;

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_reminder_history_bid ON reminder_history(bid_id);
CREATE INDEX IF NOT EXISTS idx_reminder_history_sub ON reminder_history(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_reminder_history_project ON reminder_history(project_id);
CREATE INDEX IF NOT EXISTS idx_reminder_history_sent_at ON reminder_history(sent_at);
CREATE INDEX IF NOT EXISTS idx_reminder_queue_scheduled ON reminder_queue(scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_reminder_queue_bid ON reminder_queue(bid_id);
CREATE INDEX IF NOT EXISTS idx_bids_next_reminder ON bids(next_reminder_at) WHERE status = 'invited' AND reminders_paused = FALSE;

-- ============================================
-- TRIGGERS
-- ============================================
CREATE TRIGGER update_reminder_settings_updated_at BEFORE UPDATE ON reminder_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- FUNCTION: Schedule next reminder for a bid
-- ============================================
CREATE OR REPLACE FUNCTION schedule_bid_reminder(p_bid_id UUID)
RETURNS VOID AS $$
DECLARE
    v_settings reminder_settings%ROWTYPE;
    v_bid bids%ROWTYPE;
    v_next_reminder_days INTEGER;
    v_next_reminder_at TIMESTAMPTZ;
BEGIN
    -- Get settings
    SELECT * INTO v_settings FROM reminder_settings LIMIT 1;

    -- Get bid
    SELECT * INTO v_bid FROM bids WHERE id = p_bid_id;

    IF v_bid.status != 'invited' OR v_bid.reminders_paused THEN
        RETURN;
    END IF;

    -- Determine next reminder timing
    IF v_bid.reminder_count = 0 THEN
        v_next_reminder_days := v_settings.first_reminder_days;
    ELSIF v_bid.reminder_count = 1 THEN
        v_next_reminder_days := v_settings.second_reminder_days;
    ELSIF v_bid.reminder_count = 2 THEN
        v_next_reminder_days := v_settings.final_reminder_days;
    ELSE
        -- Max reminders reached
        UPDATE bids SET next_reminder_at = NULL WHERE id = p_bid_id;
        RETURN;
    END IF;

    -- Calculate next reminder date from invitation sent date
    v_next_reminder_at := v_bid.invitation_sent_at + (v_next_reminder_days || ' days')::INTERVAL;

    -- Update bid
    UPDATE bids SET next_reminder_at = v_next_reminder_at WHERE id = p_bid_id;

    -- Add to queue if auto-send enabled
    IF v_settings.auto_send_enabled THEN
        INSERT INTO reminder_queue (bid_id, subcontractor_id, project_id, scheduled_for, reminder_number)
        SELECT
            v_bid.id,
            v_bid.subcontractor_id,
            bi.project_id,
            v_next_reminder_at,
            v_bid.reminder_count + 1
        FROM bid_items bi
        WHERE bi.id = v_bid.bid_item_id
        ON CONFLICT (bid_id, reminder_number) DO UPDATE SET
            scheduled_for = EXCLUDED.scheduled_for,
            status = 'pending';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Get bids needing reminders
-- ============================================
CREATE OR REPLACE FUNCTION get_bids_needing_reminders()
RETURNS TABLE (
    bid_id UUID,
    subcontractor_id UUID,
    subcontractor_name VARCHAR,
    subcontractor_email VARCHAR,
    project_id UUID,
    project_name VARCHAR,
    bid_item_description TEXT,
    invitation_sent_at TIMESTAMPTZ,
    days_waiting INTEGER,
    reminder_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id as bid_id,
        b.subcontractor_id,
        s.company_name as subcontractor_name,
        s.email as subcontractor_email,
        p.id as project_id,
        p.name as project_name,
        bi.description as bid_item_description,
        b.invitation_sent_at,
        EXTRACT(DAY FROM NOW() - b.invitation_sent_at)::INTEGER as days_waiting,
        b.reminder_count
    FROM bids b
    JOIN subcontractors s ON s.id = b.subcontractor_id
    JOIN bid_items bi ON bi.id = b.bid_item_id
    JOIN projects p ON p.id = bi.project_id
    WHERE b.status = 'invited'
      AND b.reminders_paused = FALSE
      AND s.email IS NOT NULL
      AND (b.next_reminder_at IS NULL OR b.next_reminder_at <= NOW())
    ORDER BY b.invitation_sent_at ASC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEW: Reminder dashboard stats
-- ============================================
CREATE OR REPLACE VIEW reminder_dashboard AS
SELECT
    (SELECT COUNT(*) FROM bids WHERE status = 'invited') as total_pending,
    (SELECT COUNT(*) FROM bids WHERE status = 'invited' AND reminder_count = 0
        AND invitation_sent_at < NOW() - INTERVAL '3 days') as needs_first_reminder,
    (SELECT COUNT(*) FROM bids WHERE status = 'invited' AND reminder_count = 1
        AND last_reminder_at < NOW() - INTERVAL '2 days') as needs_second_reminder,
    (SELECT COUNT(*) FROM bids WHERE status = 'invited' AND reminder_count >= 2
        AND last_reminder_at < NOW() - INTERVAL '2 days') as needs_final_reminder,
    (SELECT COUNT(*) FROM reminder_queue WHERE status = 'pending'
        AND scheduled_for <= NOW()) as queue_ready,
    (SELECT COUNT(*) FROM reminder_history WHERE sent_at > NOW() - INTERVAL '24 hours') as sent_today,
    (SELECT COUNT(*) FROM reminder_history WHERE sent_at > NOW() - INTERVAL '7 days') as sent_this_week;
