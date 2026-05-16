# Vite + Deno + Solid + TypeScript

## Running

You need to have Deno v2.0.0 or later installed to run this repo.

Start a dev server:

```
$ deno task dev
```

## Deploy

Build production assets:

```
$ deno task build
```

GitHub Pages deploys from `.github/workflows/deploy-pages.yml` on pushes to
`main`.

Production URL: <https://scarf005.github.io/fstab-visualizer/>
