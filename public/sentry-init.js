/** Crown Survivors browser Sentry bootstrap (production host only). Loaded after bundle.tracing.min.js */
(function () {
  if (location.hostname !== "crown-survivors.vercel.app") return;
  if (typeof Sentry === "undefined") return;
  var el = document.currentScript;
  var component = (el && el.getAttribute("data-component")) || "browser";
  var dsn =
    "https://70b3e66d43142d4f14da7a5027f74434@o4510091891769344.ingest.de.sentry.io/4512351983370320";
  Sentry.init({
    dsn: dsn,
    environment: "production",
    tracesSampleRate: 0.1,
    initialScope: {
      tags: { runtime: "browser", component: component },
    },
  });
})();
