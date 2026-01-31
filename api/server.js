const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NUDGE_X = 71.69;
const NUDGE_Y = -57.74;

const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || '127.0.0.1',
  database: process.env.PGDATABASE || 'ministry_lands',
  password: process.env.PGPASSWORD || '',
  port: Number(process.env.PGPORT) || 5432,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

app.use(express.json({ limit: '50mb' }));
app.use(cors());

// --- 1. AUTHENTICATION ---
const LOGIN_USER = process.env.LOGIN_USER || 'admin';
const LOGIN_PASS = process.env.LOGIN_PASS || 'ministry2024';

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ status: 'ERROR', message: 'Username and password required' });
  }
  if (username === LOGIN_USER && password === LOGIN_PASS) {
    res.json({ status: 'SUCCESS', token: 'official-access-granted' });
  } else {
    res.status(401).json({ status: 'ERROR', message: 'Unauthorized Personnel' });
  }
});

// --- 2. FETCH PLOTS (With Nudge) ---
app.get('/api/plots', async (req, res) => {
  try {
    const query = {
      text: `
        SELECT json_build_object(
          'type', 'FeatureCollection',
          'features', COALESCE(json_agg(ST_AsGeoJSON(t.*)::json), '[]'::json)
        )
        FROM (
          SELECT
            p.unique_plot_no, p.zoning_class, p.area_sqm,
            COALESCE((SELECT
                CASE WHEN a.gis_cleared = TRUE THEN 'APPROVED'
                     WHEN a.gis_cleared = FALSE THEN 'PENDING'
                     ELSE 'NOT_APPROVED' END
              FROM applications a WHERE a.plot_id = p.plot_id
              ORDER BY a.submission_date DESC LIMIT 1), 'NOT_SUBMITTED') as application_status,
            ST_Transform(ST_Translate(ST_SetSRID(ST_Force2D(p.geometry), 32632), $1, $2), 4326) as geometry
          FROM land_plots p
        ) t;`,
      values: [NUDGE_X, NUDGE_Y],
    };
    const result = await pool.query(query);
    const data = result.rows[0]?.json_build_object;
    res.json(data || { type: 'FeatureCollection', features: [] });
  } catch (err) {
    console.error('GET /api/plots:', err.message);
    res.status(500).json({ status: 'ERROR', message: 'Failed to load plots' });
  }
});

// --- 3. SUBMIT & COMPLIANCE (Corrected Highlight Nudge) ---
function isValidGeojsonGeometry(geom) {
  if (!geom || typeof geom !== 'object') return false;
  const t = geom.type;
  const coords = geom.coordinates;
  return (t === 'Point' || t === 'LineString' || t === 'Polygon' || t === 'MultiPoint' || t === 'MultiLineString' || t === 'MultiPolygon') && Array.isArray(coords);
}

app.post('/api/submit-application', async (req, res) => {
  const { plot_no, geojson_footprint } = req.body || {};
  if (!plot_no || typeof plot_no !== 'string' || !plot_no.trim()) {
    return res.status(400).json({ status: 'ERROR', message: 'plot_no is required' });
  }
  if (!isValidGeojsonGeometry(geojson_footprint)) {
    return res.status(400).json({ status: 'ERROR', message: 'Valid geojson_footprint geometry required' });
  }
  try {
    const query = `
      WITH inserted_app AS (
        INSERT INTO applications (plot_id, applicant_name, building_footprint)
        SELECT plot_id, 'Portal User', ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 32632))
        FROM land_plots WHERE unique_plot_no = $2
        RETURNING plot_id, building_footprint
      )
      SELECT
        p.unique_plot_no,
        ROUND(ST_Distance(i.building_footprint, ST_Boundary(p.geometry))::numeric, 2) as min_setback,
        ST_AsGeoJSON(ST_Transform(ST_Translate(ST_SetSRID(ST_Force2D(p.geometry), 32632), $3, $4), 4326))::json as plot_outline_geojson,
        ST_AsGeoJSON(ST_Transform(i.building_footprint, 4326))::json as footprint_geojson
      FROM inserted_app i
      JOIN land_plots p ON i.plot_id = p.plot_id`;
    const result = await pool.query(query, [JSON.stringify(geojson_footprint), plot_no.trim(), NUDGE_X, NUDGE_Y]);
    if (!result.rows[0]) {
      return res.status(404).json({ status: 'ERROR', message: 'Plot not found' });
    }
    res.json({ status: 'SUCCESS', analysis: result.rows[0] });
  } catch (err) {
    console.error('POST /api/submit-application:', err.message);
    const code = err.code === '22P02' || err.message.includes('geometry') ? 400 : 500;
    res.status(code).json({ status: 'ERROR', message: code === 400 ? 'Invalid geometry or plot' : 'Submission failed' });
  }
});

// --- 4. UPDATE STATUS (Administrative Action) ---
app.post('/api/update-status', async (req, res) => {
  const { plot_no, gis_cleared } = req.body || {};
  if (!plot_no || typeof plot_no !== 'string' || !plot_no.trim()) {
    return res.status(400).json({ status: 'ERROR', message: 'plot_no is required' });
  }
  if (typeof gis_cleared !== 'boolean') {
    return res.status(400).json({ status: 'ERROR', message: 'gis_cleared must be true or false' });
  }
  try {
    const result = await pool.query(
      `UPDATE applications
       SET gis_cleared = $1
       WHERE plot_id = (SELECT plot_id FROM land_plots WHERE unique_plot_no = $2)`,
      [gis_cleared, plot_no.trim()]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'ERROR', message: 'Plot or application not found' });
    }
    res.json({ status: 'SUCCESS' });
  } catch (err) {
    console.error('POST /api/update-status:', err.message);
    res.status(500).json({ status: 'ERROR', message: 'Update failed' });
  }
});

app.listen(PORT, () => console.log('🚀 API online on port', PORT));