# Engineering notes (internal)

Internal guidance for SohoPay engineers maintaining the skills, MCP server, and backend. **Not** installer instructions — nothing here is fetched by agents during setup.

## `@soho/mcp-contract` semver pinning

Pin `@soho/mcp-contract` to the same semver across `sohopay-backend` and `sohopay-mcp-server`. Scope drift must surface as a compile error, not a runtime authorization bug. When bumping the contract, bump both consumers in the same change and re-run their type checks before release.
