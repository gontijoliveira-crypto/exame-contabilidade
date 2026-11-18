---
name: audio-resumo-pt
description: Use quando o usuário pedir um resumo, análise ou atualização em áudio, ou disser que não consegue ler agora. Gera um MP3 com voz feminina em português do Brasil e envia ao usuário.
---

# Áudio de resumo em português (voz feminina)

## Regras de conteúdo
- Texto falado, não escrito: frases curtas, sem tabelas, sem símbolos, sem códigos, sem endereços de site.
- Números por extenso quando ajudar ("duzentos mil tokens").
- Estrutura: resumo em uma frase → pontos numerados ("Primeiro…", "Segundo…") → **ponto de decisão** com opções "opção um / opção dois" → "Vou aguardar a sua resposta".
- Não colocar nome do usuário nem dados de clientes no texto (ele é enviado a um serviço externo de voz).

## Como gerar
A voz do `espeak-ng` ficou incompreensível para o usuário; **não usar**. O `edge-tts` falha no proxy (certificado). O que funcionou foi o gTTS:

```bash
pip install -q gTTS
REQUESTS_CA_BUNDLE=/root/.ccr/ca-bundle.crt gtts-cli -l pt --tld com.br -f texto.txt -o resumo.mp3
ffprobe -loglevel error -show_entries format=duration -of csv=p=0 resumo.mp3   # duração em segundos
```

- Salvar texto e MP3 na pasta de rascunho (scratchpad) da sessão.
- Enviar com `SendUserFile` (status `normal`) e uma legenda curta com a duração.
- Na resposta escrita, repetir só a decisão pendente, em poucas linhas.
- Lembrar o usuário de baixar o áudio se for apagar a conversa.
