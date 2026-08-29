# Rules:

- [ ] Always think of production grade solutions and not settle on local dev solutions.
- [ ] Never hardcode sensitive values, always use the env file for sensitive data.
- [ ] Never use emojis in code and in markup.
- [ ] Search for available shadcn ui components that can be used in frontend tasks, and use them instead of creating from scratch.
- [ ] Always have input validation on both frontend and specially on backend.
- [ ] Always be consistent with styling and theming.
- [ ] Always create or update unit & integration tests for every new feature or updates & fixes.
- [ ] Always have regression testing to ensure new code changes didn't break existing features.
- [ ] When verifying, run only client tests if changes are made in the client, or server tests if changes are made only in the server. Otherwise, run all  tests.
- [ ] Run bun run verify & lint after building for verification.
- [ ] Always include rate-limiting for every routes you will be creating.
- [ ] When updating database, make sure that the database is normalized at a higher normalized form, and is optimized to avoid anomalies
