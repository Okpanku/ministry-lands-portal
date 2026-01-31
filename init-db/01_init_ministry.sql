-- ==========================================
-- 1. SYSTEM SETUP & EXTENSIONS
-- ==========================================
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==========================================
-- 2. CORE TABLES (Authoritative Registry)
-- ==========================================

-- Land Plots: The spatial source of truth
CREATE TABLE land_plots (
    plot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unique_plot_no VARCHAR(50) UNIQUE NOT NULL,
    geometry GEOMETRY(Polygon, 26331) NOT NULL, -- Minna / UTM zone 31N
    zoning_class VARCHAR(20) CHECK (zoning_class IN ('Residential', 'Commercial', 'Industrial', 'Public')),
    area_sqm DECIMAL(12,2),
    application_lock BOOLEAN DEFAULT FALSE, -- Prevents duplicate apps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Applications: The Workflow engine
CREATE TABLE applications (
    application_id SERIAL PRIMARY KEY,
    plot_id UUID REFERENCES land_plots(plot_id),
    applicant_name VARCHAR(255),
    status VARCHAR(30) DEFAULT 'PENDING',
    stage VARCHAR(50) DEFAULT 'STAGE_1_SUBMITTED',
    building_footprint GEOMETRY(Polygon, 26331),
    gis_cleared BOOLEAN DEFAULT FALSE,
    encroachment_ok BOOLEAN DEFAULT FALSE,
    plot_coverage_ratio DECIMAL(5,4),
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP WITH TIME ZONE
);

-- Audit Logs: The Immutable Record
CREATE TABLE audit_logs (
    audit_id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    action TEXT,
    entity_type TEXT,
    entity_id TEXT,
    after_json JSONB,
    sha256_hash TEXT
);

-- ==========================================
-- 3. SPATIAL TRIGGERS (The "Hard Gates")
-- ==========================================

-- TRIGGER: Automatically Calculate Coverage & Check Encroachment
CREATE OR REPLACE FUNCTION enforce_gis_rules() RETURNS TRIGGER AS $$
DECLARE
    parent_plot_area FLOAT;
    footprint_area FLOAT;
BEGIN
    -- 1. Get Plot Area
    SELECT ST_Area(geometry) INTO parent_plot_area FROM land_plots WHERE plot_id = NEW.plot_id;
    
    -- 2. Calculate Footprint Area
    footprint_area := ST_Area(NEW.building_footprint);
    
    -- 3. Set Coverage Ratio
    NEW.plot_coverage_ratio := footprint_area / parent_plot_area;
    
    -- 4. Check if Footprint is INSIDE the Plot (Encroachment)
    SELECT ST_Within(NEW.building_footprint, geometry) INTO NEW.encroachment_ok 
    FROM land_plots WHERE plot_id = NEW.plot_id;

    -- 5. Hard Gate: If it's Residential and > 60%, or Encroaching, it CANNOT be GIS_CLEARED
    IF (NEW.plot_coverage_ratio <= 0.60 AND NEW.encroachment_ok = TRUE) THEN
        NEW.gis_cleared := TRUE;
    ELSE
        NEW.gis_cleared := FALSE;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_gis
BEFORE INSERT OR UPDATE ON applications
FOR EACH ROW EXECUTE FUNCTION enforce_gis_rules();

-- ==========================================
-- 4. AUDIT TRIGGER (Anti-Corruption)
-- ==========================================
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_logs(action, entity_type, entity_id, after_json, sha256_hash)
    VALUES (
        'UPDATE', 
        'applications', 
        NEW.application_id::text, 
        to_jsonb(NEW), 
        encode(digest(to_jsonb(NEW)::text, 'sha256'), 'hex')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_apps
AFTER UPDATE ON applications
FOR EACH ROW EXECUTE FUNCTION audit_row_change();