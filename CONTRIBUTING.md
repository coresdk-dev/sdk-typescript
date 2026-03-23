# Contributing to the CoreSDK TypeScript SDK

## Setup

```bash
git clone git@github.com:coresdk-dev/sdk-typescript.git && cd sdk-typescript
npm install
```

## Development

```bash
npm run build        # compile TypeScript
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest
npm run ci           # typecheck + lint + test (what CI runs)
```

## Adding a new SDK method

1. Add the method to `src/sdk.ts` (or the relevant service file)
2. Export it from `src/index.ts`
3. Add a mock stub to `MockSDK`
4. Add a test
5. Document in `README.md`

See [core-sdk CONTRIBUTING](https://github.com/coresdk-dev/core-sdk/blob/develop/CONTRIBUTING.md) for the architecture guide.
