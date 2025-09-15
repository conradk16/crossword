import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from 'nextjs/src/server/api/root';

// The fully typed tRPC client that expo_app will use.
export const api = createTRPCReact<AppRouter>();