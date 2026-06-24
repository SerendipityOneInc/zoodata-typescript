/**
 * Vitest global setup for msw-backed network mocks.
 *
 * Tests should `import { server } from "./test-setup"` and register handlers
 * with `server.use(http.get(...))`. Unhandled requests fail the test
 * (catches "you forgot a handler" mistakes early).
 */
import { afterAll, afterEach, beforeAll } from "vitest";
import { setupServer } from "msw/node";

export const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
