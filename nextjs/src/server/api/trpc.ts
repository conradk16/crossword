import { initTRPC } from '@trpc/server';

// Initializing tRPC on the server
const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;