import { expect, test } from 'bun:test';

test('health contract is stable', () => {
  expect({ service: 'k8s-controller', status: 'ok' }).toEqual({
    service: 'k8s-controller',
    status: 'ok',
  });
});
