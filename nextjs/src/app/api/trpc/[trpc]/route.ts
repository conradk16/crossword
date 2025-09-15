import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/api/root';

export const createTRPCContext = (req: Request) => {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.split(' ')[1]; // "Bearer <token>"

  // replace later with real user id logic (get from token)
  const user = token ? { id: token } : null;

  return {
    user,
  };
};

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createTRPCContext(req),
  });

export { handler as GET, handler as POST };