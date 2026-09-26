const port = Number(process.env.TERMINAL_GATEWAY_PORT ?? 3002);

const server = Bun.serve({
  port,
  routes: {
    '/health': {
      GET: () => Response.json({ service: 'terminal-gateway', status: 'ok' }),
    },
    '/api/v1/sessions': {
      GET: () => Response.json({ sessions: [], count: 0 }),
    },
  },
  fetch() {
    return Response.json({ error: 'Not found' }, { status: 404 });
  },
});

console.log(`terminal-gateway listening on ${server.url}`);
