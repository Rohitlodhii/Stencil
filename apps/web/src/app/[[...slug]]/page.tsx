import App from "@/App";

/** Optional catch-all: every path renders the same client SPA. Real routes
 *  (/login, /register, /dashboard, ...) are resolved client-side by the
 *  HashRouter — identical behavior to the desktop app. */
export default function CatchAll() {
  return <App />;
}
