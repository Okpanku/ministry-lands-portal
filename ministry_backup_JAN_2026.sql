--
-- PostgreSQL database dump
--

-- Dumped from database version 15.4 (Debian 15.4-1.pgdg110+1)
-- Dumped by pg_dump version 15.4 (Debian 15.4-1.pgdg110+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: audit_row_change(); Type: FUNCTION; Schema: public; Owner: admin
--

CREATE FUNCTION public.audit_row_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.audit_row_change() OWNER TO admin;

--
-- Name: enforce_gis_rules(); Type: FUNCTION; Schema: public; Owner: admin
--

CREATE FUNCTION public.enforce_gis_rules() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.enforce_gis_rules() OWNER TO admin;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: applications; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.applications (
    application_id integer NOT NULL,
    plot_id uuid,
    applicant_name character varying(255),
    status character varying(30) DEFAULT 'PENDING'::character varying,
    stage character varying(50) DEFAULT 'STAGE_1_SUBMITTED'::character varying,
    building_footprint public.geometry(Polygon,26331),
    gis_cleared boolean DEFAULT false,
    encroachment_ok boolean DEFAULT false,
    plot_coverage_ratio numeric(5,4),
    submitted_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    approved_at timestamp with time zone
);


ALTER TABLE public.applications OWNER TO admin;

--
-- Name: applications_application_id_seq; Type: SEQUENCE; Schema: public; Owner: admin
--

CREATE SEQUENCE public.applications_application_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.applications_application_id_seq OWNER TO admin;

--
-- Name: applications_application_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: admin
--

ALTER SEQUENCE public.applications_application_id_seq OWNED BY public.applications.application_id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.audit_logs (
    audit_id bigint NOT NULL,
    occurred_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    action text,
    entity_type text,
    entity_id text,
    after_json jsonb,
    sha256_hash text
);


ALTER TABLE public.audit_logs OWNER TO admin;

--
-- Name: audit_logs_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: admin
--

CREATE SEQUENCE public.audit_logs_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.audit_logs_audit_id_seq OWNER TO admin;

--
-- Name: audit_logs_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: admin
--

ALTER SEQUENCE public.audit_logs_audit_id_seq OWNED BY public.audit_logs.audit_id;


--
-- Name: land_plots; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.land_plots (
    plot_id uuid DEFAULT gen_random_uuid() NOT NULL,
    unique_plot_no character varying(50) NOT NULL,
    geometry public.geometry(Polygon,26331) NOT NULL,
    zoning_class character varying(20),
    area_sqm numeric(12,2),
    application_lock boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT land_plots_zoning_class_check CHECK (((zoning_class)::text = ANY ((ARRAY['Residential'::character varying, 'Commercial'::character varying, 'Industrial'::character varying, 'Public'::character varying])::text[])))
);


ALTER TABLE public.land_plots OWNER TO admin;

--
-- Name: v_executive_summary; Type: VIEW; Schema: public; Owner: admin
--

CREATE VIEW public.v_executive_summary AS
 SELECT count(*) AS total_applications,
    count(*) FILTER (WHERE (applications.gis_cleared = true)) AS ready_for_approval,
    count(*) FILTER (WHERE (applications.gis_cleared = false)) AS blocked_by_violations,
    (round((avg(applications.plot_coverage_ratio) * (100)::numeric), 2) || '%'::text) AS avg_building_density
   FROM public.applications;


ALTER TABLE public.v_executive_summary OWNER TO admin;

--
-- Name: applications application_id; Type: DEFAULT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.applications ALTER COLUMN application_id SET DEFAULT nextval('public.applications_application_id_seq'::regclass);


--
-- Name: audit_logs audit_id; Type: DEFAULT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN audit_id SET DEFAULT nextval('public.audit_logs_audit_id_seq'::regclass);


--
-- Data for Name: applications; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public.applications (application_id, plot_id, applicant_name, status, stage, building_footprint, gis_cleared, encroachment_ok, plot_coverage_ratio, submitted_at, approved_at) FROM stdin;
1	e721fea0-0888-436e-8672-469924c37c4c	Samuel Properties Ltd	PENDING	STAGE_1_SUBMITTED	0103000020DB66000001000000050000000000000000002440000000000000244000000000000044400000000000002440000000000000444000000000000044400000000000002440000000000000444000000000000024400000000000002440	t	t	0.3600	2026-01-25 14:38:07.394253+00	\N
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public.audit_logs (audit_id, occurred_at, action, entity_type, entity_id, after_json, sha256_hash) FROM stdin;
1	2026-01-25 14:47:58.028732+00	UPDATE	applications	1	{"stage": "STAGE_1_SUBMITTED", "status": "PENDING", "plot_id": "e721fea0-0888-436e-8672-469924c37c4c", "approved_at": null, "gis_cleared": true, "submitted_at": "2026-01-25T14:38:07.394253+00:00", "applicant_name": "Samuel Properties Ltd", "application_id": 1, "encroachment_ok": true, "building_footprint": {"crs": {"type": "name", "properties": {"name": "EPSG:26331"}}, "type": "Polygon", "coordinates": [[[10, 10], [40, 10], [40, 40], [10, 40], [10, 10]]]}, "plot_coverage_ratio": 0.3600}	90c4afd3f06792952856d96c0f0f7702c8bb5fae114381bcda81b602b5bb1d5f
\.


--
-- Data for Name: land_plots; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public.land_plots (plot_id, unique_plot_no, geometry, zoning_class, area_sqm, application_lock, created_at) FROM stdin;
e721fea0-0888-436e-8672-469924c37c4c	ABJ-001	0103000020DB66000001000000050000000000000000000000000000000000000000000000000049400000000000000000000000000000494000000000000049400000000000000000000000000000494000000000000000000000000000000000	Residential	2500.00	f	2026-01-25 14:38:07.394253+00
\.


--
-- Data for Name: spatial_ref_sys; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public.spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text) FROM stdin;
\.


--
-- Name: applications_application_id_seq; Type: SEQUENCE SET; Schema: public; Owner: admin
--

SELECT pg_catalog.setval('public.applications_application_id_seq', 1, true);


--
-- Name: audit_logs_audit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: admin
--

SELECT pg_catalog.setval('public.audit_logs_audit_id_seq', 1, true);


--
-- Name: applications applications_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (application_id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (audit_id);


--
-- Name: land_plots land_plots_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.land_plots
    ADD CONSTRAINT land_plots_pkey PRIMARY KEY (plot_id);


--
-- Name: land_plots land_plots_unique_plot_no_key; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.land_plots
    ADD CONSTRAINT land_plots_unique_plot_no_key UNIQUE (unique_plot_no);


--
-- Name: applications trg_audit_apps; Type: TRIGGER; Schema: public; Owner: admin
--

CREATE TRIGGER trg_audit_apps AFTER UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: applications trg_validate_gis; Type: TRIGGER; Schema: public; Owner: admin
--

CREATE TRIGGER trg_validate_gis BEFORE INSERT OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.enforce_gis_rules();


--
-- Name: applications applications_plot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_plot_id_fkey FOREIGN KEY (plot_id) REFERENCES public.land_plots(plot_id);


--
-- PostgreSQL database dump complete
--

