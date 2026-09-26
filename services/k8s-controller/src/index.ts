const port = Number(process.env.K8S_CONTROLLER_PORT ?? 3003);

const server = Bun.serve({
  port,
  routes: {
    '/health': {
      GET: () => Response.json({ service: 'k8s-controller', status: 'ok' }),
    },
    '/api/v1/reconcile': {
      POST: () =>
        Response.json({ accepted: true, queuedAt: new Date().toISOString() }, { status: 202 }),
    },
  },
  fetch() {
    return Response.json({ error: 'Not found' }, { status: 404 });
  },
});

console.log(`k8s-controller listening on ${server.url}`);
