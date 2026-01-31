const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const PORT = Number(process.env.PORT) || 3000;
const NUDGE_X = 71.69;
const NUDGE_Y = -57.74;

// --- DATABASE CONNECTION ---
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }, // Essential for Supabase/Render
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
    : {
        user: process.env.PGUSER || 'postgres',
        host: process.env.PGHOST || '127.0.0.1',
        database: process.env.PGDATABASE || 'ministry_lands',
        password: process.env.PGPASSWORD || '',
        port: Number(process.env.PGPORT) || 5432,
      }
);

// EMERGENCY DEBUGGER: This will tell us if Supabase is actually talking to us
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ DATABASE CONNECTION ERROR:', err.message);
  } else {
    console.log('✅ DATABASE CONNECTED SUCCESSFULLY TO SUPABASE');
    release();
  }
});

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || 'https://okpanku.github.io';

app.use(express.json({ limit: '50mb' }));
app.use(cors({ 
  origin: corsOrigin, 
  methods: ['GET', 'POST'], 
  credentials: true 
}));

// --- HELPERS ---
function sendError(res, status, message) {
  res.status(status).json({ status: 'ERROR', message });
}
function sendSuccess(res, data = { status: 'SUCCESS' }) {
  res.json(data);
}

const LOGIN_USER = process.env.LOGIN_USER || 'admin';
const LOGIN_PASS = process.env.LOGIN_PASS || 'ministry2024';

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
    JOIN land_plots p ON i.plot_id = p.plot_id`,
  updateStatus: `
    UPDATE applications SET gis_cleared = $1
    WHERE plot_id = (SELECT plot_id FROM land_plots WHERE unique_plot_no = $2)`,
};

// Root Health Check (So "Cannot GET /" is replaced with info)
app.get('/', (req, res) => {
  res.send('Ministry GIS API is running. Point your frontend to /api/plots');
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'ministry-api' });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return sendError(res, 400, 'Username and password required');
  if (username === LOGIN_USER && password === LOGIN_PASS) {
    return sendSuccess(res, { status: 'SUCCESS', token: 'official-access-granted' });
  }
  sendError(res, 401, 'Unauthorized Personnel');
});

app.get('/api/plots', async (req, res) => {
  try {
    const result = await pool.query(SQL.plots, [NUDGE_X, NUDGE_Y]);
    const data = result.rows[0]?.json_build_object;
    return sendSuccess(res, data || { type: 'FeatureCollection', features: [] });
  } catch (err) {
    console.error('❌ GET /api/plots ERROR:', err.message);
    sendError(res, 500, `Failed to load plots: ${err.message}`);
  }
});

function isValidGeojsonGeometry(geom) {
  if (!geom || typeof geom !== 'object') return false;
  const types = ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon'];
  return types.includes(geom.type) && Array.isArray(geom.coordinates);
}

app.post('/api/submit-application', async (req, res) => {
  const { plot_no, geojson_footprint } = req.body || {};
  if (!plot_no || typeof plot_no !== 'string' || !plot_no.trim()) {
    return sendError(res, 400, 'plot_no is required');
  }
  if (!isValidGeojsonGeometry(geojson_footprint)) {
    return sendError(res, 400, 'Valid geojson_footprint geometry required');
  }
  try {
    const result = await pool.query(SQL.submitApp, [
      JSON.stringify(geojson_footprint),
      plot_no.trim(),
      NUDGE_X,
      NUDGE_Y,
    ]);
    if (!result.rows[0]) return sendError(res, 404, 'Plot not found');
    return sendSuccess(res, { status: 'SUCCESS', analysis: result.rows[0] });
  } catch (err) {
    console.error('❌ SUBMISSION ERROR:', err.message);
    const code = err.code === '22P02' || /geometry/i.test(err.message) ? 400 : 500;
    sendError(res, code, code === 400 ? 'Invalid geometry or plot' : 'Submission failed');
  }
});

const server = app.listen(PORT, () => console.log('🚀 Ministry API online on port', PORT));

function shutdown() {
  server.close(() => {
    pool.end().then(() => process.exit(0)).catch(() => process.exit(1));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);