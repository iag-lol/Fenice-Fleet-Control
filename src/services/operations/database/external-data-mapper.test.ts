import { describe, expect, it } from 'vitest';

import {
  mapExternalClient,
  mapExternalClientLocation,
  mapExternalOrder,
  mapExternalWorkOrder,
  PROVISIONAL_SCHEMA_MAPPING,
  readBoolean,
  readCoordinates,
  readDate,
  readNumber,
  readString,
  type ExternalSchemaMapping,
} from '@/services/operations/database/external-data-mapper';

/**
 * El esquema real de Fenice todavia no se conoce. Estas pruebas fijan el
 * contrato del mapeador: tolerar formatos heterogeneos sin romperse y permitir
 * cambiar los nombres de columna sin tocar el resto de la plataforma.
 */

const mapping = PROVISIONAL_SCHEMA_MAPPING;

describe('coerciones defensivas', () => {
  it('lee texto y descarta cadenas vacias', () => {
    expect(readString({ a: '  Comercial  ' }, 'a')).toBe('Comercial');
    expect(readString({ a: '   ' }, 'a')).toBeNull();
    expect(readString({ a: null }, 'a')).toBeNull();
    expect(readString({}, undefined)).toBeNull();
  });

  it('lee numeros incluyendo decimales con coma', () => {
    expect(readNumber({ a: '12,5' }, 'a')).toBe(12.5);
    expect(readNumber({ a: 8 }, 'a')).toBe(8);
    expect(readNumber({ a: '' }, 'a')).toBeNull();
    expect(readNumber({ a: 'abc' }, 'a')).toBeNull();
  });

  it('interpreta booleanos en las formas frecuentes de un ERP', () => {
    expect(readBoolean({ a: true }, 'a')).toBe(true);
    expect(readBoolean({ a: 1 }, 'a')).toBe(true);
    expect(readBoolean({ a: 'SI' }, 'a')).toBe(true);
    expect(readBoolean({ a: 'S' }, 'a')).toBe(true);
    expect(readBoolean({ a: 0 }, 'a')).toBe(false);
    expect(readBoolean({ a: 'NO' }, 'a')).toBe(false);
  });

  it('normaliza fechas en formato local chileno', () => {
    const iso = readDate({ f: '27-08-2026' }, 'f');
    expect(iso).not.toBeNull();
    expect(new Date(iso!).getFullYear()).toBe(2026);
    expect(new Date(iso!).getMonth()).toBe(7);
    expect(new Date(iso!).getDate()).toBe(27);
  });

  it('normaliza fechas con separador barra y hora', () => {
    const iso = readDate({ f: '05/01/2026 14:30' }, 'f');
    expect(iso).not.toBeNull();
    expect(new Date(iso!).getDate()).toBe(5);
    expect(new Date(iso!).getHours()).toBe(14);
  });

  it('acepta objetos Date, epoch e ISO', () => {
    expect(readDate({ f: new Date('2026-01-01T00:00:00Z') }, 'f')).toBe('2026-01-01T00:00:00.000Z');
    expect(readDate({ f: 0 }, 'f')).toBe('1970-01-01T00:00:00.000Z');
    expect(readDate({ f: '2026-08-27T12:00:00Z' }, 'f')).toBe('2026-08-27T12:00:00.000Z');
  });

  it('descarta fechas invalidas en vez de propagarlas', () => {
    expect(readDate({ f: 'sin fecha' }, 'f')).toBeNull();
    expect(readDate({ f: new Date('x') }, 'f')).toBeNull();
  });

  it('rechaza coordenadas inutilizables', () => {
    expect(readCoordinates({ lat: -33.4, lng: -70.6 }, 'lat', 'lng')).toEqual({
      lat: -33.4,
      lng: -70.6,
    });
    expect(readCoordinates({ lat: 0, lng: 0 }, 'lat', 'lng')).toBeNull();
    expect(readCoordinates({ lat: 200, lng: -70 }, 'lat', 'lng')).toBeNull();
    expect(readCoordinates({ lat: null, lng: -70 }, 'lat', 'lng')).toBeNull();
  });
});

describe('mapExternalClientLocation', () => {
  it('mapea una direccion completa', () => {
    const location = mapExternalClientLocation(
      {
        direccion_id: 'D-1',
        cliente_id: 'C-1',
        glosa: 'Local principal',
        direccion: 'Av. Matta 1200',
        comuna_codigo: '13101',
        comuna: 'Santiago Centro',
        latitud: -33.45,
        longitud: -70.66,
        principal: 1,
      },
      mapping,
    );

    expect(location?.id).toBe('D-1');
    expect(location?.isPrimary).toBe(true);
    expect(location?.coordinateSource).toBe('external');
  });

  it('marca la direccion sin coordenadas como no geocodificada', () => {
    const location = mapExternalClientLocation(
      {
        direccion_id: 'D-2',
        cliente_id: 'C-1',
        direccion: 'Camino sin numero',
        comuna_codigo: '13101',
        latitud: null,
        longitud: null,
      },
      mapping,
    );

    expect(location?.coordinates).toBeNull();
    expect(location?.coordinateSource).toBe('none');
  });

  it('descarta filas sin identificador', () => {
    expect(mapExternalClientLocation({ direccion: 'x' }, mapping)).toBeNull();
  });
});

describe('mapExternalClient', () => {
  it('mapea un cliente con sus direcciones', () => {
    const client = mapExternalClient(
      {
        cliente_id: 'C-1',
        codigo: 'F10001',
        razon_social: 'Comercial Andina SpA',
        nombre_fantasia: 'Minimarket Andina',
        rut: '76.123.456-7',
        fecha_ultima_compra: '01-08-2026',
        total_pedidos: '24',
        monto_acumulado: '12500000',
        activo: 'SI',
      },
      [],
      mapping,
    );

    expect(client?.code).toBe('F10001');
    expect(client?.tradeName).toBe('Minimarket Andina');
    expect(client?.totalOrders).toBe(24);
    expect(client?.active).toBe(true);
    expect(client?.lastPurchaseAt).not.toBeNull();
  });

  it('completa el nombre faltante con el disponible', () => {
    const client = mapExternalClient(
      { cliente_id: 'C-2', razon_social: 'Distribuidora Austral Ltda.' },
      [],
      mapping,
    );

    expect(client?.tradeName).toBe('Distribuidora Austral Ltda.');
  });

  it('descarta filas sin identificador', () => {
    expect(mapExternalClient({ codigo: 'F1' }, [], mapping)).toBeNull();
  });
});

describe('mapExternalWorkOrder', () => {
  it('traduce los estados de Fenice al modelo interno', () => {
    const workOrder = mapExternalWorkOrder(
      {
        ot_id: 'OT-1',
        numero_ot: 'OT-2026-000001',
        pedido_id: 'P-1',
        cliente_id: 'C-1',
        estado: 'EN_RUTA',
        prioridad: 'ALTA',
        fecha_programada: '27-08-2026',
        latitud: -33.45,
        longitud: -70.66,
      },
      mapping,
    );

    expect(workOrder?.status).toBe('en_ruta');
    expect(workOrder?.priority).toBe('alta');
    expect(workOrder?.coordinates).not.toBeNull();
  });

  it('cae a un estado seguro ante un valor desconocido', () => {
    const workOrder = mapExternalWorkOrder(
      { ot_id: 'OT-2', cliente_id: 'C-1', estado: 'ESTADO_QUE_NO_CONOCEMOS' },
      mapping,
    );

    // Nunca inventar un estado avanzado a partir de un valor no reconocido.
    expect(workOrder?.status).toBe('pendiente');
    expect(workOrder?.priority).toBe('normal');
  });

  it('acepta sinonimos de estado declarados en el diccionario', () => {
    expect(
      mapExternalWorkOrder({ ot_id: 'OT-3', cliente_id: 'C-1', estado: 'ENTREGADA' }, mapping)
        ?.status,
    ).toBe('completada');
    expect(
      mapExternalWorkOrder({ ot_id: 'OT-4', cliente_id: 'C-1', estado: 'ANULADA' }, mapping)?.status,
    ).toBe('cancelada');
  });

  it('no asume coordenadas cuando la fuente no las entrega', () => {
    const workOrder = mapExternalWorkOrder({ ot_id: 'OT-5', cliente_id: 'C-1' }, mapping);
    expect(workOrder?.coordinates).toBeNull();
  });
});

describe('mapExternalOrder', () => {
  it('mapea un pedido y su estado', () => {
    const order = mapExternalOrder(
      {
        pedido_id: 'P-1',
        numero_pedido: 'PED-2026-000001',
        cliente_id: 'C-1',
        estado: 'DESPACHADO',
        fecha_emision: '26-08-2026',
        monto_total: '450000',
      },
      [],
      mapping,
    );

    expect(order?.number).toBe('PED-2026-000001');
    expect(order?.status).toBe('despachado');
    expect(order?.totalAmount).toBe(450_000);
  });
});

describe('adaptabilidad del esquema', () => {
  it('funciona con nombres de columna completamente distintos', () => {
    // Escenario real: Fenice entrega un esquema en ingles. Solo cambia el
    // mapeo declarativo; ninguna otra pieza de la plataforma se modifica.
    const englishMapping: ExternalSchemaMapping = {
      ...mapping,
      clients: {
        table: 'customers',
        columns: {
          id: 'customer_id',
          code: 'customer_code',
          legalName: 'legal_name',
          tradeName: 'trade_name',
          taxId: 'tax_id',
          lastPurchaseAt: 'last_order_date',
          totalOrders: 'order_count',
          lifetimeValue: 'total_revenue',
          createdAt: 'created_at',
          active: 'is_active',
        },
      },
    };

    const client = mapExternalClient(
      {
        customer_id: 'X-9',
        customer_code: 'ACME-1',
        trade_name: 'Acme Market',
        order_count: 12,
        is_active: true,
      },
      [],
      englishMapping,
    );

    expect(client?.id).toBe('X-9');
    expect(client?.code).toBe('ACME-1');
    expect(client?.tradeName).toBe('Acme Market');
    expect(client?.totalOrders).toBe(12);
  });
});
