// Aplica o tema escolhido em Ajustes antes do primeiro pixel. Roda como script
// classico no <head>, antes do React: sem isto, quem escolheu um tema contra o
// do sistema via um clarao do outro a cada carga. Arquivo, e nao script
// inline, porque a CSP so aceita script da propria origem. Chave e valores sao
// os de `src/shell/theme.js`.
try {
  const theme = localStorage.getItem('tasktab:tema');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  }
} catch {
  // Sem storage vale o tema do sistema, que o CSS resolve sozinho.
}
