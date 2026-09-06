function mountPrivatePreviewNotice() {
  if (window.location.pathname !== '/preview') return;
  document.body.dataset.privatePreview = '1';

  const notice = document.createElement('aside');
  notice.className = 'private-preview-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-label', 'Visualização privada');

  const copy = document.createElement('div');
  const eyebrow = document.createElement('strong');
  eyebrow.textContent = 'VISUALIZAÇÃO PRIVADA';
  const text = document.createElement('span');
  text.textContent = 'Esta loja ainda não está publicada. Só você pode ver este preview pelo portal.';
  copy.append(eyebrow, text);

  const back = document.createElement('a');
  back.href = '/';
  back.textContent = 'Voltar ao painel';
  back.setAttribute('aria-label', 'Voltar ao portal do Catalog Engine');

  notice.append(copy, back);
  document.body.prepend(notice);
}

mountPrivatePreviewNotice();
