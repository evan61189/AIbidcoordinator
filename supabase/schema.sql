-- AIbidcoordinator Database Schema for Supabase
-- Run this in the Supabase SQL Editor to set up your database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TRADES TABLE (CSI Divisions)
-- ============================================
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    division_code VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_custom BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert standard CSI MasterFormat divisions
INSERT INTO trades (division_code, name, description, is_custom) VALUES
    ('01', 'General Requirements', 'Administrative and procedural requirements', false),
    ('02', 'Existing Conditions', 'Site assessment, demolition, hazmat abatement', false),
    ('03', 'Concrete', 'Cast-in-place, precast, concrete finishing', false),
    ('04', 'Masonry', 'Unit masonry, stone assemblies, masonry restoration', false),
    ('05', 'Metals', 'Structural steel, metal fabrications, ornamental metal', false),
    ('06', 'Wood, Plastics, and Composites', 'Rough and finish carpentry, millwork', false),
    ('07', 'Thermal and Moisture Protection', 'Waterproofing, insulation, roofing, siding', false),
    ('08', 'Openings', 'Doors, windows, entrances, storefronts, glazing', false),
    ('09', 'Finishes', 'Plaster, drywall, tile, flooring, painting', false),
    ('10', 'Specialties', 'Signage, compartments, lockers, fire protection specialties', false),
    ('11', 'Equipment', 'Commercial equipment, food service, athletic equipment', false),
    ('12', 'Furnishings', 'Art, window treatments, furniture, casework', false),
    ('13', 'Special Construction', 'Swimming pools, aquariums, special structures', false),
    ('14', 'Conveying Equipment', 'Elevators, escalators, lifts, hoists', false),
    ('21', 'Fire Suppression', 'Fire sprinkler systems, standpipes, fire pumps', false),
    ('22', 'Plumbing', 'Plumbing fixtures, piping, drainage', false),
    ('23', 'HVAC', 'Heating, ventilation, air conditioning, controls', false),
    ('25', 'Integrated Automation', 'Building automation, control systems', false),
    ('26', 'Electrical', 'Power distribution, lighting, communications infrastructure', false),
    ('27', 'Communications', 'Data, voice, audio-visual systems', false),
    ('28', 'Electronic Safety and Security', 'Access control, surveillance, fire detection', false),
    ('31', 'Earthwork', 'Site clearing, grading, excavation, fill', false),
    ('32', 'Exterior Improvements', 'Paving, fencing, landscaping, irrigation', false),
    ('33', 'Utilities', 'Water, sanitary, storm, gas, electrical utilities', false)
ON CONFLICT (division_code) DO NOTHING;

-- ============================================
-- SUBCONTRACTORS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS subcontractors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(200) NOT NULL,
    contact_name VARCHAR(100),
    email VARCHAR(120),
    phone VARCHAR(20),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    license_number VARCHAR(50),
    insurance_expiry DATE,
    bonding_capacity DECIMAL(15, 2),
    notes TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    is_preferred BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SUBCONTRACTOR TRADES (Many-to-Many)
-- ============================================
CREATE TABLE IF NOT EXISTS subcontractor_trades (
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE CASCADE,
    trade_id UUID REFERENCES trades(id) ON DELETE CASCADE,
    PRIMARY KEY (subcontractor_id, trade_id)
);

-- ============================================
-- PROJECTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    project_number VARCHAR(50) UNIQUE,
    description TEXT,
    location VARCHAR(300),
    client_name VARCHAR(200),
    client_contact VARCHAR(100),
    client_email VARCHAR(120),
    client_phone VARCHAR(20),
    estimated_value DECIMAL(15, 2),
    bid_date DATE,
    start_date DATE,
    completion_date DATE,
    status VARCHAR(50) DEFAULT 'bidding' CHECK (status IN ('bidding', 'awarded', 'in_progress', 'completed', 'lost')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PROJECT SUBCONTRACTORS (Invited subs)
-- ============================================
CREATE TABLE IF NOT EXISTS project_subcontractors (
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE CASCADE,
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (project_id, subcontractor_id)
);

-- ============================================
-- DRAWINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS drawings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255),
    drawing_number VARCHAR(50),
    title VARCHAR(200),
    discipline VARCHAR(50),
    revision VARCHAR(20),
    revision_date DATE,
    sheet_size VARCHAR(20),
    file_type VARCHAR(10),
    file_size INTEGER,
    storage_path TEXT,
    notes TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BID ITEMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS bid_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    trade_id UUID REFERENCES trades(id) NOT NULL,
    item_number VARCHAR(20),
    description TEXT NOT NULL,
    scope_details TEXT,
    quantity VARCHAR(50),
    unit VARCHAR(20),
    estimated_cost DECIMAL(15, 2),
    bid_due_date DATE,
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'closed', 'awarded')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BIDS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS bids (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_item_id UUID REFERENCES bid_items(id) ON DELETE CASCADE NOT NULL,
    subcontractor_id UUID REFERENCES subcontractors(id) NOT NULL,
    amount DECIMAL(15, 2),
    unit_price DECIMAL(15, 2),
    includes TEXT,
    excludes TEXT,
    clarifications TEXT,
    alternates TEXT,
    lead_time VARCHAR(50),
    valid_until DATE,
    status VARCHAR(50) DEFAULT 'invited' CHECK (status IN ('invited', 'submitted', 'accepted', 'rejected', 'withdrawn')),
    invitation_sent_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    attachment_path TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- COMMUNICATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS communications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE CASCADE NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    comm_type VARCHAR(50) NOT NULL CHECK (comm_type IN ('email', 'phone', 'meeting', 'site_visit')),
    direction VARCHAR(20) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    subject VARCHAR(300),
    content TEXT,
    contact_person VARCHAR(100),
    status VARCHAR(50) DEFAULT 'sent',
    follow_up_date DATE,
    follow_up_notes TEXT,
    attachment_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BID SHEETS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS bid_sheets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    title VARCHAR(200) NOT NULL,
    version INTEGER DEFAULT 1,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    file_path TEXT,
    notes TEXT
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_subcontractors_active ON subcontractors(is_active);
CREATE INDEX IF NOT EXISTS idx_subcontractors_company ON subcontractors(company_name);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_bid_date ON projects(bid_date);
CREATE INDEX IF NOT EXISTS idx_bid_items_project ON bid_items(project_id);
CREATE INDEX IF NOT EXISTS idx_bid_items_trade ON bid_items(trade_id);
CREATE INDEX IF NOT EXISTS idx_bid_items_status ON bid_items(status);
CREATE INDEX IF NOT EXISTS idx_bids_status ON bids(status);
CREATE INDEX IF NOT EXISTS idx_bids_item ON bids(bid_item_id);
CREATE INDEX IF NOT EXISTS idx_bids_subcontractor ON bids(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_communications_subcontractor ON communications(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_communications_project ON communications(project_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS) - Optional
-- ============================================
-- Uncomment these if you want to enable RLS for multi-tenant support

-- ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE subcontractors ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE bid_items ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE communications ENABLE ROW LEVEL SECURITY;

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_subcontractors_updated_at BEFORE UPDATE ON subcontractors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bid_items_updated_at BEFORE UPDATE ON bid_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bids_updated_at BEFORE UPDATE ON bids
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
