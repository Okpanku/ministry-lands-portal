-- 1. Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Drop existing tables if they exist to start fresh
DROP TABLE IF EXISTS applications;
DROP TABLE IF EXISTS land_plots;

-- 3. Create Land Plots (Geometry set to MultiPolygon to match your data)
CREATE TABLE land_plots (
    plot_id SERIAL PRIMARY KEY,
    unique_plot_no VARCHAR(50) UNIQUE NOT NULL,
    zoning_class VARCHAR(50), 
    area_sqm NUMERIC(15,2),
    geometry GEOMETRY(MultiPolygon, 32632) -- Matches your INSERT script
);

-- 4. Create Applications Table
CREATE TABLE applications (
    app_id SERIAL PRIMARY KEY,
    plot_id INTEGER REFERENCES land_plots(plot_id) ON DELETE CASCADE,
    applicant_name VARCHAR(100),
    building_footprint GEOMETRY(MultiPolygon, 32632),
    submission_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    plot_coverage_ratio NUMERIC(5,2),
    gis_cleared BOOLEAN DEFAULT FALSE
);

-- 5. Spatial Index for Performance (Makes the map load faster)
CREATE INDEX idx_land_plots_geometry ON land_plots USING GIST(geometry);