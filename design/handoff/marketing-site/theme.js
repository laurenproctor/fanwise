(function () {
  var FWTheme = {
    key: 'fw-theme',
    apply: function (t) {
      document.documentElement.style.filter = t === 'flip' ? 'invert(1) hue-rotate(180deg)' : '';
    },
    current: function () {
      try { return localStorage.getItem(FWTheme.key) || 'base'; } catch (e) { return 'base'; }
    },
    set: function (t) {
      try { localStorage.setItem(FWTheme.key, t); } catch (e) {}
      FWTheme.apply(t);
    },
    toggle: function () {
      FWTheme.set(FWTheme.current() === 'flip' ? 'base' : 'flip');
    }
  };
  FWTheme.apply(FWTheme.current());
  window.FWTheme = FWTheme;
  if (!customElements.get('fw-theme-toggle')) {
    customElements.define('fw-theme-toggle', class extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        var dark = (this.getAttribute('variant') || 'light') === 'dark';
        var s = this.attachShadow({ mode: 'open' });
        s.innerHTML = '<style>button{width:38px;height:38px;border-radius:999px;cursor:pointer;display:grid;place-items:center;background:transparent;border:1px solid ' + (dark ? 'rgba(200,218,255,.25)' : '#D8D4CB') + ';color:' + (dark ? '#E9F0FF' : '#14161C') + ';transition:border-color .15s}button:hover{border-color:' + (dark ? 'rgba(200,218,255,.6)' : '#14161C') + '}svg{display:block}</style>' +
          '<button type="button" title="Toggle light / dark view" aria-label="Toggle light and dark view"><svg width="16" height="16" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.4"></circle><path d="M10 2.5a7.5 7.5 0 0 1 0 15z" fill="currentColor"></path></svg></button>';
        s.querySelector('button').addEventListener('click', function () { FWTheme.toggle(); });
      }
    });
  }
})();
