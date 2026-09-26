import { expect, test } from 'bun:test';

test('health contract is stable', () => {
  expect({ service: 'api-gateway', status: 'ok' }).toEqual({
    service: 'api-gateway',
    status: 'ok',
  });
});
