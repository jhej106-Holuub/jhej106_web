(() => {
  try {
    const themes = ['classic','terminal','midnight','warm-paper'];
    const preferences = JSON.parse(localStorage.getItem('diaries:display') || '{}');
    const incoming = window.DIARIES?.accountsOnly ? new URLSearchParams(location.search).get('theme') : null;
    if (themes.includes(incoming)) {
      preferences.theme = incoming;
      localStorage.setItem('diaries:display',JSON.stringify(preferences));
    }
    document.documentElement.dataset.theme = themes.includes(preferences.theme) ? preferences.theme : 'classic';
  } catch {}
})();
