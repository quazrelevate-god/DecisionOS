// craco.config.js
const path = require("path");
const { InjectManifest } = require("workbox-webpack-plugin");
require("dotenv").config();

// Check if we're in development/preview mode (not production build)
// Craco sets NODE_ENV=development for start, NODE_ENV=production for build
const isDevServer = process.env.NODE_ENV !== "production";

// Environment variable overrides
const config = {
  enableHealthCheck: process.env.ENABLE_HEALTH_CHECK === "true",
};

function makeDevServerV5Compatible(devServerConfig) {
  const {
    https,
    onAfterSetupMiddleware,
    onBeforeSetupMiddleware,
    onListening,
    setupMiddlewares,
    ...compatibleConfig
  } = devServerConfig;

  compatibleConfig.server =
    typeof https === "object"
      ? { type: "https", options: https }
      : https
        ? "https"
        : "http";
  compatibleConfig.headers = {
    ...compatibleConfig.headers,
    "Cross-Origin-Resource-Policy": "same-origin",
  };

  if (onBeforeSetupMiddleware || setupMiddlewares) {
    compatibleConfig.setupMiddlewares = (middlewares, devServer) => {
      if (onBeforeSetupMiddleware) {
        onBeforeSetupMiddleware(devServer);
      }

      return setupMiddlewares
        ? setupMiddlewares(middlewares, devServer)
        : middlewares;
    };
  }

  compatibleConfig.onListening = (devServer) => {
    devServer.close ??= (callback) => devServer.stopCallback(callback);

    if (onListening) {
      onListening(devServer);
    }
    if (onAfterSetupMiddleware) {
      onAfterSetupMiddleware(devServer);
    }
  };

  return compatibleConfig;
}

// Conditionally load health check modules only if enabled
let WebpackHealthPlugin;
let setupHealthEndpoints;
let healthPluginInstance;

if (config.enableHealthCheck) {
  WebpackHealthPlugin = require("./plugins/health-check/webpack-health-plugin");
  setupHealthEndpoints = require("./plugins/health-check/health-endpoints");
  healthPluginInstance = new WebpackHealthPlugin();
}

let webpackConfig = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    configure: (webpackConfig) => {

      // Add ignored patterns to reduce watched directories
        webpackConfig.watchOptions = {
          ...webpackConfig.watchOptions,
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/build/**',
            '**/dist/**',
            '**/coverage/**',
            '**/public/**',
        ],
      };

      // Add health check plugin to webpack if enabled
      if (config.enableHealthCheck && healthPluginInstance) {
        webpackConfig.plugins.push(healthPluginInstance);
      }

      // MPWA-05: real PWA, wired through CRACO with no eject.
      //
      // CRA 5 DOES ship Workbox wiring — but it is gated on
      // `src/service-worker.js` existing, and this project had no such file
      // (§4: "There is no service worker and none is registered"). Creating it
      // therefore switched CRA's own InjectManifest on, and pushing a second
      // instance made the build fail with "Can't find self.__WB_MANIFEST in
      // your SW source": the first instance injected the manifest correctly,
      // then the second found the injection point already substituted.
      //
      // So replace CRA's instance rather than adding to it — the defaults need
      // tuning anyway (see below).
      //
      // Production only: a service worker in front of the dev server serves
      // stale bundles and makes "did my change land?" unanswerable.
      if (!isDevServer) {
        webpackConfig.plugins = webpackConfig.plugins.filter(
          (p) => !p || p.constructor?.name !== "InjectManifest"
        );
        webpackConfig.plugins.push(
          new InjectManifest({
            swSrc: path.resolve(__dirname, "src/service-worker.js"),
            swDest: "service-worker.js",
            exclude: [
              /\.map$/,
              /asset-manifest\.json$/,
              /LICENSE/,
              // Cached explicitly on install instead, so it is available even
              // when the precache itself has not run.
              /^offline\.html$/,
              // public/ ships ~5 investor and doc PDFs. CRA's default excludes
              // do not cover them, and precaching megabytes of brochure on a
              // patchy 4G connection to install an app is the opposite of the
              // point.
              /\.pdf$/,
              /^manual\//,
            ],
            // CRA defaults to 5MiB; the main chunk here is comfortably inside
            // that, but be explicit — if the shell chunk ever silently drops
            // out of the manifest, offline start breaks and nothing warns.
            maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          })
        );
      }
      return webpackConfig;
    },
  },
};

webpackConfig.devServer = (devServerConfig) => {
  // Add health check endpoints if enabled
  if (config.enableHealthCheck && setupHealthEndpoints && healthPluginInstance) {
    const originalSetupMiddlewares = devServerConfig.setupMiddlewares;

    devServerConfig.setupMiddlewares = (middlewares, devServer) => {
      // Call original setup if exists
      if (originalSetupMiddlewares) {
        middlewares = originalSetupMiddlewares(middlewares, devServer);
      }

      // Setup health endpoints
      setupHealthEndpoints(devServer, healthPluginInstance);

      return middlewares;
    };
  }

  return devServerConfig;
};

// Wrap with visual edits (automatically adds babel plugin, dev server, and overlay in dev mode)
if (isDevServer) {
  try {
    const { withVisualEdits } = require("@emergentbase/visual-edits/craco");
    webpackConfig = withVisualEdits(webpackConfig);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && err.message.includes('@emergentbase/visual-edits/craco')) {
      console.warn(
        "[visual-edits] @emergentbase/visual-edits not installed — visual editing disabled."
      );
    } else {
      throw err;
    }
  }
}

const configureDevServer = webpackConfig.devServer;
webpackConfig.devServer = (devServerConfig) =>
  makeDevServerV5Compatible(configureDevServer(devServerConfig));

module.exports = webpackConfig;
