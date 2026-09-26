const port = Number(process.env.API_GATEWAY_PORT ?? 3001);

const server = Bun.serve({
  port,
  routes: {
    '/health': {
      GET: () => Response.json({ service: 'api-gateway', status: 'ok' }),
    },
    '/api/v1/status': {
      GET: () => Response.json({ status: 'ready', timestamp: new Date().toISOString() }),
    },
  },
  fetch() {
    return Response.json({ error: 'Not found' }, { status: 404 });
  },
});

console.log(`api-gateway listening on ${server.url}`);
