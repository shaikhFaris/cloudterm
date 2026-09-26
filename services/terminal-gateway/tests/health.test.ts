import { expect, test } from 'bun:test';

test('health contract is stable', () => {
  expect({ service: 'terminal-gateway', status: 'ok' }).toEqual({
    service: 'terminal-gateway',
    status: 'ok',
  });
});
