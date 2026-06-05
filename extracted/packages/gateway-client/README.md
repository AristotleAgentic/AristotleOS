# @aristotle/gateway-client

Slim TypeScript client for the AristotleOS HTTP execution-control boundary,
plus the OpenAPI 3.1 spec it conforms to as a published artifact.

This package is the shipping unit for two things:

1. **The OpenAPI 3.1 spec** for the substrate's HTTP contract. Ship this
   into your tooling: `openapi-generator`, Stoplight, Insomnia, Postman,
   Speakeasy, anything that consumes OpenAPI.
2. **The canonical typed client**, re-exported from `@aristotle/os-sdk`.
   The same `AristotleClient` class the substrate's first-party agents use.

If you only want one or the other — say, you want the spec but you write
your own client in Go — use only what you need. The spec import works
without ever touching the TypeScript client.

## Install

```bash
npm install @aristotle/gateway-client
# or pnpm / yarn
```

## Three ways to consume the spec

### 1. Read the published `openapi.json` directly

```bash
# OpenAPI-generator: TypeScript axios client
npx @openapitools/openapi-generator-cli generate \
  -i node_modules/@aristotle/gateway-client/openapi.json \
  -g typescript-axios \
  -o ./generated/aristotle-gateway

# Stoplight Prism: mock server
prism mock node_modules/@aristotle/gateway-client/openapi.json

# Insomnia / Postman: import the file directly
```

The file is at `node_modules/@aristotle/gateway-client/openapi.json` after
install — no JS import required.

### 2. Import as a JSON module

```ts
import spec from "@aristotle/gateway-client/openapi.json";
console.log(spec.openapi);        // "3.1.0"
console.log(spec.info.version);   // "0.1.1"
```

### 3. Import the embedded JS constants

```ts
import {
  OPENAPI_YAML,        // raw JSON-as-string (OpenAPI 3.1 — JSON is valid YAML)
  OPENAPI_SPEC,        // parsed + frozen object
  OPENAPI_VERSION,     // "3.1.0"
  OPENAPI_TITLE,
  OPENAPI_API_VERSION,
  OPENAPI_PATHS        // array of all declared path keys
} from "@aristotle/gateway-client";

console.log(OPENAPI_PATHS); // ["/health", "/metrics", "/openapi.json", "/v1/...", ...]
```

> The constant is `OPENAPI_YAML` for stability. JSON is valid YAML, and
> historically operators reach for this constant to feed a YAML loader. If
> you want the parsed shape, use `OPENAPI_SPEC` (already an object).

## Using the typed client

`@aristotle/gateway-client` re-exports `AristotleClient` from
`@aristotle/os-sdk`. It's the same client; you can install either package.

```ts
import { AristotleClient, type CanonicalAction } from "@aristotle/gateway-client";

const aos = new AristotleClient({
  baseUrl: "https://gate.internal:8181",
  token: process.env.ARISTOTLE_TOKEN
});

const action: CanonicalAction = {
  action_id: "act-1",
  ward_id: "ward-finance",
  subject: "agent:payments-bot-7",
  action_type: "treasury.release",
  params: { amount: 5000, currency: "USD" },
  requested_at: new Date().toISOString()
};

const decision = await aos.evaluate(action);
if (decision.decision !== "ALLOW") {
  throw new Error(`refused: ${decision.reason_codes.join(", ")}`);
}
// decision.warrant.warrant_id is a single-use signed Warrant
// decision.gel_record.record_id is the audit record id
```

Every method on `AristotleClient` corresponds 1:1 with a path in
`OPENAPI_PATHS`. The package's own test suite asserts this — if the SDK
adds a method, the spec must add the path, or the test fails.

## When to install this vs `@aristotle/os-sdk`

| You want                                            | Install                       |
|-----------------------------------------------------|-------------------------------|
| Just the TypeScript client                          | `@aristotle/os-sdk`           |
| The TypeScript client + the OpenAPI artifact        | `@aristotle/gateway-client`   |
| Only the OpenAPI artifact (e.g. for openapi-generator) | `@aristotle/gateway-client`   |
| You don't know yet                                  | `@aristotle/gateway-client`   |

`@aristotle/gateway-client` depends on `@aristotle/os-sdk` so you get
everything os-sdk exports for free.

## OpenAPI 3.1, not 3.0

The substrate's runtime serves OpenAPI 3.0 from `/openapi.json` for
backward compatibility with older tooling. **The artifact in this
package is OpenAPI 3.1.** If your tooling requires 3.0, point it at the
live runtime's `/openapi.json` endpoint instead — most modern tools
(openapi-generator >=6.x, Stoplight, Insomnia 8+) handle 3.1 cleanly.

## Spec source of truth

The canonical spec file lives at `adapters/http-gateway/openapi.json` in
the AristotleOS source tree. The build script at
`packages/gateway-client/scripts/embed-openapi.mjs` copies it into this
package and emits `src/openapi-spec.gen.ts` with the embedded constants.

To change the spec: edit `adapters/http-gateway/openapi.json` in the
substrate repo, then run `pnpm --filter @aristotle/gateway-client build`.

## License

UNLICENSED. See LICENSE / NOTICE in the substrate repo.
