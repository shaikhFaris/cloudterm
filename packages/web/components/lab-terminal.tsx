'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';

const gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3500';
const terminalErrors: Record<string, string> = {
  AUTH_REQUIRED: 'Your terminal session has ended. Reconnect to check your sign-in.',
  LAB_EXPIRED: 'Your lab has expired.',
  LAB_NOT_FOUND: 'Your lab is no longer available.',
  LAB_NOT_READY: 'Your lab is no longer running.',
  SERVICE_UNAVAILABLE: 'Could not verify access to the terminal. Try reconnecting.',
  TERMINAL_START_FAILED: 'Could not start the shell. Try reconnecting.',
  TERMINAL_STREAM_FAILED: 'The shell connection was lost. Try reconnecting.',
};

export function LabTerminal({ labId }: { labId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('Connecting…');
  const [canReconnect, setCanReconnect] = useState(false);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    async function open() {
      // xterm needs the browser DOM; do not evaluate it during server rendering.
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !container.current) return;

      const terminal = new Terminal({
        cursorBlink: true,
        disableStdin: true,
        fontFamily: 'monospace',
        fontSize: 14,
        scrollback: 1000,
        theme: { background: '#09090b', foreground: '#e4e4e7' },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(container.current);
      fit.fit();

      const socket = io(gatewayUrl, {
        autoConnect: false,
        withCredentials: true,
        auth: { labId },
        transports: ['websocket'],
        reconnection: false,
        timeout: 10_000,
      });
      let refreshed = false;
      let ready = false;
      let finished = false;

      function finish(message: string) {
        finished = true;
        ready = false;
        terminal.options.disableStdin = true;
        setStatus(message);
        setCanReconnect(true);
      }

      const input = terminal.onData((data) => {
        if (!ready || !socket.connected) return;
        // Bound paste chunks to well below the gateway's 16 KiB message limit.
        const characters = Array.from(data);
        for (let offset = 0; offset < characters.length; offset += 1024) {
          socket.emit('terminal:input', {
            type: 'chars',
            input: characters.slice(offset, offset + 1024).join(''),
          });
        }
      });

      socket.on('terminal:output', (output: { input?: unknown } | null) => {
        if (typeof output?.input === 'string') terminal.write(output.input);
      });

      socket.on('connect', () => {
        if (!ready && !finished) setStatus('Starting shell…');
      });
      socket.on('terminal:ready', () => {
        if (finished) return;
        ready = true;
        terminal.options.disableStdin = false;
        setStatus('Shell connected');
        terminal.focus();
      });
      socket.on('disconnect', () => {
        if (!finished) finish('Disconnected. Reconnect to continue.');
      });
      socket.on('connect_error', async (error: Error & { data?: { code?: string } }) => {
        const code = error.data?.code;
        if (code === 'AUTH_REQUIRED' && !refreshed) {
          refreshed = true;
          setStatus('Renewing session…');
          try {
            await api.post('/auth/refresh', {}, { skipAuthRefresh: true });
            if (!disposed) socket.connect();
            return;
          } catch {
            if (!disposed) finish('Could not renew your session. Reconnect or sign in again.');
            return;
          }
        }
        finish(
          code
            ? (terminalErrors[code] ?? 'The gateway rejected the terminal connection.')
            : 'Cannot reach gateway. Check its URL and frontend origin.',
        );
      });
      socket.on('terminal:error', (error: { code?: string } | null) => {
        finish(terminalErrors[error?.code ?? ''] ?? 'The terminal closed unexpectedly.');
      });
      socket.on('terminal:exit', (result: { exitCode: number | null } | null) => {
        const code = result?.exitCode;
        finish(typeof code === 'number' ? `Shell exited with code ${code}.` : 'Shell exited.');
      });

      const observer = new ResizeObserver(() => fit.fit());
      observer.observe(container.current);
      cleanup = () => {
        observer.disconnect();
        input.dispose();
        socket.removeAllListeners();
        socket.disconnect();
        terminal.dispose();
      };
      socket.connect();
    }

    void open().catch(() => {
      if (!disposed) {
        setStatus('Could not initialize the terminal.');
        setCanReconnect(true);
      }
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [labId, attempt]);

  return (
    <section className="overflow-hidden rounded-xl border" aria-label="Lab terminal">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="font-medium">Terminal</h2>
          <p role="status" className="text-sm text-muted-foreground">
            {status}
          </p>
        </div>
        {canReconnect && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStatus('Connecting…');
              setCanReconnect(false);
              setAttempt((value) => value + 1);
            }}
          >
            Reconnect
          </Button>
        )}
      </div>
      <div className="bg-[#09090b] p-3">
        <div ref={container} className="h-80 w-full" />
      </div>
    </section>
  );
}
