'use strict';

/**
 * Palpite de categoria a partir do nome do emitente.
 *
 * **Isto e uma excecao consciente a uma regra antiga do projeto.** Ate aqui a
 * categoria vinha exclusivamente do CNPJ cadastrado, e adivinhar por palavra
 * era proibido: um palpite errado entra na planilha parecendo leitura e so
 * aparece na conferencia. A regra mudou porque o uso real mostrou o outro lado
 * da conta — num lote de 30 cupons, classificar tudo a mao custa mais do que
 * corrigir os poucos que o palpite erra.
 *
 * O que **nao** mudou: nada aqui confirma nada. O palpite grava
 * `category_guessed = true` no comprovante, a revisao destaca o campo enquanto
 * a marca estiver la, e confirmar zera a marca. Categoria vinda do CNPJ
 * cadastrado continua valendo mais e nunca e sobrescrita por palpite.
 */

// Ordem importa: o primeiro grupo que casar ganha. "posto" antes de qualquer
// coisa de comida porque posto de rodovia costuma trazer "lanchonete" no nome,
// e o que se compra ali e combustivel.
const RULES = [
  [
    'combustivel',
    /\b(posto|combust[íi]vel|gasolina|etanol|[áa]lcool|diesel|ipiranga|petrobras|shell|ale\b|texaco)/i,
  ],
  ['estacionamento', /\b(estacionament|parking|zona\s*azul|p[áa]tio)/i],
  ['lavanderia', /\b(lavanderia|lavander|laundry|lava\s*e\s*seca)/i],
  [
    'transporte',
    /\b(uber|99\s*(pop|taxi)|t[áa]xi|taxi|locadora|rent\s*a\s*car|loca[çc][ãa]o\s+de\s+ve[íi]culo|ped[áa]gio|passagem|rodovi[áa]ria|latam|gol\s+linhas|azul\s+linhas)/i,
  ],
  [
    'alimentacao',
    /\b(restaurant|lanchonet|pizzari|churrascari|padari|confeitari|cafeteri|caf[ée]\b|bar\b|buteco|boteco|espetinho|grill|burger|lanches|sorveteri|a[çc]a[íi]|pastel|supermercad|mercadinho|mercearia|mercado|alimenta[çc][ãa]o|alimentos|comercio\s+de\s+alimentos|ifood|marmit|self\s*service|balne[áa]rio)/i,
  ],
];

/**
 * Categoria sugerida, ou `null` quando nenhuma palavra reconhecida aparece.
 *
 * `null` e resposta legitima e frequente: um emitente cadastrado como
 * `K B A TEIXEIRA COMÉRCIO E SERVIÇOS` nao diz o que foi comprado, e inventar
 * uma categoria para ele seria pior que deixar em branco.
 */
function guessCategory(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    return null;
  }

  const found = RULES.find(([, pattern]) => pattern.test(name));

  return found ? found[0] : null;
}

/**
 * Categoria usada quando nem o cadastro nem o nome dizem nada.
 *
 * `alimentacao` porque e a esmagadora maioria dos lancamentos reais — 21 de 23
 * no relatorio que originou este ajuste. Chega **sempre marcada como palpite**,
 * como qualquer outro chute: o ganho e nao ter de abrir o seletor nas linhas em
 * que a resposta ja era essa, e o custo e uma troca nas poucas em que nao era.
 */
const DEFAULT_CATEGORY = 'alimentacao';

module.exports = { guessCategory, DEFAULT_CATEGORY, RULES };
