// On a GitHub pull request page: one small button next to the title that opens the PR in seams.
// GitHub is a single-page app, so the button is (re)added whenever the page changes.
(() => {
  const ID = 'seams-open';
  function add() {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m || document.getElementById(ID)) return;
    // the title row of github's current pull request header (always visible), then older layouts
    const anchor = document.querySelector('[data-component="TitleArea"]') ?? document.querySelector('.gh-header-actions, .gh-header-title');
    if (!anchor) return;
    const button = document.createElement('a');
    button.id = ID;
    button.textContent = 'open in seams';
    button.href = chrome.runtime.getURL(`review.html?owner=${m[1]}&repo=${m[2]}&pr=${m[3]}`);
    button.target = '_blank';
    button.rel = 'noopener';
    button.className = 'btn btn-sm';
    button.style.cssText = 'margin-left:12px;align-self:center;white-space:nowrap;font-family:ui-monospace,monospace;background:#c3dbc8;color:#1b2a21;border:1px solid #9fbfa6;border-radius:6px;padding:3px 10px;text-decoration:none';
    anchor.append(button);
  }
  add();
  new MutationObserver(add).observe(document.body, { childList: true, subtree: true });
})();
