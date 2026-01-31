const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first'); // FORCE IPv4 for Render/Supabase stability

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const PORT = Number(process.env.PORT) || 10000;
const NUDGE_X = 71.69;
const NUDGE_Y = -57.74;

const DATABASE_URL = "postgresql://postgres.viuivrrviocyxjyvkowa:AizesS8wNaupuyFo@aws-1-eu-west-1.pooler.supabase.com:6543/postgres";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || 'https://okpanku.github.io';

app.use(express.json({ limit: '50mb' }));
app.use(cors({ origin: corsOrigin, methods: ['GET', 'POST'], credentials: true }));

// --- SQL QUERIES ---
const SQL = {
  plots: `
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(json_agg(ST_AsGeoJSON(t.*)::json), '[]'::json)
    )
    FROM (
      SELECT p.unique_plot_no, p.zoning_class, p.area_sqm,
        COALESCE((SELECT CASE WHEN a.gis_cleared = TRUE THEN 'APPROVED'
          WHEN a.gis_cleared = FALSE THEN 'REJECTED' ELSE 'PENDING' END
          FROM applications a WHERE a.plot_id = p.plot_id
          ORDER BY a.submission_date DESC LIMIT 1), 'NOT_SUBMITTED') AS application_status,
        ST_Transform(ST_Translate(ST_SetSRID(ST_Force2D(p.geometry), 32632), $1, $2), 4326) AS geometry
      FROM land_plots p
      WHERE p.unique_plot_no NOT IN ('PLOT-001', 'PLT-001') -- Cleaned up for demo
    ) t`,
  submitApp: `
    WITH inserted_app AS (
      INSERT INTO applications (plot_id, applicant_name, building_footprint)
      SELECT plot_id, 'Portal User', ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 32632))
      FROM land_plots WHERE unique_plot_no = $2
      RETURNING plot_id, building_footprint
    )
    SELECT p.unique_plot_no,
      ROUND(ST_Distance(i.building_footprint, ST_Boundary(p.geometry))::numeric, 2) AS min_setback,
      ST_AsGeoJSON(ST_Transform(ST_Translate(ST_SetSRID(ST_Force2D(p.geometry), 32632), $3, $4), 4326))::json AS plot_outline_geojson,
      ST_AsGeoJSON(ST_Transform(i.building_footprint, 4326))::json AS footprint_geojson
    FROM inserted_app i
    JOIN land_plots p ON i.plot_id = p.plot_id`
};

// --- ROUTES ---
app.get('/', (req, res) => res.send('Ministry API Live'));

app.get('/api/plots', async (req, res) => {
  try {
    const result = await pool.query(SQL.plots, [NUDGE_X, NUDGE_Y]);
    res.json(result.rows[0]?.json_build_object || { type: 'FeatureCollection', features: [] });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

app.post('/api/submit-application', async (req, res) => {
  const { plot_no, geojson_footprint } = req.body;
  try {
    const result = await pool.query(SQL.submitApp, [JSON.stringify(geojson_footprint), plot_no, NUDGE_X, NUDGE_Y]);
    res.json({ status: 'SUCCESS', analysis: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

// ADDED: Missing status update route for the Director Tab
app.post('/api/update-status', async (req, res) => {
  const { plot_no, gis_cleared } = req.body;
  try {
    await pool.query(`
      UPDATE applications 
      SET gis_cleared = $1 
      WHERE plot_id = (SELECT plot_id FROM land_plots WHERE unique_plot_no = $2)
    `, [gis_cleared, plot_no]);
    res.json({ status: 'SUCCESS' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log('🚀 Ministry API online on port', PORT));