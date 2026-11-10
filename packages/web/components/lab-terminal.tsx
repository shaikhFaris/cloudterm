'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';

const gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3500';

export function LabTerminal({ labId }: { labId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('Connecting…');
  const [connected, setConnected] = useState(false);

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
      terminal.writeln('Gateway input demo — typed input is logged on the gateway.');
      terminal.writeln('Local echo is enabled. Shell execution is not connected here.');
      terminal.writeln('');

      const socket = io(gatewayUrl, {
        autoConnect: false,
        withCredentials: true,
        auth: { labId },
        transports: ['websocket'],
        reconnection: false,
        timeout: 10_000,
      });
      let refreshed = false;
      const input = terminal.onData((data) => {
        if (!socket.connected) return;
        // Bound paste chunks to well below the gateway's 16 KiB message limit.
        const characters = Array.from(data);
        for (let offset = 0; offset < characters.length; offset += 1024) {
          socket.emit('terminal:input', {
            type: 'chars',
            input: characters.slice(offset, offset + 1024).join(''),
          });
          console.log(Array.from(data, (c) => c.charCodeAt(0).toString(16)));
        }
        // Diagnostic local echo only. Control sequences still reach the gateway intact.
        if (data === '\r') terminal.write('\r\n');
        else if (data === '\x7f') {
          if (terminal.buffer.active.cursorX > 0) terminal.write('\b \b');
        } else if (!data.includes('\x1b')) {
          terminal.write(
            data.replace(/[^\x20-\x7e\u0080-\uffff\r\n]/g, '').replace(/\r\n|\r|\n/g, '\r\n'),
          );
        }
      });

      socket.on('connect', () => {
        terminal.options.disableStdin = false;
        setConnected(true);
        setStatus('Connected to gateway');
        terminal.focus();
      });
      socket.on('disconnect', () => {
        terminal.options.disableStdin = true;
        setConnected(false);
        setStatus('Disconnected. Reconnect to continue.');
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
            if (!disposed) setStatus('Session expired. Sign in again to use the terminal.');
            return;
          }
        }
        setStatus(
          code
            ? `Connection rejected: ${code}`
            : 'Cannot reach gateway. Check its URL and frontend origin.',
        );
      });
      socket.on('terminal:error', (error: { code?: string }) => {
        setStatus(`Terminal error: ${error?.code ?? 'UNKNOWN'}`);
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
      if (!disposed) setStatus('Could not initialize the terminal.');
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
        {!connected && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStatus('Connecting…');
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
