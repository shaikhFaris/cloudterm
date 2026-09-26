# CloudTerm

Bun + Turbo monorepo for the CloudTerm platform.

## Services

- `fe`: React/Vite frontend
- `api-gateway`: public API boundary
- `terminal-gateway`: terminal session boundary
- `k8s-controller`: Kubernetes reconciliation service

## Requirements

- Bun latest

## Commands

```sh
bun install
bun run dev
bun run check
bun run build
bun run test
```

Each service can also be run directly with `bun run --filter <service> dev`.
