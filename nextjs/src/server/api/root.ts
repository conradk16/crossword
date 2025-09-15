import { z } from 'zod';
import { router, publicProcedure } from './trpc';

// API endpoints defined here
export const appRouter = router({
  greeting: publicProcedure
    .input(z.object({ text: z.string() }))
    .query(({ input }) => {
      return {
        message: `Hello, ${input.text}!`,
      };
    }),
});

// Export the type of the router that client can use for type safety
export type AppRouter = typeof appRouter;