import { expect, it } from 'vitest';
import { OPERATION_BOUNDS } from '@/data/administrative-boundaries';
import { OPERATION_BOUNDS as lightweightBounds } from './map-viewport';

it('preserves the exact regional extent without bundling its polygons', () => {
  expect(lightweightBounds).toEqual(OPERATION_BOUNDS);
});
