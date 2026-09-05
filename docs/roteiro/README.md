# Roteiro de teste — fonte

O PDF entregue é `docs/roteiro-de-teste-apitofut.pdf`. Ele é **gerado**; não
edite o PDF, edite o texto aqui.

| arquivo | o que é |
|---|---|
| `conteudo.py` | o texto: introdução, endereços, avisos, as 16 etapas e o fechamento. É onde se mexe |
| `gerar.py` | a diagramação em reportlab. Só mexer para mudar aparência |

```bash
pip install reportlab
python3 docs/roteiro/gerar.py
```

Roda de qualquer diretório e escreve sempre em `docs/`.

## Ao alterar o sistema

O roteiro descreve a interface passo a passo, então **envelhece rápido**: botão
renomeado, diálogo novo ou regra que mudou de lugar tornam um passo impossível
de seguir. Quem mexe na tela confere se o roteiro ainda descreve o que ela faz —
mesma disciplina do manual (`apps/api/src/manual/topicos.ts`), e pelo mesmo
motivo: instrução errada é pior que instrução ausente, porque tem ar de
autoridade.

Cuidado especial com a **ordem** dos passos. Uma etapa que manda encerrar todos
os jogos e depois pede para testar o comportamento com jogo em aberto não é um
detalhe de redação: é um passo que ninguém consegue executar.

## Endereços

`ENDERECOS`, em `conteudo.py`, aponta para o ambiente de testes no Railway.
Trocar de ambiente é trocar essas duas linhas.
