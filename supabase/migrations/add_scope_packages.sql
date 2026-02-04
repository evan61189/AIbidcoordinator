-- Scope Packages for Bid Leveling
-- Allows grouping bid items together for apples-to-apples comparison
-- Example: "Complete Electrical" package might include Wiring, Low Voltage, and Fire Alarm

-- ============================================
-- SCOPE PACKAGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS scope_packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    color VARCHAR(20) DEFAULT '#6366f1', -- For UI highlighting
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SCOPE PACKAGE ITEMS (Many-to-Many with bid_items)
-- ============================================
CREATE TABLE IF NOT EXISTS scope_package_items (
    scope_package_id UUID REFERENCES scope_packages(id) ON DELETE CASCADE,
    bid_item_id UUID REFERENCES bid_items(id) ON DELETE CASCADE,
    PRIMARY KEY (scope_package_id, bid_item_id)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_scope_packages_project ON scope_packages(project_id);
CREATE INDEX IF NOT EXISTS idx_scope_package_items_package ON scope_package_items(scope_package_id);
CREATE INDEX IF NOT EXISTS idx_scope_package_items_item ON scope_package_items(bid_item_id);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
DROP TRIGGER IF EXISTS update_scope_packages_updated_at ON scope_packages;
CREATE TRIGGER update_scope_packages_updated_at BEFORE UPDATE ON scope_packages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
