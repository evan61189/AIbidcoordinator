-- ============================================
-- EMAIL TEMPLATES SCHEMA
-- Store reusable email templates
-- ============================================

-- ============================================
-- EMAIL TEMPLATES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS email_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Template identification
    name VARCHAR(100) NOT NULL,
    description TEXT,

    -- Template type/category
    template_type VARCHAR(50) NOT NULL
        CHECK (template_type IN (
            'bid_invitation',
            'bid_reminder',
            'addendum_notification',
            'rfi_response',
            'award_notification',
            'rejection_notification',
            'general',
            'custom'
        )),

    -- Content
    subject VARCHAR(255) NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,  -- Plain text version

    -- Variables available in this template
    -- These are hints for the UI about what placeholders can be used
    available_variables JSONB DEFAULT '[]',  -- ['project_name', 'due_date', etc.]

    -- Metadata
    is_default BOOLEAN DEFAULT FALSE,  -- Default template for this type
    is_active BOOLEAN DEFAULT TRUE,
    use_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,

    -- Ownership
    created_by VARCHAR(100),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INSERT DEFAULT TEMPLATES
-- ============================================
INSERT INTO email_templates (name, description, template_type, subject, body_html, body_text, available_variables, is_default) VALUES
(
    'Standard Bid Invitation',
    'Default template for inviting subcontractors to bid',
    'bid_invitation',
    'Invitation to Bid: {{project_name}}',
    '<p>Dear {{contact_name}},</p>

<p>{{company_name}} is pleased to invite you to submit a bid for the following project:</p>

<h3>{{project_name}}</h3>
<p><strong>Location:</strong> {{project_location}}<br>
<strong>Bid Due Date:</strong> {{due_date}}</p>

{{#if custom_message}}
<p>{{custom_message}}</p>
{{/if}}

{{#if bid_items}}
<h4>Scope of Work</h4>
<p>Please provide pricing for the following items:</p>
{{bid_items_table}}
{{/if}}

<h4>Bid Requirements</h4>
<ul>
<li>Total lump sum price</li>
<li>Itemized breakdown</li>
<li>List of inclusions and exclusions</li>
<li>Lead time / delivery schedule</li>
<li>Any clarifications or alternates</li>
</ul>

<p>If you have any questions, please contact:<br>
{{sender_name}}<br>
{{sender_email}}<br>
{{sender_phone}}</p>

<p>Thank you for your interest.</p>

<p>Best regards,<br>
{{sender_name}}</p>',
    'Dear {{contact_name}},

{{company_name}} is pleased to invite you to submit a bid for {{project_name}}.

Location: {{project_location}}
Bid Due Date: {{due_date}}

Please submit your bid including:
- Total lump sum price
- Itemized breakdown
- Inclusions and exclusions
- Lead time

Contact: {{sender_name}}
Email: {{sender_email}}
Phone: {{sender_phone}}

Thank you,
{{sender_name}}',
    '["project_name", "project_location", "contact_name", "company_name", "due_date", "custom_message", "bid_items", "sender_name", "sender_email", "sender_phone"]',
    TRUE
),
(
    'Friendly Reminder',
    'A friendly follow-up reminder for pending bids',
    'bid_reminder',
    'Reminder: Bid Request for {{project_name}}',
    '<p>Dear {{contact_name}},</p>

<p>This is a friendly reminder about our bid request for <strong>{{project_name}}</strong>.</p>

<p>We would appreciate receiving your proposal at your earliest convenience.</p>

<p><strong>Due Date:</strong> {{due_date}}</p>

<p>If you have already submitted your bid, please disregard this message. If you have any questions or need additional information, please don''t hesitate to reach out.</p>

<p>Best regards,<br>
{{sender_name}}</p>',
    'Dear {{contact_name}},

This is a friendly reminder about our bid request for {{project_name}}.

Due Date: {{due_date}}

If you have already submitted your bid, please disregard this message.

Best regards,
{{sender_name}}',
    '["project_name", "contact_name", "due_date", "sender_name"]',
    TRUE
),
(
    'Urgent Reminder',
    'Urgent reminder for bids due soon',
    'bid_reminder',
    'URGENT: Bid Due Tomorrow - {{project_name}}',
    '<p>Dear {{contact_name}},</p>

<p><strong>URGENT:</strong> This is a final reminder that bids for <strong>{{project_name}}</strong> are due <strong>{{due_date}}</strong>.</p>

<p>If you intend to submit a bid, please ensure it is received before the deadline.</p>

<p>If you are unable to bid or have already submitted, please let us know.</p>

<p>Thank you,<br>
{{sender_name}}</p>',
    'URGENT: Bids for {{project_name}} are due {{due_date}}.

Please submit before the deadline.

{{sender_name}}',
    '["project_name", "contact_name", "due_date", "sender_name"]',
    FALSE
),
(
    'Addendum Notification',
    'Notify bidders of a new addendum',
    'addendum_notification',
    'Addendum #{{addendum_number}} Issued - {{project_name}}',
    '<p>Dear {{contact_name}},</p>

<p>Please be advised that <strong>Addendum #{{addendum_number}}</strong> has been issued for <strong>{{project_name}}</strong>.</p>

<h4>{{addendum_title}}</h4>

{{#if addendum_summary}}
<p><strong>Summary:</strong> {{addendum_summary}}</p>
{{/if}}

{{#if new_bid_date}}
<p><strong>IMPORTANT:</strong> The bid due date has been extended to <strong>{{new_bid_date}}</strong>.</p>
{{/if}}

<p>Please acknowledge receipt of this addendum by replying to this email.</p>

<p>Best regards,<br>
{{sender_name}}</p>',
    'Addendum #{{addendum_number}} has been issued for {{project_name}}.

{{addendum_title}}

{{#if new_bid_date}}New Bid Date: {{new_bid_date}}{{/if}}

Please acknowledge receipt.

{{sender_name}}',
    '["project_name", "addendum_number", "addendum_title", "addendum_summary", "new_bid_date", "contact_name", "sender_name"]',
    TRUE
),
(
    'Award Notification',
    'Notify subcontractor of contract award',
    'award_notification',
    'Contract Award - {{project_name}}',
    '<p>Dear {{contact_name}},</p>

<p>We are pleased to inform you that <strong>{{subcontractor_name}}</strong> has been selected for the following scope on <strong>{{project_name}}</strong>:</p>

<p><strong>Scope:</strong> {{scope_description}}<br>
<strong>Contract Amount:</strong> {{contract_amount}}</p>

<p>Our contracts department will be in touch shortly with the formal subcontract agreement.</p>

<p>We look forward to working with you on this project.</p>

<p>Congratulations and best regards,<br>
{{sender_name}}</p>',
    'Congratulations!

{{subcontractor_name}} has been awarded the contract for {{scope_description}} on {{project_name}}.

Contract Amount: {{contract_amount}}

We will send the formal agreement shortly.

Best regards,
{{sender_name}}',
    '["project_name", "subcontractor_name", "scope_description", "contract_amount", "contact_name", "sender_name"]',
    TRUE
),
(
    'Rejection Notification',
    'Notify unsuccessful bidders',
    'rejection_notification',
    'Bid Status Update - {{project_name}}',
    '<p>Dear {{contact_name}},</p>

<p>Thank you for submitting your bid for <strong>{{project_name}}</strong>.</p>

<p>After careful review of all proposals received, we regret to inform you that your bid was not selected for this project.</p>

<p>We appreciate your time and effort in preparing this proposal and hope to have the opportunity to work with you on future projects.</p>

<p>Thank you for your interest.</p>

<p>Best regards,<br>
{{sender_name}}</p>',
    'Thank you for your bid on {{project_name}}.

After review, your bid was not selected for this project.

We hope to work with you on future projects.

Best regards,
{{sender_name}}',
    '["project_name", "contact_name", "sender_name"]',
    TRUE
)
ON CONFLICT DO NOTHING;

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_email_templates_type ON email_templates(template_type);
CREATE INDEX IF NOT EXISTS idx_email_templates_active ON email_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_email_templates_default ON email_templates(template_type, is_default) WHERE is_default = TRUE;

-- ============================================
-- TRIGGERS
-- ============================================
CREATE TRIGGER update_email_templates_updated_at BEFORE UPDATE ON email_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- FUNCTION: Get default template for type
-- ============================================
CREATE OR REPLACE FUNCTION get_default_template(p_template_type VARCHAR)
RETURNS email_templates AS $$
DECLARE
    v_template email_templates;
BEGIN
    SELECT * INTO v_template
    FROM email_templates
    WHERE template_type = p_template_type
      AND is_default = TRUE
      AND is_active = TRUE
    LIMIT 1;

    RETURN v_template;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Increment template use count
-- ============================================
CREATE OR REPLACE FUNCTION increment_template_usage(p_template_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE email_templates
    SET use_count = use_count + 1,
        last_used_at = NOW()
    WHERE id = p_template_id;
END;
$$ LANGUAGE plpgsql;
