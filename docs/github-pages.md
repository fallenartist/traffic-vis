# GitHub Pages

The application is a static Vite build: Mapbox and Three.js run in the browser, and the demo data is bundled. It can be published from a GitHub repository using GitHub Pages. No backend is required.

## Prepared files

* `vite.config.js` uses relative asset paths (`base: './'`), supporting both an account root and a project path such as `https://OWNER.github.io/REPOSITORY/`.
* `.github/workflows/pages.yml` installs the pinned pnpm dependencies, runs tests, builds `dist/`, and deploys that artifact on pushes to `main` or a manual workflow run.
* `package.json` pins pnpm 9.15.9. The workflow uses Node 22 and GitHub's Pages deployment actions.

## Publish when ready

1. Upload this project to a GitHub repository with `main` as its default branch. GitHub Free supports Pages for public repositories; private-repository availability depends on the account plan.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Set the encrypted repository **Actions secret** `VITE_MAPBOX_TOKEN` to a public `pk.` token with access to the custom style. The build reads no token from source. `VITE_MAPBOX_STYLE` is an optional Actions variable; the original custom style is the default. Vite embeds the browser token into the deployed JavaScript: it is absent from source but visible to site visitors. This is required for a public Mapbox browser map.
4. Ensure the token's allowed URLs include the actual GitHub Pages site URL (and your custom domain if applicable). Test map loading from that public URL. Mapbox access and usage remain governed by the Mapbox account and plan; GitHub Pages supplies the static hosting.
5. Push to `main` or run **Deploy GitHub Pages** manually. The workflow's deployment output provides the public URL.

Target repository: `https://github.com/fallenartist/traffic-vis`. Expected Pages URL: `https://fallenartist.github.io/traffic-vis/`. The production token must allow the latter URL in Mapbox. Review the repository Actions tab and Pages settings for the latest deployment status.

The eight historical experiments have been removed from `public/` and preserved in ignored `legacy-local/`. They and their old tokens are not uploaded or deployed. `dist/` is build output and is recreated; it is not the long-term copy of the experiments. `.env.local`, `dist/`, and the local archive are excluded by `.gitignore`.

Official references: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Vite static deployment](https://vite.dev/guide/static-deploy.html#github-pages), [Mapbox public tokens and URL restrictions](https://docs.mapbox.com/help/dive-deeper/access-tokens/).
