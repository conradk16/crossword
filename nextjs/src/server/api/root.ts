import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from './trpc';

// API endpoints defined here
export const appRouter = router({
  greeting: publicProcedure
    .input(z.object({ text: z.string() }))
    .query(({ input }) => {
      return {
        message: `Hello, ${input.text}!`,
      };
    }),

  secretGreeting: protectedProcedure.query(({ ctx }) => {
    return `Hello, authorized user ${ctx.user.id}!`;
  }),
});

// Export the type of the router that client can use for type safety
export type AppRouter = typeof appRouter;