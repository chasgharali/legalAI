import { serve } from 'inngest/next';
import { inngest, inngestFunctions } from '@/lib/inngest';

// Inngest's Next.js handler exposes GET (introspection) and POST (event
// delivery) at this route. In dev, run `npx inngest-cli@latest dev` and it
// will discover this endpoint automatically.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
