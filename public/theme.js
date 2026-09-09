// Applies the saved or system colour preference before the first paint.
//
// An external file rather than an inline script, on purpose. The root layout
// is shared by prerendered marketing pages and cannot read a per-request
// nonce without making every page dynamic; a same-origin script needs no
// nonce under `script-src 'self'`. It is loaded synchronously in <head> so
// there is no flash of the wrong theme. The storage key and the two legacy
// values mirror components/ui/theme-toggle.tsx, and a unit test keeps them
// in step.
;(function () {
  try {
    var v = localStorage.getItem("fw-theme")
    var t =
      v === "dark" || v === "flip"
        ? "dark"
        : v === "light" || v === "base"
          ? "light"
          : window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
    document.documentElement.dataset.theme = t
  } catch {}
})()
