import { describe, expect, it } from 'vitest';

import {
  formatDays,
  formatDistance,
  formatDuration,
  formatElapsed,
  formatEta,
  formatHeading,
  formatPercent,
  formatSpeed,
  normalizeSearch,
} from '@/lib/format';

describe('formatElapsed', () => {
  it('usa segundos por debajo del minuto', () => {
    expect(formatElapsed(12)).toBe('hace 12 s');
  });

  it('usa minutos por debajo de la hora', () => {
    expect(formatElapsed(300)).toBe('hace 5 min');
  });

  it('combina horas y minutos', () => {
    expect(formatElapsed(7800)).toBe('hace 2 h 10 min');
    expect(formatElapsed(7200)).toBe('hace 2 h');
  });

  it('usa dias por encima de las 24 horas', () => {
    expect(formatElapsed(90_000)).toBe('hace 1 d');
  });

  it('informa la ausencia de dato en vez de mostrar un cero enganoso', () => {
    expect(formatElapsed(null)).toBe('sin datos');
  });
});

describe('formatDuration', () => {
  it('formatea segundos, minutos y horas', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(5400)).toBe('1 h 30 min');
    expect(formatDuration(3600)).toBe('1 h');
  });

  it('devuelve un marcador ante valores ausentes', () => {
    expect(formatDuration(null)).toBe('--');
    expect(formatDuration(undefined)).toBe('--');
  });
});

describe('formatDistance y formatSpeed', () => {
  it('usa metros por debajo del kilometro', () => {
    expect(formatDistance(340)).toBe('340 m');
  });

  it('usa kilometros por encima', () => {
    expect(formatDistance(2500)).toBe('2,5 km');
  });

  it('formatea la velocidad redondeada', () => {
    expect(formatSpeed(42.4)).toBe('42 km/h');
    expect(formatSpeed(null)).toBe('--');
  });
});

describe('formatEta', () => {
  it('indica llegada inminente', () => {
    expect(formatEta(0.5)).toBe('Llegando');
  });

  it('usa minutos y horas', () => {
    expect(formatEta(28)).toBe('28 min');
    expect(formatEta(65)).toBe('1 h 05 min');
    expect(formatEta(120)).toBe('2 h');
  });

  it('es explicito cuando no hay estimacion', () => {
    expect(formatEta(null)).toBe('No disponible');
  });
});

describe('formatDays', () => {
  it('usa lenguaje natural para los casos frecuentes', () => {
    expect(formatDays(0)).toBe('Hoy');
    expect(formatDays(1)).toBe('1 dia');
    expect(formatDays(45)).toBe('45 dias');
    expect(formatDays(null)).toBe('Sin registro');
  });
});

describe('formatHeading', () => {
  it('traduce grados a punto cardinal', () => {
    expect(formatHeading(0)).toBe('N (0°)');
    expect(formatHeading(90)).toBe('E (90°)');
    expect(formatHeading(225)).toBe('SO (225°)');
  });

  it('normaliza grados fuera de rango', () => {
    expect(formatHeading(450)).toBe('E (450°)');
  });

  it('devuelve un marcador sin dato', () => {
    expect(formatHeading(null)).toBe('--');
  });
});

describe('formatPercent', () => {
  it('formatea proporciones', () => {
    expect(formatPercent(0.42)).toBe('42 %');
    expect(formatPercent(0.4267, 1)).toBe('42,7 %');
  });
});

describe('normalizeSearch', () => {
  it('elimina acentos y la tilde de la ene, y normaliza a minusculas', () => {
    // La ene con tilde tambien se pliega: asi "nunoa" encuentra "Nunoa".
    expect(normalizeSearch('  Ñuñoa Peñalolén ')).toBe('nunoa penalolen');
    expect(normalizeSearch('MAIPÚ')).toBe('maipu');
  });

  it('permite buscar sin acentos un texto acentuado', () => {
    expect(normalizeSearch('Av. Irarrázaval').includes('irarrazaval')).toBe(true);
  });
});
