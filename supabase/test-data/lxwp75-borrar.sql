-- =============================================================================
-- BORRAR DATOS DE PRUEBA: ruta del vehiculo LXWP75
-- =============================================================================
--
-- Elimina exactamente lo que crea lxwp75-insertar.sql: las 5 alertas, la
-- ruta (sus 6 paradas se borran solas por on delete cascade, pero se borran
-- explicito igual por claridad), el vehiculo y el conductor de prueba.
--
-- No toca nada mas: cada `delete` filtra por los mismos identificadores de
-- prueba (LXWP75 / TEST-LXWP75 / TEST-RUTA-LXWP75 / test-lxwp75-%), asi que
-- es seguro de correr aunque ya se haya borrado antes (0 filas, sin error).
-- =============================================================================

begin;

delete from alertas
where id like 'test-lxwp75-%';

delete from paradas_ruta
where ruta_id in (select id from rutas where codigo = 'TEST-RUTA-LXWP75');

delete from rutas
where codigo = 'TEST-RUTA-LXWP75';

delete from vehiculos
where patente = 'LXWP75' and codigo_flota = 'TEST-LXWP75';

delete from conductores
where documento_identidad = 'TEST-LXWP75-RUT';

commit;
