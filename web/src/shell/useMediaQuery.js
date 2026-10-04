import { useSyncExternalStore } from 'react';

/**
 * Se a media query casa agora, acompanhando as mudancas. A casca escolhe por
 * aqui entre a barra lateral e o menu inferior: renderizar os dois e esconder
 * um por CSS deixaria dois menus "Principal" na pagina, e o leitor de tela
 * (e o teste) acharia cada destino duas vezes.
 */
export default function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
