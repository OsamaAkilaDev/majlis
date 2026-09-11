// Install-prompt requirement only. Caches nothing on purpose: Majlis has no
// offline mode, and a stale cached shell would show wrong capacity numbers.
self.addEventListener('fetch', () => {});
