const input = document.getElementById('token');
chrome.storage.sync.get('token').then(({ token }) => { if (token) input.value = token; });
document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({ token: input.value.trim() });
  document.getElementById('done').textContent = 'saved';
});
