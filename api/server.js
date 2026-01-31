const dns = require('node:dns');
// FORCE IPv4: This fixes the ENETUNREACH error on Render
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const PORT = Number(process.env.PORT) || 10000;
const NUDGE_X = 71.69;
const NUDGE_Y = -57.74;

// --- DATABASE CONNECTION ---
// Using your Supabase Transaction Pooler URL
const DATABASE_URL = "postgresql://postgres.viuivrrviocyxjyvkowa:AizesS8wNaupuyFo@aws-1-eu-west-1.pooler.supabase.com:6543/postgres";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Connection Tester
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ DATABASE CONNECTION ERROR:', err.message);
  } else {
    console.log('✅ DATABASE CONNECTED SUCCESSFULLY VIA IPv4 POOLER');
    release();
  }
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
          WHEN a.gis_cleared = FALSE THEN 'PENDING' ELSE 'NOT_APPROVED' END
          FROM applications a WHERE a.plot_id = p.plot_id
          ORDER BY a.submission_date DESC LIMIT 1), 'NOT_SUBMITTED') AS application_status,
        ST_Transform(ST_Translate(ST_SetSRID(ST_Force2D(p.geometry), 32632), $1, $2), 4326) AS geometry
      FROM land_plots p
      WHERE p.unique_plot_no != 'PLOT-001'
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
    console.error('❌ FETCH ERROR:', err.message);
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === (process.env.LOGIN_USER || 'admin') && password === (process.env.LOGIN_PASS || 'ministry2024')) {
    res.json({ status: 'SUCCESS', token: 'access-granted' });
  } else {
    res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });
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
app.get('/api/admin/remove-plots', async (req, res) => {
  try {
    // 1. First, delete any applications linked to these plots
    await pool.query(`
      DELETE FROM applications 
      WHERE plot_id IN (SELECT plot_id FROM land_plots WHERE unique_plot_no IN ('PLOT-001', 'PLT-001'))
    `);

    // 2. Now, delete the plots themselves
    const result = await pool.query(
      "DELETE FROM land_plots WHERE unique_plot_no IN ('PLOT-001', 'PLT-001')"
    );

    res.send(`Success! Applications cleared and ${result.rowCount} plot(s) removed.`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Database Error: " + err.message);
  }
});

const server = app.listen(PORT, () => console.log('🚀 Ministry API online on port', PORT));