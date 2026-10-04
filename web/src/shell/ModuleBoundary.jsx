import { Component } from 'react';

/**
 * Segura o erro de um modulo dentro da area dele. Sem isto, um pedaco que nao
 * carregou (o deploy trocou os arquivos com a aba aberta) ou um erro de
 * renderizacao apagava a tela inteira, barra lateral junto — e a pessoa nem
 * conseguia ir para outro modulo.
 */
export default class ModuleBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="alert" role="alert">
          <div className="alert__title">
            Nao foi possivel abrir {this.props.name}.
          </div>
          <div>Recarregue a pagina. Se continuar, avise o suporte.</div>
        </div>
      );
    }

    return this.props.children;
  }
}
