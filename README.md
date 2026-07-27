# Victory Sip

Monorepo for `react-jssip-kit`: a React provider and hook library for JsSIP
SIP/WebRTC calling UI, plus a Vite demo app used for local development.

## Packages

| Workspace                              | Purpose                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------- |
| [`react-jssip-kit`](./react-jssip-kit) | Publishable npm package with hooks, provider, typed state, and SIP actions. |
| [`demo`](./demo)                       | Local Vite app for testing real calling flows and UI integration.           |

## Documentation

- [npm README](./react-jssip-kit/README.md)
- [Getting Started](./react-jssip-kit/docs/GETTING_STARTED.md)
- [API Reference](./react-jssip-kit/docs/API.md)
- [JsSIP Interop](./react-jssip-kit/docs/JSSIP_INTEROP.md)
- [Recipes](./react-jssip-kit/docs/RECIPES.md)
- [Modules and Lifecycle](./react-jssip-kit/docs/MODULES.md)
- [Changelog](./react-jssip-kit/CHANGELOG.md)

## Commands

Run commands from the repository root.

| Command                         | Description                          |
| ------------------------------- | ------------------------------------ |
| `npm install`                   | Install all workspace dependencies.  |
| `npm run build:react-jssip-kit` | Build the npm package.               |
| `npm run dev:demo`              | Start the demo app in Vite dev mode. |
| `npm run build:demo`            | Build the demo app.                  |
| `npm run build`                 | Build the package and demo app.      |

## Publishing Checklist

1. Update `react-jssip-kit/CHANGELOG.md`.
2. Verify `react-jssip-kit/README.md` renders cleanly on npm.
3. Run `npm run build:react-jssip-kit`.
4. Publish from `react-jssip-kit`.
