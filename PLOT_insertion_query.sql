-- Plot 1010 | Owner: Mr Okoronkwo Ikeagwuna
INSERT INTO land_plots (unique_plot_no, geometry, zoning_class, area_sqm)
VALUES ('ABJ-RESI-1010', 
        ST_GeometryN(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[7.52150475723, 5.59495629177], [7.52132629765, 5.59512761296], [7.52150713669, 5.59534890283], [7.52169273465, 5.59520137625], [7.52150475723, 5.59495629177]]]]}'), 4326), 26331), 1),
        'Residential', 885.04);

-- Plot 1020 | Owner: Mrs Joy Ndimele
INSERT INTO land_plots (unique_plot_no, geometry, zoning_class, area_sqm)
VALUES ('ABJ-COMM-1020', 
        ST_GeometryN(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[7.52150713669, 5.59534890283], [7.52169273465, 5.59558684894], [7.52188785045, 5.59544646074], [7.52169273465, 5.59520137625], [7.52150713669, 5.59534890283]]]]}'), 4326), 26331), 1),
        'Commercial', 903.90);

-- Plot 1030 | Owner: Mr Itoro Ubong
INSERT INTO land_plots (unique_plot_no, geometry, zoning_class, area_sqm)
VALUES ('ABJ-RESI-1030', 
        ST_GeometryN(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[7.52138102525, 5.59467789483], [7.52148572154, 5.59479210896], [7.52167845788, 5.59465172076], [7.52156424375, 5.59448515849], [7.52137864579, 5.59463744399], [7.52138102525, 5.59467789483]]]]}'), 4326), 26331), 1),
        'Residential', 598.14);

-- Plot 1040 | Owner: Mr Agwu Ibem
INSERT INTO land_plots (unique_plot_no, geometry, zoning_class, area_sqm)
VALUES ('ABJ-COMM-1040', 
        ST_GeometryN(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[7.52156424375, 5.59448515849], [7.52167845788, 5.59465172076], [7.52182836392, 5.59451371202], [7.52171652926, 5.59435428813], [7.52156424375, 5.59448515849]]]]}'), 4326), 26331), 1),
        'Commercial', 490.56);

-- Plot 1050 | Owner: Mr Okpanku Chimaobi
INSERT INTO land_plots (unique_plot_no, geometry, zoning_class, area_sqm)
VALUES ('ABJ-RESI-1050', 
        ST_GeometryN(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[7.52171652926, 5.59435428813], [7.52182836392, 5.59451371202], [7.52205441272, 5.59431145784], [7.52196161374, 5.59416155179], [7.52171652926, 5.59435428813]]]]}'), 4326), 26331), 1),
        'Residential', 697.74);