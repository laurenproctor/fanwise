(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var seen = new WeakSet();
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        io.unobserve(e.target);
        e.target.style.opacity = '1';
        e.target.style.transform = 'none';
      }
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -40px 0px' });
  function prep(el, delay) {
    if (seen.has(el)) return;
    seen.add(el);
    el.style.opacity = '0';
    el.style.transform = 'translateY(26px)';
    el.style.transition = 'opacity .7s cubic-bezier(.2,.6,.2,1) ' + delay + 'ms, transform .7s cubic-bezier(.2,.6,.2,1) ' + delay + 'ms';
    io.observe(el);
  }
  function scan() {
    var els = document.body.querySelectorAll('section, article, header, footer');
    for (var i = 0; i < els.length; i++) prep(els[i], (i % 4) * 90);
  }
  function start() {
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
