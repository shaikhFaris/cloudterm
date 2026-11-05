import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';

// Local logout notifications; periodic DB validation covers other gateway instances.
export const sessionEvents = new EventEmitter();
export const sessionEventKey = (token: string) => createHash('sha256').update(token).digest('hex');
